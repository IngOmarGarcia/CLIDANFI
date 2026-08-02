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

  /** Lanza si la consulta falló; si no, devuelve los datos. */
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

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

    registrar: async (email, password, nombre) => {
      const { data, error } = await sb.auth.signUp({
        email: String(email || '').trim().toLowerCase(), password,
        options: { data: { nombre } }
      });
      if (error) throw new Error(error.message);
      return data;
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
     CONFIGURACIÓN  (se guarda local: son preferencias de UI)
     ====================================================================== */
  const CFG_KEY = 'clidanfi.config';
  const CFG_DEF = { clinica: 'CLIDANFI', lema: 'Fisioterapia y rehabilitación', fisio: '', precio_sesion: 450 };

  const getConfig = async () => {
    const cfg = { ...CFG_DEF };
    try { Object.assign(cfg, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); } catch { /* preferencias corruptas */ }
    if (!cfg.fisio) {
      const s = await auth.sesion();
      cfg.fisio = s ? s.perfil.nombre : '';
    }
    return cfg;
  };

  const setConfig = async (patch) => {
    const cfg = { ...(await getConfig()), ...patch };
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
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
     DASHBOARD
     ====================================================================== */
  const resumenDashboard = async () => {
    const hoy = isoDay(new Date());
    const semanaIni = startOfWeek(new Date()).toISOString();

    const [ingresos, citasHoy, atendidosHoy, atendidosSemana, pacientesActivos, sorteosActivos, promos, pagosSemana] =
      await Promise.all([
        ingresosSemana(),
        citasDeHoy(),
        sb.from('asistencias').select('*', { count: 'exact', head: true })
          .gte('asistio_en', `${hoy}T00:00:00`).lte('asistio_en', `${hoy}T23:59:59`),
        sb.from('asistencias').select('*', { count: 'exact', head: true }).gte('asistio_en', semanaIni),
        sb.from('pacientes').select('*', { count: 'exact', head: true }).eq('activo', true),
        sb.from('sorteos').select('*', { count: 'exact', head: true }).eq('estado', 'activo'),
        listarPromociones({ soloVigentes: true }),
        sb.from('pagos').select('monto').gte('pagado_en', semanaIni).then(ok)
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
    'resumenDashboard'
  ];

  // El paciente solo accede a lo suyo. El valor es la posición del argumento
  // que lleva el id de paciente.
  const SOLO_PROPIO = {
    obtenerPaciente: 0, citasDePaciente: 0, proximaCitaDePaciente: 0,
    asistenciasDePaciente: 0, pagosDePaciente: 0,
    valoracionDePaciente: 0, notasDePaciente: 0,
    rutinasDePaciente: 0, rutinaActiva: 0, misBoletos: 0
  };

  // Abiertas a cualquier sesión: getConfig, setConfig, listarPromociones, miPaciente

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
    getConfig, setConfig,
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
    resumenDashboard
  }), {
    // Fuera del guardia: deben funcionar SIN sesión previa.
    _impl: 'supabase',
    sb,
    auth,
    miPaciente
  });

  console.info('[CLIDANFI] API conectada a Supabase.');
})(window);
