/* ==========================================================================
   CLIDANFI · api.js  ·  CAPA DE ACCESO A DATOS
   --------------------------------------------------------------------------
   Toda la aplicación habla únicamente con `API.*`. Ninguna vista consulta
   Supabase por su cuenta.

   El cliente se crea una sola vez en js/supabase-client.js y llega aquí como
   `window.SB`. No hay modo demostración ni almacenamiento local: si falta
   configuración, este módulo no se activa y app.js muestra la pantalla de
   configuración.
   ========================================================================== */
(function (global) {
  'use strict';

  const sb = global.SB;
  if (!sb) {
    console.warn('[CLIDANFI] API sin cliente de Supabase: revisa js/env.js.');
    return;
  }

  const { startOfWeek, addDays, isoDay, normalize, uid } = UI;

  /* ======================================================================
     TOLERANCIA A ESQUEMAS DESACTUALIZADOS
     Si el proyecto de Supabase no tiene ejecutada la última versión de
     supabase/schema.sql, PostgREST responde 404 («no existe la tabla» o
     «no está en la caché del esquema»). Antes eso reventaba pantallas
     enteras porque un Promise.all rechazaba entero. Ahora se detecta, se
     degrada con elegancia y se avisa de qué hay que ejecutar.
     ====================================================================== */
  let _faltaEsquema = null;   // nombre del objeto que falta, si lo hay

  /** ¿El error es «este objeto no existe en la base»? */
  const _esFalta = (error) =>
    !!error && (
      error.code === '42P01' ||                       // relation does not exist
      error.code === 'PGRST202' ||                    // función RPC inexistente
      error.code === 'PGRST205' ||                    // tabla fuera de la caché del esquema
      /does not exist|schema cache|Not Found/i.test(error.message || '')
    );

  /** Lanza si la consulta falló; si no, devuelve los datos. */
  const ok = ({ data, error }) => {
    if (error) {
      if (_esFalta(error)) {
        _faltaEsquema = (error.message.match(/"?public\.(\w+)"?|'(\w+)'/) || [])[1] || 'una tabla o función';
        throw new Error(
          `Tu base de datos está desactualizada: falta «${_faltaEsquema}». ` +
          'Ejecuta supabase/schema.sql completo en el SQL Editor de Supabase.'
        );
      }
      throw new Error(error.message);
    }
    return data;
  };

  /**
   * Envuelve una consulta que puede no existir todavía en la base.
   * Si falta el objeto devuelve `porDefecto` en vez de tumbar la pantalla.
   */
  const opcional = async (promesa, porDefecto) => {
    try {
      const res = await promesa;
      if (res && res.error) {
        if (_esFalta(res.error)) { _faltaEsquema = 'solicitudes_cita'; return porDefecto; }
        throw new Error(res.error.message);
      }
      return res;
    } catch (e) {
      if (/desactualizada|does not exist|schema cache/i.test(e.message)) return porDefecto;
      throw e;
    }
  };

  /** Nombre del objeto que falta en la base, o null si todo está al día. */
  const faltaEnEsquema = () => _faltaEsquema;

  /* ======================================================================
     AUTENTICACIÓN
     ====================================================================== */
  /**
   * Normaliza la sesión de Supabase al mismo contrato que usa la app:
   *   { user: { id, email }, perfil: { id, rol, nombre } }
   * El ROL viene de la tabla `perfiles`, nunca del cliente: es la misma
   * fuente que consultan las políticas RLS mediante es_fisio().
   */
  const _normalizar = async (session) => {
    if (!session || !session.user) return null;
    const { data, error } = await sb.from('perfiles').select('id, rol, nombre').eq('id', session.user.id).single();
    if (error) {
      console.error('[CLIDANFI] El usuario no tiene perfil en la tabla `perfiles`:', error.message);
      return null;
    }
    return {
      user: { id: session.user.id, email: session.user.email },
      perfil: { id: data.id, rol: data.rol, nombre: data.nombre || session.user.email }
    };
  };

  /* --- Sesión en memoria ------------------------------------------------
     El guardia de autorización necesita el rol de forma síncrona, así que la
     sesión y el expediente propio se cachean aquí y se refrescan en cada
     cambio de sesión. */
  let _sesion = null;
  let _miPacienteId = null;

  const _recordarSesion = async (s) => {
    // Al cambiar de usuario (o al salir) se tira la configuración cacheada:
    // contiene columnas que solo puede ver quien tiene sesión, y no deben
    // sobrevivir en memoria al cierre.
    const antes = _sesion ? _sesion.user.id : null;
    const ahora = s ? s.user.id : null;
    if (antes !== ahora) { _cfg = null; _cfgCompleta = false; }

    _sesion = s;
    _miPacienteId = null;
    if (s && s.perfil.rol === 'paciente') {
      const { data } = await sb.from('pacientes').select('id').eq('usuario_id', s.user.id).limit(1);
      _miPacienteId = data && data.length ? data[0].id : null;
    }
    return s;
  };

  const auth = {
    entrar: async (email, password) => {
      const { data, error } = await sb.auth.signInWithPassword({
        email: String(email || '').trim().toLowerCase(),
        password
      });
      // Mensaje uniforme: no revelamos si el correo existe.
      if (error) throw new Error(/invalid login/i.test(error.message)
        ? 'Correo o contraseña incorrectos.'
        : error.message);

      const s = await _normalizar(data.session);
      if (!s) {
        await sb.auth.signOut();
        throw new Error('Tu cuenta no tiene un perfil asignado. Contacta a la clínica.');
      }
      return _recordarSesion(s);
    },

    /**
     * Alta pública. La cuenta nace SIEMPRE como 'paciente' (lo fija el trigger
     * handle_new_user en el servidor: el cliente no elige rol).
     *
     * Si el correo ya tenía expediente creado por el fisioterapeuta, el trigger
     * `vincular_expediente_por_correo` lo enlaza en cuanto se confirma el
     * correo, sin duplicar la historia clínica.
     *
     * @returns {{necesitaConfirmar: boolean, email: string}}
     */
    registrar: async (email, password, nombre) => {
      const correo = String(email || '').trim().toLowerCase();
      const { data, error } = await sb.auth.signUp({
        email: correo,
        password,
        options: { data: { nombre: String(nombre || '').trim() }, emailRedirectTo: location.origin + location.pathname }
      });

      if (error) {
        if (/already registered|already exists/i.test(error.message)) {
          throw new Error('Ese correo ya tiene una cuenta. Inicia sesión o recupera tu contraseña.');
        }
        if (/password/i.test(error.message)) {
          throw new Error('La contraseña debe tener al menos 6 caracteres.');
        }
        throw new Error(error.message);
      }

      // Sin sesión inmediata ⇒ Supabase exige confirmar el correo.
      const necesitaConfirmar = !data.session;
      if (!necesitaConfirmar) await _recordarSesion(await _normalizar(data.session));
      return { necesitaConfirmar, email: correo };
    },

    recuperar: async (email) => {
      const { error } = await sb.auth.resetPasswordForEmail(String(email || '').trim().toLowerCase(), {
        redirectTo: location.origin + location.pathname
      });
      if (error) throw new Error(error.message);
      return true;
    },

    cambiarPassword: async (password) => {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw new Error(error.message);
      return true;
    },

    salir: async () => { await sb.auth.signOut(); await _recordarSesion(null); },

    sesion: async () => {
      const { data } = await sb.auth.getSession();
      return _recordarSesion(await _normalizar(data.session));
    },

    onCambio: (cb) => {
      const { data } = sb.auth.onAuthStateChange(async (_evento, session) =>
        cb(await _recordarSesion(await _normalizar(session))));
      return () => data.subscription.unsubscribe();
    }
  };

  /**
   * Expediente ligado a la sesión. La consulta filtra por usuario_id, pero la
   * garantía real es la política RLS `pac_ve_su_ficha`: aunque alguien
   * manipulara este filtro, el servidor no devolvería filas ajenas.
   */
  const miPaciente = async () => {
    const u = (await sb.auth.getUser()).data.user;
    if (!u) return null;
    const rows = ok(await sb.from('pacientes_ordenados').select('*').eq('usuario_id', u.id).limit(1));
    if (!rows.length) return null;
    return { ...rows[0], proxima_cita: await _proximaCitaDe(rows[0].id) };
  };

  /* ======================================================================
     CONFIGURACIÓN DE LA CLÍNICA  ·  tabla `configuracion` (fila única)

     Antes vivía en localStorage, lo que la ataba a un navegador. Ahora es
     del servidor: la marca es la misma en el móvil de recepción, en la
     tablet del box y en la pantalla de acceso de cualquier paciente.

     `getConfig` debe funcionar SIN sesión (la pantalla de acceso pinta el
     logo antes de entrar), por eso queda fuera del guardia `_proteger`.
     Quien la escribe sí está acotado: por `SOLO_FISIO` aquí y, de verdad,
     por la política `config_edita_fisio` en el servidor.
     ====================================================================== */
  const CFG_DEF = {
    clinica: 'CLIDANFI',
    lema: 'Fisioterapia y rehabilitación',
    logo_url: '',
    logo_ruta: '',
    fisio: '',
    precio_sesion: 450
  };

  /* El bucket va como literal en cada llamada, no como constante:
     scripts/check-schema.js busca `storage.from('…')` para comprobar que el
     bucket existe en schema.sql, y una variable lo dejaría ciego. */

  /* ---------------------------------------------------------------------
     COLUMNAS SEGÚN QUIÉN PREGUNTA

     `anon` solo tiene privilegio de lectura sobre la marca (ver el bloque
     de grants en schema.sql). Pedirle `select('*')` daría «permission
     denied for column precio_sesion», así que la lista va explícita y debe
     coincidir con la del `grant`.
     --------------------------------------------------------------------- */
  const CFG_COLS_PUBLICAS = 'id, clinica, lema, logo_url';
  const CFG_COLS_TODAS    = 'id, clinica, lema, logo_url, logo_ruta, precio_sesion';

  /* Caché en memoria: la marca se pide en cada render del dashboard y del
     login, y cambia una vez cada muchos meses. */
  let _cfg = null;
  let _cfgCompleta = false;   // ¿la caché incluye las columnas privadas?

  /** Sobrescribe la caché normalizando los tipos que llegan de PostgREST. */
  const _guardarEnCache = (fila) => {
    _cfg = { ...CFG_DEF, ...(fila || {}) };
    _cfg.precio_sesion = Number(_cfg.precio_sesion) || 0;
    delete _cfg.fisio;          // no se persiste: sale de la sesión
    return _cfg;
  };

  const getConfig = async ({ refrescar = false } = {}) => {
    // Con sesión hay derecho a las columnas privadas. Si la caché se llenó
    // antes de iniciarla (el arranque pinta la marca primero), se rellena:
    // de lo contrario `precio_sesion` se quedaría en su valor por defecto.
    const conSesion = !!_sesion;

    if (!_cfg || refrescar || (conSesion && !_cfgCompleta)) {
      // Base sin migrar (`configuracion` todavía no existe) ⇒ valores por
      // defecto. La aplicación sigue funcionando; solo no hay marca propia.
      const res = await opcional(
        sb.from('configuracion')
          .select(conSesion ? CFG_COLS_TODAS : CFG_COLS_PUBLICAS)
          .eq('id', 1).maybeSingle(),
        { data: null, error: null }
      );
      _guardarEnCache(res && res.data ? res.data : null);
      _cfgCompleta = conSesion;
    }
    // El nombre del fisioterapeuta es el de quien tiene la sesión abierta.
    return { ..._cfg, fisio: _sesion ? _sesion.perfil.nombre : '' };
  };

  const CFG_CAMPOS = ['clinica', 'lema', 'logo_url', 'logo_ruta', 'precio_sesion'];

  const setConfig = async (patch) => {
    const fila = { id: 1, actualizado_en: new Date().toISOString() };
    for (const k of CFG_CAMPOS) if (k in (patch || {})) fila[k] = patch[k];

    _guardarEnCache(ok(await sb.from('configuracion').upsert(fila).select(CFG_COLS_TODAS).single()));
    _cfgCompleta = true;
    return getConfig();
  };

  /**
   * Sube el logo al bucket público `marca` y deja su URL en la configuración.
   * Recibe el dataURL ya comprimido por UI.readImageCompressed.
   * El logo anterior se borra: no tiene sentido acumularlos.
   */
  const subirLogo = async (dataUrl) => {
    const anterior = (await getConfig()).logo_ruta;

    const blob = await (await fetch(dataUrl)).blob();
    const ruta = `${uid('logo')}.jpg`;
    ok(await sb.storage.from('marca').upload(ruta, blob, { contentType: 'image/jpeg', upsert: false }));

    const { data } = sb.storage.from('marca').getPublicUrl(ruta);
    const cfg = await setConfig({ logo_url: data.publicUrl, logo_ruta: ruta });

    if (anterior && anterior !== ruta) {
      // Si el borrado falla no se pierde nada: solo queda un archivo huérfano.
      await sb.storage.from('marca').remove([anterior]).catch(() => {});
    }
    return cfg;
  };

  /** Vuelve al logo por defecto de assets/ sin tocar el resto de la marca. */
  const quitarLogo = async () => {
    const anterior = (await getConfig()).logo_ruta;
    const cfg = await setConfig({ logo_url: '', logo_ruta: '' });
    if (anterior) await sb.storage.from('marca').remove([anterior]).catch(() => {});
    return cfg;
  };

  /* ======================================================================
     PACIENTES
     ====================================================================== */
  const _proximaCitaDe = async (pacienteId) => {
    const rows = ok(await sb.from('citas').select('*')
      .eq('paciente_id', pacienteId).eq('estado', 'agendada')
      .gte('inicia_en', new Date().toISOString())
      .order('inicia_en', { ascending: true }).limit(1));
    return rows[0] || null;
  };

  /** Usa la vista `pacientes_ordenados`, que ya viene ordenada por última asistencia. */
  const listarPacientes = async ({ q = '' } = {}) => {
    let query = sb.from('pacientes_ordenados').select('*');
    if (q.trim()) query = query.or(`nombre.ilike.%${q}%,diagnostico.ilike.%${q}%,telefono.ilike.%${q}%`);
    const rows = ok(await query);
    return rows.map((p) => ({ ...p, proxima_cita: null }));
  };

  const obtenerPaciente = async (id) => {
    const rows = ok(await sb.from('pacientes_ordenados').select('*').eq('id', id).limit(1));
    if (!rows.length) return null;
    return { ...rows[0], proxima_cita: await _proximaCitaDe(id) };
  };

  const crearPaciente = async (data) =>
    ok(await sb.from('pacientes').insert(data).select().single());

  const actualizarPaciente = async (id, patch) =>
    ok(await sb.from('pacientes').update(patch).eq('id', id).select().single());

  const eliminarPaciente = async (id) => {
    ok(await sb.from('pacientes').delete().eq('id', id));  // cascada por FK
    return true;
  };

  /* ======================================================================
     CITAS
     ====================================================================== */
  const _conNombre = (rows) =>
    rows.map((c) => ({ ...c, paciente_nombre: c.pacientes ? c.pacientes.nombre : '—', paciente: c.pacientes || null }));

  const SELECT_CITA = '*, pacientes(id, nombre, telefono, diagnostico)';

  const citasDeHoy = async () => {
    const hoy = isoDay(new Date());
    return _conNombre(ok(await sb.from('citas').select(SELECT_CITA)
      .gte('inicia_en', `${hoy}T00:00:00`)
      .lte('inicia_en', `${hoy}T23:59:59`)
      .order('inicia_en', { ascending: true })));
  };

  const proximasCitas = async ({ dias = 14, limite = 50 } = {}) =>
    _conNombre(ok(await sb.from('citas').select(SELECT_CITA)
      .eq('estado', 'agendada')
      .gte('inicia_en', new Date().toISOString())
      .lte('inicia_en', addDays(new Date(), dias).toISOString())
      .order('inicia_en', { ascending: true }).limit(limite)));

  const citasDePaciente = async (pacienteId) =>
    _conNombre(ok(await sb.from('citas').select(SELECT_CITA)
      .eq('paciente_id', pacienteId).order('inicia_en', { ascending: false })));

  const proximaCitaDePaciente = async (pacienteId) => {
    const c = await _proximaCitaDe(pacienteId);
    if (!c) return null;
    const p = ok(await sb.from('pacientes').select('nombre').eq('id', pacienteId).single());
    return { ...c, paciente_nombre: p.nombre };
  };

  const crearCita = async (data) => ok(await sb.from('citas').insert(data).select().single());
  const actualizarCita = async (id, patch) => ok(await sb.from('citas').update(patch).eq('id', id).select().single());
  const eliminarCita = async (id) => { ok(await sb.from('citas').delete().eq('id', id)); return true; };

  /* ======================================================================
     ASISTENCIAS
     El trigger `trg_boletos_asistencia` de la BD emite los boletos y
     descuenta el paquete automáticamente. Aquí solo insertamos.
     ====================================================================== */
  const registrarAsistencia = async ({ paciente_id, cita_id = null, fecha = null, monto = null, metodo = 'Efectivo', concepto = 'Sesión de fisioterapia', nota = '' }) => {
    const asistio_en = fecha ? new Date(fecha).toISOString() : new Date().toISOString();

    const asistencia = ok(await sb.from('asistencias')
      .insert({ paciente_id, cita_id, asistio_en, nota }).select().single());

    if (monto !== null && Number(monto) > 0) {
      ok(await sb.from('pagos').insert({ paciente_id, monto: Number(monto), metodo, concepto, pagado_en: asistio_en }));
    }
    if (cita_id) ok(await sb.from('citas').update({ estado: 'completada' }).eq('id', cita_id));

    // Boletos que generó el trigger
    const boletos = ok(await sb.from('boletos').select('*').eq('asistencia_id', asistencia.id));
    return { asistencia, boletos };
  };

  const asistenciasDePaciente = async (pacienteId) =>
    ok(await sb.from('asistencias').select('*').eq('paciente_id', pacienteId).order('asistio_en', { ascending: false }));

  const eliminarAsistencia = async (id) => { ok(await sb.from('asistencias').delete().eq('id', id)); return true; };

  /* ======================================================================
     INGRESOS
     ====================================================================== */
  const registrarPago = async ({ paciente_id, monto, metodo = 'Efectivo', concepto = 'Sesión de fisioterapia', fecha = null }) =>
    ok(await sb.from('pagos').insert({
      paciente_id, monto: Number(monto) || 0, metodo, concepto,
      pagado_en: fecha ? new Date(fecha).toISOString() : new Date().toISOString()
    }).select().single());

  const ingresosSemana = async (ref = new Date()) => {
    const ini = startOfWeek(ref);
    const fin = addDays(ini, 6);
    const iniPrev = addDays(ini, -7);

    const [actual, previa] = await Promise.all([
      sb.rpc('ingresos_por_dia', { p_desde: isoDay(ini), p_hasta: isoDay(fin) }).then(ok),
      sb.rpc('ingresos_por_dia', { p_desde: isoDay(iniPrev), p_hasta: isoDay(addDays(iniPrev, 6)) }).then(ok)
    ]);

    const total = actual.reduce((s, d) => s + Number(d.total), 0);
    const semanaAnterior = previa.reduce((s, d) => s + Number(d.total), 0);
    const hoy = isoDay(new Date());

    const porDia = actual.map((d) => {
      const fecha = new Date(d.dia + 'T12:00:00');
      return { fecha: d.dia, label: UI.DIAS_S[fecha.getDay()], esHoy: d.dia === hoy, total: Number(d.total) };
    });

    return {
      total, porDia, semanaAnterior,
      variacion: semanaAnterior > 0 ? Math.round(((total - semanaAnterior) / semanaAnterior) * 100) : null,
      inicio: ini.toISOString(), fin: fin.toISOString()
    };
  };

  const pagosDePaciente = async (pacienteId) =>
    ok(await sb.from('pagos').select('*').eq('paciente_id', pacienteId).order('pagado_en', { ascending: false }));

  /* ======================================================================
     VALORACIONES
     ====================================================================== */
  const valoracionDePaciente = async (pacienteId) => {
    const rows = ok(await sb.from('valoraciones').select('*')
      .eq('paciente_id', pacienteId).order('creado_en', { ascending: false }).limit(1));
    return rows[0] || null;
  };

  const guardarValoracion = async (pacienteId, { secciones_activas, datos, id = null }) => {
    if (id) {
      return ok(await sb.from('valoraciones')
        .update({ secciones_activas, datos, actualizado_en: new Date().toISOString() })
        .eq('id', id).select().single());
    }
    return ok(await sb.from('valoraciones')
      .insert({ paciente_id: pacienteId, secciones_activas, datos }).select().single());
  };

  /* ======================================================================
     NOTAS + ADJUNTOS (Supabase Storage)
     ====================================================================== */

  /** Sube un dataURL al bucket `evidencias` y devuelve una URL firmada. */
  const _subirEvidencia = async (dataUrl, pacienteId) => {
    const blob = await (await fetch(dataUrl)).blob();
    const ruta = `${pacienteId}/${uid('img')}.jpg`;
    ok(await sb.storage.from('evidencias').upload(ruta, blob, { contentType: 'image/jpeg', upsert: false }));
    const { data } = await sb.storage.from('evidencias').createSignedUrl(ruta, 60 * 60 * 24 * 365);
    return { ruta, url: data.signedUrl };
  };

  const notasDePaciente = async (pacienteId) =>
    ok(await sb.from('notas').select('*').eq('paciente_id', pacienteId).order('creado_en', { ascending: false }));

  const crearNota = async ({ paciente_id, texto, eva = null, tipo = 'evolucion', adjuntos = [] }) => {
    const subidos = [];
    for (const a of adjuntos) {
      const r = a.url.startsWith('data:') ? await _subirEvidencia(a.url, paciente_id) : { url: a.url, ruta: null };
      subidos.push({ id: uid('adj'), url: r.url, ruta: r.ruta, titulo: a.titulo || 'Evidencia', creado_en: new Date().toISOString() });
    }
    return ok(await sb.from('notas').insert({ paciente_id, tipo, texto, eva, adjuntos: subidos }).select().single());
  };

  const agregarAdjunto = async (notaId, { url, titulo = 'Evidencia' }) => {
    const nota = ok(await sb.from('notas').select('*').eq('id', notaId).single());
    const r = url.startsWith('data:') ? await _subirEvidencia(url, nota.paciente_id) : { url, ruta: null };
    const adjuntos = [...(nota.adjuntos || []), { id: uid('adj'), url: r.url, ruta: r.ruta, titulo, creado_en: new Date().toISOString() }];
    return ok(await sb.from('notas').update({ adjuntos }).eq('id', notaId).select().single());
  };

  const eliminarNota = async (id) => { ok(await sb.from('notas').delete().eq('id', id)); return true; };

  /* ======================================================================
     RUTINAS
     ====================================================================== */
  const SELECT_RUTINA = '*, rutina_items(*, ejercicios(*))';

  const _mapRutina = (r) => ({
    ...r,
    items: (r.rutina_items || []).sort((a, b) => a.orden - b.orden).map((it) => ({
      ...it,
      ejercicio: it.ejercicios || Store.ejercicio(it.ejercicio_id) || { nombre: '—', categoria: 'Movilidad', image_url: '', descripcion: '' }
    }))
  });

  const rutinasDePaciente = async (pacienteId) =>
    ok(await sb.from('rutinas').select(SELECT_RUTINA)
      .eq('paciente_id', pacienteId).order('creado_en', { ascending: false })).map(_mapRutina);

  const rutinaActiva = async (pacienteId) => {
    const rows = ok(await sb.from('rutinas').select(SELECT_RUTINA)
      .eq('paciente_id', pacienteId).eq('activa', true).order('creado_en', { ascending: false }).limit(1));
    return rows.length ? _mapRutina(rows[0]) : null;
  };

  const guardarRutina = async (pacienteId, { titulo, notas = '', items = [], id = null }) => {
    let rutinaId = id;
    if (rutinaId) {
      ok(await sb.from('rutinas').update({ titulo, notas, activa: true }).eq('id', rutinaId));
      ok(await sb.from('rutina_items').delete().eq('rutina_id', rutinaId));
    } else {
      const r = ok(await sb.from('rutinas').insert({ paciente_id: pacienteId, titulo, notas, activa: true }).select().single());
      rutinaId = r.id;
    }

    if (items.length) {
      ok(await sb.from('rutina_items').insert(items.map((it, i) => ({
        rutina_id: rutinaId, ejercicio_id: it.ejercicio_id, orden: i,
        series: Number(it.series) || 0, reps: Number(it.reps) || 0, hold: Number(it.hold) || 0,
        frecuencia: it.frecuencia || 'Diario', nota: it.nota || ''
      }))));
    }
    // El trigger `trg_una_rutina_activa` desactiva las demás
    const r = ok(await sb.from('rutinas').select(SELECT_RUTINA).eq('id', rutinaId).single());
    return _mapRutina(r);
  };

  const activarRutina = async (rutinaId) => {
    ok(await sb.from('rutinas').update({ activa: true }).eq('id', rutinaId));
    return _mapRutina(ok(await sb.from('rutinas').select(SELECT_RUTINA).eq('id', rutinaId).single()));
  };

  const eliminarRutina = async (rutinaId) => { ok(await sb.from('rutinas').delete().eq('id', rutinaId)); return true; };

  /* ======================================================================
     PROMOCIONES
     ====================================================================== */
  const _vigente = (p) => { const n = new Date(); return p.activa && new Date(p.desde) <= n && new Date(p.hasta) >= n; };

  const listarPromociones = async ({ soloVigentes = false } = {}) => {
    let list = ok(await sb.from('promociones').select('*').order('desde', { ascending: false }))
      .map((p) => ({ ...p, vigente: _vigente(p) }));
    if (soloVigentes) list = list.filter((p) => p.vigente);
    return list.sort((a, b) => Number(b.vigente) - Number(a.vigente));
  };

  const guardarPromocion = async (data) => data.id
    ? ok(await sb.from('promociones').update(data).eq('id', data.id).select().single())
    : ok(await sb.from('promociones').insert(data).select().single());

  const eliminarPromocion = async (id) => { ok(await sb.from('promociones').delete().eq('id', id)); return true; };

  /* ======================================================================
     SORTEOS
     ====================================================================== */
  const _decorarSorteo = async (s) => {
    const [{ count: totalBoletos }, boletos] = await Promise.all([
      sb.from('boletos').select('*', { count: 'exact', head: true }).eq('sorteo_id', s.id),
      sb.from('boletos').select('paciente_id').eq('sorteo_id', s.id).then(ok)
    ]);
    const ganador = s.ganador_paciente_id
      ? ok(await sb.from('pacientes').select('nombre').eq('id', s.ganador_paciente_id).single())
      : null;
    const now = new Date();
    return {
      ...s,
      total_boletos: totalBoletos || 0,
      total_participantes: new Set(boletos.map((b) => b.paciente_id)).size,
      ganador_nombre: ganador ? ganador.nombre : null,
      vigente: s.estado === 'activo' && new Date(s.inicia_en) <= now && new Date(s.termina_en) >= now,
      cerrado: new Date(s.termina_en) < now,
      dias_restantes: Math.max(0, Math.ceil((new Date(s.termina_en) - now) / 86400000))
    };
  };

  const listarSorteos = async ({ soloPublicados = false } = {}) => {
    let q = sb.from('sorteos').select('*').order('termina_en', { ascending: false });
    if (soloPublicados) q = q.eq('publicado', true);
    const rows = ok(await q);
    const list = await Promise.all(rows.map(_decorarSorteo));
    return list.sort((a, b) => Number(b.estado === 'activo') - Number(a.estado === 'activo'));
  };

  const obtenerSorteo = async (id) => {
    const s = ok(await sb.from('sorteos').select('*').eq('id', id).single());
    return _decorarSorteo(s);
  };

  const guardarSorteo = async (data) => {
    const s = data.id
      ? ok(await sb.from('sorteos').update(data).eq('id', data.id).select().single())
      : ok(await sb.from('sorteos').insert(data).select().single());
    await sincronizarBoletos(s.id);
    return _decorarSorteo(ok(await sb.from('sorteos').select('*').eq('id', s.id).single()));
  };

  const eliminarSorteo = async (id) => { ok(await sb.from('sorteos').delete().eq('id', id)); return true; };

  const sincronizarBoletos = async (sorteoId) => {
    const r = ok(await sb.rpc('sincronizar_boletos', { p_sorteo: sorteoId }));
    return { creados: r?.[0]?.creados ?? 0, eliminados: r?.[0]?.eliminados ?? 0 };
  };

  const participantesDeSorteo = async (sorteoId) => {
    const rows = ok(await sb.from('boletos').select('codigo, paciente_id, pacientes(nombre)').eq('sorteo_id', sorteoId));
    const map = new Map();
    rows.forEach((b) => {
      if (!map.has(b.paciente_id)) map.set(b.paciente_id, { paciente_id: b.paciente_id, nombre: b.pacientes?.nombre || '—', boletos: [] });
      map.get(b.paciente_id).boletos.push(b.codigo);
    });
    return [...map.values()].map((r) => ({ ...r, total: r.boletos.length }))
      .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre));
  };

  const realizarSorteo = async (sorteoId) => {
    const r = ok(await sb.rpc('realizar_sorteo', { p_sorteo: sorteoId }));
    const g = r[0];
    return {
      sorteo: await obtenerSorteo(sorteoId),
      ganador: { paciente_id: g.paciente_id, nombre: g.nombre, codigo: g.codigo, total_boletos: Number(g.total_boletos) }
    };
  };

  const publicarGanador = async (sorteoId, publicado = true) => {
    ok(await sb.from('sorteos').update({ publicado }).eq('id', sorteoId));
    return obtenerSorteo(sorteoId);
  };

  const misBoletos = async (pacienteId) => {
    const sorteos = ok(await sb.from('sorteos').select('*').eq('publicado', true).order('termina_en', { ascending: false }));
    const list = await Promise.all(sorteos.map(async (s) => {
      const d = await _decorarSorteo(s);
      const mios = ok(await sb.from('boletos').select('codigo').eq('sorteo_id', s.id).eq('paciente_id', pacienteId));
      return {
        ...d,
        mis_boletos: mios.map((b) => b.codigo),
        mis_boletos_total: mios.length,
        soy_ganador: s.ganador_paciente_id === pacienteId
      };
    }));
    return list.sort((a, b) => Number(b.estado === 'activo') - Number(a.estado === 'activo'));
  };

  /* ======================================================================
     VITRINA COMERCIAL
     Lo que ve quien se registró por su cuenta y todavía no tiene expediente.
     No expone conteos de boletos: un paciente solo puede leer los suyos por
     RLS, así que cualquier total que calculara aquí sería engañoso.
     ====================================================================== */
  const sorteosVitrina = async () => {
    const now = new Date();
    const rows = ok(await sb.from('sorteos').select('*')
      .eq('publicado', true).order('termina_en', { ascending: false }));

    return rows.map((s) => ({
      ...s,
      vigente: s.estado === 'activo' && new Date(s.inicia_en) <= now && new Date(s.termina_en) >= now,
      dias_restantes: Math.max(0, Math.ceil((new Date(s.termina_en) - now) / 86400000))
    })).sort((a, b) => Number(b.vigente) - Number(a.vigente));
  };

  /* ======================================================================
     SOLICITUDES DE CITA
     Única escritura permitida al rol paciente (política `pac_crea_solicitud`).
     ====================================================================== */
  const crearSolicitudCita = async ({ nombre, telefono = '', motivo = '', preferencia = '' }) => {
    const u = (await sb.auth.getUser()).data.user;
    if (!u) throw new Error('Sesión no iniciada.');
    if (!String(nombre || '').trim()) throw new Error('Escribe tu nombre completo.');

    return ok(await sb.from('solicitudes_cita').insert({
      usuario_id: u.id,               // la política RLS exige que sea el propio
      nombre: String(nombre).trim(),
      telefono: String(telefono).trim(),
      email: u.email,
      motivo: String(motivo).trim(),
      preferencia: String(preferencia).trim(),
      estado: 'nueva'
    }).select().single());
  };

  /** Solicitudes de la sesión actual (RLS las limita a las propias). */
  const misSolicitudes = async () => {
    const r = await opcional(
      sb.from('solicitudes_cita').select('*').order('creado_en', { ascending: false }),
      { data: [], error: null });
    return r.data || [];
  };

  const listarSolicitudes = async ({ estado = null } = {}) => {
    let q = sb.from('solicitudes_cita').select('*').order('creado_en', { ascending: false });
    if (estado) q = q.eq('estado', estado);
    const r = await opcional(q, { data: [], error: null });
    return r.data || [];
  };

  const actualizarSolicitud = async (id, patch) =>
    ok(await sb.from('solicitudes_cita').update(patch).eq('id', id).select().single());

  /**
   * Convierte una solicitud en expediente. Lo resuelve la función
   * `convertir_solicitud` en el servidor, que reutiliza el expediente si ya
   * existía uno con ese correo en vez de duplicarlo.
   * @returns {string} id del paciente
   */
  const convertirSolicitud = async (id) => {
    const { data, error } = await sb.rpc('convertir_solicitud', { p_solicitud: id });
    if (error) {
      if (_esFalta(error)) {
        throw new Error('Falta la función «convertir_solicitud». Ejecuta supabase/schema.sql completo en el SQL Editor de Supabase.');
      }
      throw new Error(error.message);
    }
    return data;
  };

  /* ======================================================================
     DASHBOARD
     ====================================================================== */
  const resumenDashboard = async () => {
    const hoy = isoDay(new Date());
    const semanaIni = startOfWeek(new Date()).toISOString();

    const [ingresos, citasHoy, atendidosHoy, atendidosSemana, pacientesActivos, sorteosActivos, promos, pagosSemana, solicitudes] =
      await Promise.all([
        ingresosSemana(),
        citasDeHoy(),
        sb.from('asistencias').select('*', { count: 'exact', head: true })
          .gte('asistio_en', `${hoy}T00:00:00`).lte('asistio_en', `${hoy}T23:59:59`),
        sb.from('asistencias').select('*', { count: 'exact', head: true }).gte('asistio_en', semanaIni),
        sb.from('pacientes').select('*', { count: 'exact', head: true }).eq('activo', true),
        sb.from('sorteos').select('*', { count: 'exact', head: true }).eq('estado', 'activo'),
        listarPromociones({ soloVigentes: true }),
        sb.from('pagos').select('monto').gte('pagado_en', semanaIni).then(ok),
        // Tabla añadida después del primer despliegue: si aún no existe, 0.
        opcional(sb.from('solicitudes_cita').select('*', { count: 'exact', head: true }).eq('estado', 'nueva'),
                 { count: 0, error: null })
      ]);

    return {
      ingresos,
      citas_hoy: citasHoy,
      citas_hoy_total: citasHoy.length,
      citas_hoy_pendientes: citasHoy.filter((c) => c.estado === 'agendada').length,
      atendidos_hoy: atendidosHoy.count || 0,
      atendidos_semana: atendidosSemana.count || 0,
      pacientes_activos: pacientesActivos.count || 0,
      sorteos_activos: sorteosActivos.count || 0,
      promos_vigentes: promos.length,
      solicitudes_nuevas: solicitudes.count || 0,
      ticket_promedio: pagosSemana.length
        ? Math.round(pagosSemana.reduce((s, p) => s + Number(p.monto), 0) / pagosSemana.length) : 0
    };
  };

  /* ======================================================================
     EXPORT · sobrescribe window.API manteniendo la misma firma
     ====================================================================== */
  /* ======================================================================
     CONTROL DE ACCESO EN CLIENTE
     Espejo de las políticas RLS de supabase/schema.sql. Sirve para cortar
     antes de salir a la red y para dar mensajes claros.

     ⚠ NO es la medida de seguridad: la autoridad es RLS, en el servidor.
       Aunque alguien saltara este guardia editando el JavaScript, PostgreSQL
       seguiría negando las filas ajenas.
     ====================================================================== */

  const SOLO_FISIO = [
    'listarPacientes', 'crearPaciente', 'actualizarPaciente', 'eliminarPaciente',
    'citasDeHoy', 'proximasCitas', 'crearCita', 'actualizarCita', 'eliminarCita',
    'registrarAsistencia', 'eliminarAsistencia', 'registrarPago', 'ingresosSemana',
    'guardarValoracion', 'crearNota', 'agregarAdjunto', 'eliminarNota',
    'guardarRutina', 'activarRutina', 'eliminarRutina',
    'guardarPromocion', 'eliminarPromocion',
    'listarSorteos', 'obtenerSorteo', 'guardarSorteo', 'eliminarSorteo',
    'sincronizarBoletos', 'participantesDeSorteo', 'realizarSorteo', 'publicarGanador',
    'listarSolicitudes', 'actualizarSolicitud', 'convertirSolicitud',
    'resumenDashboard',
    'setConfig', 'subirLogo', 'quitarLogo'
  ];

  // El paciente solo accede a lo suyo. El valor es la posición del argumento
  // que lleva el id de paciente.
  const SOLO_PROPIO = {
    obtenerPaciente: 0, citasDePaciente: 0, proximaCitaDePaciente: 0,
    asistenciasDePaciente: 0, pagosDePaciente: 0,
    valoracionDePaciente: 0, notasDePaciente: 0,
    rutinasDePaciente: 0, rutinaActiva: 0, misBoletos: 0
  };

  // Abiertas a cualquier sesión (la RLS ya las acota por sí sola):
  //   listarPromociones · miPaciente
  //   sorteosVitrina · crearSolicitudCita · misSolicitudes

  async function _autorizar(nombre, args) {
    if (!_sesion) await auth.sesion();          // primera llamada tras recargar
    if (!_sesion) throw new Error('Sesión no iniciada.');

    const rol = _sesion.perfil.rol;
    if (rol === 'fisio') return;

    if (SOLO_FISIO.includes(nombre)) {
      throw new Error('Acceso denegado: esta información es exclusiva del fisioterapeuta.');
    }
    if (nombre in SOLO_PROPIO) {
      const pedido = args[SOLO_PROPIO[nombre]];
      if (!pedido || pedido !== _miPacienteId) {
        throw new Error('Acceso denegado: no puedes consultar el expediente de otro paciente.');
      }
    }
  }

  function _proteger(api) {
    const salida = {};
    for (const [nombre, fn] of Object.entries(api)) {
      if (typeof fn !== 'function') { salida[nombre] = fn; continue; }
      salida[nombre] = async (...args) => {
        await _autorizar(nombre, args);
        return fn(...args);
      };
    }
    return salida;
  }

  /* ======================================================================
     EXPORT
     ====================================================================== */
  global.API = Object.assign(_proteger({
    setConfig, subirLogo, quitarLogo,
    listarPacientes, obtenerPaciente, crearPaciente, actualizarPaciente, eliminarPaciente,
    citasDeHoy, proximasCitas, citasDePaciente, proximaCitaDePaciente, crearCita, actualizarCita, eliminarCita,
    registrarAsistencia, asistenciasDePaciente, eliminarAsistencia,
    registrarPago, ingresosSemana, pagosDePaciente,
    valoracionDePaciente, guardarValoracion,
    notasDePaciente, crearNota, agregarAdjunto, eliminarNota,
    rutinasDePaciente, rutinaActiva, guardarRutina, activarRutina, eliminarRutina,
    listarPromociones, guardarPromocion, eliminarPromocion,
    listarSorteos, obtenerSorteo, guardarSorteo, eliminarSorteo,
    sincronizarBoletos, participantesDeSorteo, realizarSorteo, publicarGanador, misBoletos,
    sorteosVitrina, crearSolicitudCita, misSolicitudes,
    listarSolicitudes, actualizarSolicitud, convertirSolicitud,
    resumenDashboard
  }), {
    // Fuera del guardia: deben funcionar SIN sesión previa.
    // `getConfig` está aquí porque la pantalla de acceso pinta la marca antes
    // de que exista sesión; su lectura ya es pública por RLS.
    _impl: 'supabase',
    sb,
    auth,
    getConfig,
    miPaciente,
    faltaEnEsquema
  });

  console.info('[CLIDANFI] API conectada a Supabase.');
})(window);
