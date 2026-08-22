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
  /* Registro de objetos CONFIRMADOS ausentes. Es un conjunto, no una bandera
     suelta, porque antes cualquier fallo dejaba pegado un único nombre —
     casi siempre el equivocado— para el resto de la sesión. */
  const _faltan = new Set();

  /* Códigos de PostgreSQL / PostgREST. Son la fuente fiable: el texto del
     mensaje cambia entre versiones y se presta a falsos positivos. */
  const _COD_AUSENTE = ['42P01', '42883', 'PGRST202', 'PGRST205'];  // relación o función inexistente
  const _COD_PERMISO = ['42501', 'PGRST301'];                       // GRANT o política RLS

  const _codigo = (e) => String((e && e.code) || '');
  const _texto = (e) => String((e && e.message) || '');

  /**
   * ¿El error dice, SIN AMBIGÜEDAD, que el objeto no existe en la base?
   *
   * Antes esto aceptaba cualquier mensaje con «does not exist», «schema cache»
   * o «Not Found», y por ahí se colaban cosas que no son una tabla ausente:
   *   · 42703 / PGRST204 → falta una COLUMNA, la tabla está perfectamente
   *   · «Not Found» a secas → un 404 del proxy, de la CDN o de una URL mal puesta
   *   · un 404 transitorio mientras PostgREST recarga su caché tras un deploy
   * Todos ellos hacían aparecer el aviso de «base desactualizada» sin motivo.
   */
  const _esFalta = (error) => {
    if (!error) return false;
    const cod = _codigo(error);
    if (cod) return _COD_AUSENTE.includes(cod);   // hay código: manda el código
    // Sin código solo aceptamos la frase completa, nunca un fragmento suelto.
    const t = _texto(error);
    return /relation "[^"]*" does not exist/i.test(t)
        || /(?:table|function|relation) [^\s]+ does not exist/i.test(t)
        || /could not find the (?:table|function) '[^']*' in the schema cache/i.test(t);
  };

  /** ¿El error es «esa COLUMNA no existe / no la veo»? La tabla sí existe. */
  const _esColumna = (error) => {
    if (!error) return false;
    const cod = _codigo(error);
    if (cod) return cod === '42703' || cod === 'PGRST204';
    return /column [^\s]+ does not exist/i.test(_texto(error))
        || /could not find the '[^']*' column/i.test(_texto(error));
  };

  /** ¿El error es «la tabla existe pero no te dejo»? (RLS o GRANT) */
  const _esPermiso = (error) => {
    if (!error) return false;
    const cod = _codigo(error);
    if (cod) return _COD_PERMISO.includes(cod);
    return /permission denied|row-level security/i.test(_texto(error));
  };

  /** Saca del mensaje el nombre real del objeto; `respaldo` si no se deduce. */
  const _nombreDelObjeto = (error, respaldo = null) => {
    const t = _texto(error);
    const m = t.match(/relation "(?:public\.)?(\w+)"/i)
           || t.match(/(?:table|function) '(?:public\.)?(\w+)'/i)
           || t.match(/(?:for|on) (?:table|relation) "?(\w+)"?/i)
           || t.match(/function (?:public\.)?(\w+)\s*\(/i);
    return (m && m[1]) || respaldo || 'una tabla o función';
  };

  const _marcarFalta = (nombre) => { if (nombre) _faltan.add(nombre); };
  /* Si el objeto respondió —aunque fuera para negar permiso— EXISTE, y todo
     aviso previo sobre él queda obsoleto. Esto es lo que hace que el cartel
     desaparezca solo en cuanto la base se pone al día, sin recargar. */
  const _marcarPresente = (nombre) => { if (nombre) _faltan.delete(nombre); };

  const _errPermiso = (nombre) => new Error(
    `Sin permiso sobre «${nombre}»: la tabla existe pero las políticas RLS o los ` +
    'GRANT no dejan pasar esta operación. Revísalas en Supabase → SQL Editor.'
  );

  const _errFalta = (nombre) => new Error(
    `Tu base de datos está desactualizada: falta «${nombre}». ` +
    'Ejecuta supabase/schema.sql completo en el SQL Editor de Supabase.'
  );

  /** Lanza si la consulta falló; si no, devuelve los datos. */
  const ok = ({ data, error }) => {
    if (error) {
      if (_esFalta(error)) {
        const nombre = _nombreDelObjeto(error);
        _marcarFalta(nombre);
        throw _errFalta(nombre);
      }
      if (_esPermiso(error)) throw _errPermiso(_nombreDelObjeto(error));
      throw new Error(error.message);
    }
    return data;
  };

  /**
   * Envuelve una consulta que puede no existir todavía en la base.
   * Si falta el objeto devuelve `porDefecto` en vez de tumbar la pantalla.
   *
   * @param {Promise} promesa        consulta de PostgREST
   * @param {*}       porDefecto     qué devolver si el objeto no existe
   * @param {object}  opts
   * @param {string}  opts.objeto    a QUÉ tabla apunta esta consulta. Antes se
   *   escribía 'solicitudes_cita' a fuego para las tres llamadas, así que un
   *   tropiezo en `configuracion` acusaba a `solicitudes_cita`: ese era el
   *   falso positivo que veías en el panel.
   * @param {boolean} opts.tolerarPermiso  si un 42501 debe degradar en vez de
   *   lanzar (para adornos del panel, no para pantallas de contenido).
   * @param {boolean} opts.tolerarColumna  si una columna ausente (42703) debe
   *   degradar. Solo para consultas con valores por defecto completos.
   */
  const opcional = async (promesa, porDefecto,
                          { objeto = null, tolerarPermiso = false, tolerarColumna = false } = {}) => {
    // Un fallo de red o una excepción del cliente NO son un esquema viejo:
    // se dejan subir tal cual en vez de disfrazarse de «falta una tabla».
    const res = await promesa;

    if (res && res.error) {
      if (_esFalta(res.error)) {
        _marcarFalta(_nombreDelObjeto(res.error, objeto));
        return porDefecto;
      }
      if (_esPermiso(res.error)) {
        _marcarPresente(objeto);            // respondió ⇒ la tabla está ahí
        if (tolerarPermiso) return porDefecto;
        throw _errPermiso(_nombreDelObjeto(res.error, objeto));
      }
      if (_esColumna(res.error)) {
        _marcarPresente(objeto);            // la tabla está; le falta una columna
        if (tolerarColumna) return porDefecto;
        throw new Error(res.error.message);
      }
      throw new Error(res.error.message);
    }

    _marcarPresente(objeto);
    return res;
  };

  /**
   * Escribe tolerando que la base todavía no tenga las columnas más nuevas.
   *
   * Las funciones añadidas después del primer despliegue (precio por cita,
   * expediente exprés, motivo de cancelación) traen columnas nuevas. Si el
   * proyecto de Supabase no ha corrido el schema.sql actualizado, PostgREST
   * responde 42703/PGRST204 y la operación ENTERA se perdería —incluida la
   * parte que sí cabía—. Aquí se reintenta sin las columnas opcionales: la
   * cita se agenda igual, solo sin su precio, y se avisa por consola.
   *
   * @param {(fila:object) => Promise} ejecutar   consulta ya construida
   * @param {object}   fila         datos completos
   * @param {string[]} opcionales   columnas que se pueden sacrificar
   */
  const _escrituraTolerante = async (ejecutar, fila, opcionales) => {
    const res = await ejecutar(fila);
    if (!res || !res.error || !_esColumna(res.error)) return ok(res);

    const podada = { ...fila };
    const quitadas = opcionales.filter((c) => c in podada);
    quitadas.forEach((c) => { delete podada[c]; });
    if (!quitadas.length) return ok(res);

    console.warn(`[CLIDANFI] Tu base no tiene todavía ${quitadas.join(', ')}. ` +
      'Se guarda sin ese dato; ejecuta supabase/schema.sql para habilitarlo.');
    return ok(await ejecutar(podada));
  };

  /**
   * Valida un importe antes de que salga a la red.
   * Un `Number('abc')` da NaN y PostgREST lo rechazaría con un error opaco;
   * un negativo entraría tan campante y dejaría torcida la gráfica de ingresos.
   */
  const _importe = (valor, campo = 'El monto') => {
    if (valor === '' || valor === null || valor === undefined) {
      throw new Error(`${campo} es obligatorio.`);
    }
    const n = Number(valor);
    if (!Number.isFinite(n)) throw new Error(`${campo} debe ser una cantidad válida.`);
    if (n < 0) throw new Error(`${campo} no puede ser negativo.`);
    return Math.round(n * 100) / 100;
  };

  /* --- Verificación activa del esquema ----------------------------------
     El panel ya no se fía del historial de errores acumulado: pregunta.
     La distinción que importa es la que antes no se hacía:
       · sin error, o error de permiso (42501) → la tabla EXISTE
       · 42P01 / PGRST205                      → la tabla NO existe
     Una tabla con RLS activa y sin política de SELECT devuelve 0 filas y
     NINGÚN error, así que jamás debe contarse como ausente. */
  const OBJETOS_VERIFICABLES = ['solicitudes_cita', 'configuracion'];

  const verificarEsquema = async () => {
    await Promise.all(OBJETOS_VERIFICABLES.map(async (tabla) => {
      try {
        const { error } = await sb.from(tabla).select('*', { count: 'exact', head: true });
        if (error && _esFalta(error)) _marcarFalta(tabla);
        else _marcarPresente(tabla);
      } catch {
        // Caída de red: no se sabe nada nuevo, se respeta lo que ya constaba.
      }
    }));
    return faltaEnEsquema();
  };

  /** Nombre del objeto que falta en la base, o null si todo está al día. */
  const faltaEnEsquema = () => (_faltan.size ? [..._faltan].join(', ') : null);

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
      // `tolerarPermiso`: la marca se pinta en la pantalla de acceso, y ahí
      // `anon` solo tiene GRANT sobre las columnas públicas. Un 42501 aquí es
      // esperable y nunca debe tumbar el arranque ni acusar a otra tabla.
      //
      // La marca es decorativa y `CFG_DEF` la cubre entera, así que esta
      // lectura es «mejor esfuerzo»: ni un corte de red ni un 404 del proxy
      // deben dejar la app en blanco. Lo que NO hace ya es convertir ese
      // tropiezo en un aviso de esquema sobre otra tabla.
      let res = null;
      try {
        res = await opcional(
          sb.from('configuracion')
            .select(conSesion ? CFG_COLS_TODAS : CFG_COLS_PUBLICAS)
            .eq('id', 1).maybeSingle(),
          { data: null, error: null },
          { objeto: 'configuracion', tolerarPermiso: true, tolerarColumna: true }
        );
      } catch (e) {
        console.warn('[CLIDANFI] No se pudo leer `configuracion`, se usa la marca por defecto:', e.message);
      }
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

    // El precio de sesión es la tarifa que luego se propone en cada cobro:
    // si entra en blanco o negativo, contamina todos los cobros posteriores.
    if ('precio_sesion' in fila) fila.precio_sesion = _importe(fila.precio_sesion, 'El precio de sesión');

    _guardarEnCache(ok(await sb.from('configuracion').upsert(fila).select(CFG_COLS_TODAS).single()));
    _cfgCompleta = true;
    return getConfig();
  };

  /**
   * Convierte un dataURL en Blob decodificándolo aquí mismo.
   *
   * Antes esto era `await (await fetch(dataUrl)).blob()`, y el navegador
   * considera `fetch('data:…')` una CONEXIÓN: la gobierna `connect-src`, no
   * `img-src`. Con la CSP de producción eso se rechazaba y salía
   * «TypeError: Failed to fetch» sin que la petición llegara nunca a Supabase.
   * Decodificar en local no toca la red, así que funciona con cualquier CSP.
   */
  const _dataUrlABlob = (dataUrl) => {
    const s = String(dataUrl || '');
    const coma = s.indexOf(',');
    if (!s.startsWith('data:') || coma === -1) {
      throw new Error('La imagen no tiene un formato válido.');
    }

    const cabecera = s.slice(5, coma);              // p. ej. «image/jpeg;base64»
    const tipo = cabecera.split(';')[0] || 'application/octet-stream';
    const cuerpo = s.slice(coma + 1);

    // Las que produce UI.readImageCompressed son siempre base64, pero un
    // dataURL puede venir sin codificar (percent-encoding).
    if (!/;base64/i.test(cabecera)) {
      return new Blob([decodeURIComponent(cuerpo)], { type: tipo });
    }

    const binario = atob(cuerpo);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return new Blob([bytes], { type: tipo });
  };

  /**
   * Sube el logo al bucket público `marca` y deja su URL en la configuración.
   * Recibe el dataURL ya comprimido por UI.readImageCompressed.
   * El logo anterior se borra: no tiene sentido acumularlos.
   */
  const subirLogo = async (dataUrl) => {
    const anterior = (await getConfig()).logo_ruta;

    const blob = _dataUrlABlob(dataUrl);
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
    _escrituraTolerante((fila) => sb.from('pacientes').insert(fila).select().single(),
      data, ['expediente_pendiente']);

  /**
   * Alta exprés: la persona llega sin expediente y solo se le pide nombre y
   * teléfono para poder agendarla. La historia clínica queda marcada como
   * pendiente para que la ficha lo reclame después.
   *
   * No inventa paquete de sesiones (`paquete_total: 0`): cobrar por adelantado
   * un paquete que nadie ha contratado descuadraría el conteo de boletos.
   */
  const crearPacienteExpres = async ({ nombre, telefono = '', email = '', motivo = '' }) => {
    const limpio = String(nombre || '').trim();
    if (!limpio) throw new Error('Escribe al menos el nombre del paciente.');

    return crearPaciente({
      nombre: limpio,
      telefono: String(telefono || '').trim(),
      email: String(email || '').trim(),
      diagnostico: String(motivo || '').trim(),
      paquete_nombre: 'Sesión individual',
      paquete_total: 0,
      paquete_usadas: 0,
      expediente_pendiente: true
    });
  };

  const actualizarPaciente = async (id, patch) =>
    _escrituraTolerante((fila) => sb.from('pacientes').update(fila).eq('id', id).select().single(),
      patch, ['expediente_pendiente']);

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

  /* Columnas que pueden faltar si la base no está al día. Se sacrifican antes
     que perder la cita entera (ver `_escrituraTolerante`). */
  const CITA_COLS_NUEVAS = ['precio', 'cancelada_en', 'motivo_cancelacion',
    'cancelada_por', 'cancelada_por_usuario',
    'falta_en', 'falta_justificada', 'motivo_falta'];

  /** Quién puede figurar como responsable de una cancelación. */
  const CANCELA_QUIEN = ['Paciente', 'Clínica', 'Otro'];

  const _normalizarCita = (data) => {
    const fila = { ...data };
    // Precio vacío = «la tarifa de la clínica», y eso se escribe null, no 0:
    // un 0 significaría sesión gratuita y así se cobraría.
    if ('precio' in fila) {
      fila.precio = (fila.precio === '' || fila.precio === null || fila.precio === undefined)
        ? null
        : _importe(fila.precio, 'El precio de la cita');
    }
    return fila;
  };

  const crearCita = async (data) =>
    _escrituraTolerante((fila) => sb.from('citas').insert(fila).select().single(),
      _normalizarCita(data), CITA_COLS_NUEVAS);

  const actualizarCita = async (id, patch) =>
    _escrituraTolerante((fila) => sb.from('citas').update(fila).eq('id', id).select().single(),
      _normalizarCita(patch), CITA_COLS_NUEVAS);

  const eliminarCita = async (id) => { ok(await sb.from('citas').delete().eq('id', id)); return true; };

  /**
   * Cancela una cita SIN borrarla.
   *
   * La diferencia con `eliminarCita` importa: eliminar la hace desaparecer del
   * historial —y con ella el rastro de que ese hueco existió—, mientras que
   * cancelar deja constancia de quién falló y por qué. En ambos casos el
   * horario queda libre, porque la ocupación de la agenda solo cuenta las
   * citas en estado 'agendada' (ver `conflictosDeAgenda`).
   */
  const cancelarCita = async (id, { motivo = '', quien = '', avisado = false } = {}) => {
    const nota = String(motivo || '').trim();
    // El motivo es obligatorio a propósito. Una cita cancelada sin razón no
    // se distingue de un hueco cualquiera dentro de tres meses, y es justo
    // entonces cuando hace falta saber si el paciente abandonó el tratamiento
    // o si fue la clínica quien movió la agenda.
    if (!nota) throw new Error('Escribe el motivo de la cancelación: queda en el historial del paciente.');

    const responsable = CANCELA_QUIEN.includes(quien) ? quien : 'Otro';

    return actualizarCita(id, {
      estado: 'cancelada',
      cancelada_en: new Date().toISOString(),
      cancelada_por: responsable,
      // Quién lo tecleó. Se resuelve del perfil en sesión, no se pide: si se
      // preguntara, cualquiera podría firmar con otro nombre.
      cancelada_por_usuario: (_sesion && _sesion.perfil && _sesion.perfil.id) || null,
      motivo_cancelacion: avisado ? `${nota} (avisó por WhatsApp)` : nota
    });
  };

  /**
   * Marca que el paciente NO se presentó.
   *
   * No es lo mismo que cancelar y por eso es otra función: en una cancelación
   * alguien avisó con tiempo y el hueco pudo reasignarse; en una falta el
   * horario se perdió. Los dos liberan la agenda —la ocupación solo mira las
   * 'agendada'— pero cuentan distinto en el historial de cumplimiento.
   *
   * `justificada` recoge el caso intermedio: avisó tardísimo o hubo una
   * urgencia. Queda registrado como falta, pero el fisio puede leer el matiz.
   */
  const marcarFalta = async (id, { motivo = '', justificada = false } = {}) =>
    actualizarCita(id, {
      estado: 'no_asistio',
      falta_en: new Date().toISOString(),
      falta_justificada: !!justificada,
      motivo_falta: String(motivo || '').trim()
    });

  /** Deshace una falta o una cancelación y devuelve la cita a la agenda. */
  const reactivarCita = async (id) =>
    actualizarCita(id, {
      estado: 'agendada',
      cancelada_en: null, cancelada_por: '', cancelada_por_usuario: null, motivo_cancelacion: '',
      falta_en: null, falta_justificada: false, motivo_falta: ''
    });

  /**
   * Historial de asistencia de un paciente: asistidas, faltas y canceladas.
   *
   * Se calcula sobre las citas ya pasadas. Las canceladas NO penalizan el
   * cumplimiento: avisar es exactamente lo que la clínica quiere que hagan, y
   * contarlo como falta desincentivaría el aviso.
   */
  const cumplimientoDePaciente = async (pacienteId) => {
    const rows = ok(await sb.from('citas').select('id, inicia_en, estado, motivo_falta, falta_justificada, motivo_cancelacion, cancelada_por')
      .eq('paciente_id', pacienteId)
      .lte('inicia_en', new Date().toISOString())
      .order('inicia_en', { ascending: false }));

    const faltas     = rows.filter((c) => c.estado === 'no_asistio');
    const canceladas = rows.filter((c) => c.estado === 'cancelada');
    const asistidas  = rows.filter((c) => c.estado === 'completada');
    const base       = asistidas.length + faltas.length;

    return {
      asistidas: asistidas.length,
      faltas: faltas.length,
      canceladas: canceladas.length,
      cumplimiento: base ? Math.round((asistidas.length / base) * 100) : null,
      ultima_falta: faltas.length ? faltas[0].inicia_en : null,
      detalle_faltas: faltas.slice(0, 10),
      detalle_canceladas: canceladas.slice(0, 10)
    };
  };

  /** Devuelve una cita concreta con el nombre de su paciente ya resuelto. */
  const obtenerCita = async (id) => {
    const rows = ok(await sb.from('citas').select(SELECT_CITA).eq('id', id).limit(1));
    return rows.length ? _conNombre(rows)[0] : null;
  };

  /**
   * Citas VIVAS que pisan el hueco indicado.
   *
   * Se traen las cercanas y el solapamiento se calcula aquí porque la duración
   * es una columna aparte y PostgREST no sabe sumar minutos en el filtro. El
   * margen de 4 h cubre de sobra la cita más larga del catálogo (90 min).
   *
   * Solo cuentan las 'agendada': una cita cancelada o marcada como no asistida
   * ya no ocupa nada, que es justo lo que libera el horario al cancelar.
   */
  const conflictosDeAgenda = async ({ inicia_en, duracion_min = 45, excluirId = null }) => {
    const ini = new Date(inicia_en).getTime();
    if (!Number.isFinite(ini)) return [];
    const fin = ini + (Number(duracion_min) || 45) * 60000;
    const margen = 4 * 60 * 60000;

    const rows = ok(await sb.from('citas').select(SELECT_CITA)
      .eq('estado', 'agendada')
      .gte('inicia_en', new Date(ini - margen).toISOString())
      .lte('inicia_en', new Date(fin + margen).toISOString())
      .order('inicia_en', { ascending: true }));

    return _conNombre(rows.filter((c) => {
      if (excluirId && c.id === excluirId) return false;
      const a = new Date(c.inicia_en).getTime();
      const b = a + (Number(c.duracion_min) || 45) * 60000;
      return a < fin && b > ini;              // solapamiento estricto
    }));
  };

  /* ======================================================================
     ASISTENCIAS
     El trigger `trg_boletos_asistencia` de la BD emite los boletos y
     descuenta el paquete automáticamente. Aquí solo insertamos.
     ====================================================================== */
  const registrarAsistencia = async ({ paciente_id, cita_id = null, fecha = null, monto = null, metodo = 'Efectivo', concepto = 'Sesión de fisioterapia', nota = '' }) => {
    const asistio_en = fecha ? new Date(fecha).toISOString() : new Date().toISOString();

    // El importe se valida ANTES de insertar la asistencia: si el cobro es
    // inválido más vale no haber emitido todavía los boletos ni descontado la
    // sesión del paquete, porque eso ya no se deshace solo.
    const cobro = monto === null || monto === '' ? null : _importe(monto, 'El monto del cobro');

    const asistencia = ok(await sb.from('asistencias')
      .insert({ paciente_id, cita_id, asistio_en, nota }).select().single());

    if (cobro !== null && cobro > 0) {
      ok(await sb.from('pagos').insert({ paciente_id, monto: cobro, metodo, concepto, pagado_en: asistio_en }));
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
      paciente_id, monto: _importe(monto, 'El monto del cobro'), metodo, concepto,
      pagado_en: fecha ? new Date(fecha).toISOString() : new Date().toISOString()
    }).select().single());

  /** Corrige un cobro ya registrado (importe, método o concepto). */
  const actualizarPago = async (id, patch) => {
    const fila = { ...patch };
    if ('monto' in fila) fila.monto = _importe(fila.monto, 'El monto del cobro');
    if ('fecha' in fila) { fila.pagado_en = new Date(fila.fecha).toISOString(); delete fila.fecha; }
    return ok(await sb.from('pagos').update(fila).eq('id', id).select().single());
  };

  const eliminarPago = async (id) => { ok(await sb.from('pagos').delete().eq('id', id)); return true; };

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

  /* --- Opciones personalizadas ------------------------------------------
     El catálogo de `Store.SECCIONES_VALORACION` cubre lo habitual, pero
     ninguna lista cerrada aguanta la consulta real. Lo que el fisio añade se
     guarda aparte y se CONCATENA al pintar, nunca sustituye al catálogo: así
     una actualización del código no borra lo añadido, y lo añadido tampoco
     esconde una opción nueva que llegue con el catálogo.

     Se devuelven agrupadas por `seccion.campo`, que es la ruta con la que el
     renderizador identifica cada lista.
     ---------------------------------------------------------------------- */
  const opcionesValoracion = async () => {
    const r = await opcional(
      sb.from('valoracion_opciones').select('*').order('creado_en', { ascending: true }),
      { data: [], error: null },
      { objeto: 'valoracion_opciones', tolerarPermiso: true });

    const mapa = {};
    for (const o of r.data || []) {
      const ruta = `${o.seccion}.${o.campo}`;
      (mapa[ruta] || (mapa[ruta] = [])).push({ id: o.id, valor: o.valor });
    }
    return mapa;
  };

  /**
   * Añade una opción a una lista de la valoración.
   * Devuelve `{ya: true}` si esa opción ya existía —en el catálogo base o
   * añadida antes—, para poder avisar sin tratarlo como un error.
   */
  const agregarOpcionValoracion = async (seccion, campo, valor) => {
    const texto = String(valor || '').trim();
    if (!texto) throw new Error('Escribe el texto de la opción.');
    if (texto.length > 80) throw new Error('La opción es demasiado larga (máximo 80 caracteres).');

    // Contra el catálogo base: sin esto se podría añadir un duplicado exacto
    // de algo que ya está en la lista, y aparecería dos veces.
    const base = Store.opcionesDeCampo ? Store.opcionesDeCampo(seccion, campo) : [];
    if (base.some((o) => String(o).toLowerCase() === texto.toLowerCase())) return { ya: true, valor: texto };

    const { data, error } = await sb.from('valoracion_opciones')
      .insert({ seccion, campo, valor: texto }).select().single();

    if (error) {
      if (_esFalta(error)) {
        _marcarFalta('valoracion_opciones');
        throw new Error('Tu base no tiene todavía la tabla `valoracion_opciones`. Ejecuta supabase/schema.sql para poder añadir opciones.');
      }
      // 23505 = unique_violation: ya estaba añadida.
      if (error.code === '23505') return { ya: true, valor: texto };
      if (_esPermiso(error)) throw _errPermiso('valoracion_opciones');
      throw new Error(error.message);
    }
    _marcarPresente('valoracion_opciones');
    return { ya: false, id: data.id, valor: texto };
  };

  /** Retira una opción añadida. El catálogo base no se puede tocar desde aquí. */
  const eliminarOpcionValoracion = async (id) => {
    ok(await sb.from('valoracion_opciones').delete().eq('id', id));
    return true;
  };

  /* ======================================================================
     NOTAS + ADJUNTOS (Supabase Storage)
     ====================================================================== */

  /** Sube un dataURL al bucket `evidencias` y devuelve una URL firmada. */
  const _subirEvidencia = async (dataUrl, pacienteId) => {
    // Mismo motivo que en subirLogo: `fetch('data:…')` lo bloquea connect-src.
    const blob = _dataUrlABlob(dataUrl);
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
     ARCHIVOS DEL EXPEDIENTE  ·  imágenes y PDF (bucket `expedientes`)

     Se diferencian de `notas.adjuntos` en el alcance: aquello son evidencias
     de UNA sesión; esto es documentación del expediente completo (estudios de
     imagen, informes de otro especialista, consentimientos firmados).

     A diferencia de las evidencias, aquí NO se comprime ni se convierte a
     JPEG: un PDF no sobrevive a eso, y una radiografía recomprimida pierde
     justo el detalle por el que se guarda. El archivo sube tal cual llegó.

     La URL tampoco se persiste: el bucket es privado y cada lectura firma un
     enlace temporal, así que un enlace que se escape caduca solo.
     ====================================================================== */
  const ARCHIVO_MAX_BYTES = 20 * 1024 * 1024;      // 20 MB, igual que el bucket
  const ARCHIVO_TIPOS = [
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'
  ];

  const _extensionDe = (file) => {
    const porNombre = String(file.name || '').match(/\.([A-Za-z0-9]{1,5})$/);
    if (porNombre) return porNombre[1].toLowerCase();
    return file.type === 'application/pdf' ? 'pdf' : 'bin';
  };

  /** Enlace temporal al binario. `null` si el objeto ya no está en el bucket. */
  const _urlFirmada = async (ruta, segundos = 60 * 60) => {
    if (!ruta) return null;
    const { data, error } = await sb.storage.from('expedientes').createSignedUrl(ruta, segundos);
    if (error) {
      console.warn('[CLIDANFI] No se pudo firmar el archivo', ruta, error.message);
      return null;
    }
    return data.signedUrl;
  };

  /**
   * Lista el expediente documental con un enlace firmado por archivo.
   * Si la tabla todavía no existe, devuelve una lista vacía en vez de tumbar
   * la ficha del paciente entera.
   */
  const archivosDePaciente = async (pacienteId) => {
    const r = await opcional(
      sb.from('archivos').select('*').eq('paciente_id', pacienteId).order('creado_en', { ascending: false }),
      { data: [], error: null },
      { objeto: 'archivos' });

    const rows = r.data || [];
    return Promise.all(rows.map(async (a) => ({
      ...a,
      es_pdf: a.mime === 'application/pdf',
      url: await _urlFirmada(a.ruta)
    })));
  };

  /**
   * Sube un File del `<input type="file">` y lo registra en el expediente.
   * Si el registro en la tabla falla, se retira el binario recién subido: un
   * objeto huérfano en el bucket no lo ve nadie y ocuparía espacio para nada.
   */
  const subirArchivo = async (pacienteId, file, { titulo = '', categoria = 'Estudio', nota = '' } = {}) => {
    if (!file) throw new Error('No se recibió ningún archivo.');
    if (!ARCHIVO_TIPOS.includes(file.type)) {
      throw new Error('Formato no admitido. Sube una imagen (JPG, PNG, WEBP) o un PDF.');
    }
    if (file.size > ARCHIVO_MAX_BYTES) {
      throw new Error(`«${file.name}» pesa ${(file.size / 1048576).toFixed(1)} MB y el máximo son 20 MB.`);
    }

    const ruta = `${pacienteId}/${uid('arch')}.${_extensionDe(file)}`;
    ok(await sb.storage.from('expedientes').upload(ruta, file, { contentType: file.type, upsert: false }));

    try {
      const fila = ok(await sb.from('archivos').insert({
        paciente_id: pacienteId,
        titulo: String(titulo || file.name || 'Archivo').slice(0, 120),
        ruta,
        mime: file.type,
        tamano: file.size,
        categoria,
        nota: String(nota || '')
      }).select().single());
      return { ...fila, es_pdf: fila.mime === 'application/pdf', url: await _urlFirmada(ruta) };
    } catch (e) {
      await sb.storage.from('expedientes').remove([ruta]).catch(() => {});
      throw e;
    }
  };

  /** Borra el registro y su binario. Primero el objeto, luego la fila. */
  const eliminarArchivo = async (id) => {
    const fila = ok(await sb.from('archivos').select('ruta').eq('id', id).single());
    if (fila && fila.ruta) await sb.storage.from('expedientes').remove([fila.ruta]).catch(() => {});
    ok(await sb.from('archivos').delete().eq('id', id));
    return true;
  };

  /** Enlace fresco para abrir o descargar un archivo ya subido. */
  const enlaceDeArchivo = async (id) => {
    const fila = ok(await sb.from('archivos').select('ruta, titulo, mime').eq('id', id).single());
    return { ...fila, url: await _urlFirmada(fila.ruta) };
  };

  /* ======================================================================
     CATÁLOGO DE EJERCICIOS  ·  editable, con foto propia

     El catálogo de `Store.CATALOGO_EJERCICIOS` es el punto de partida, no el
     techo: cada clínica trabaja con su material y sus variantes. Aquí el fisio
     da de alta los suyos, corrige los que vienen y les pone una foto real —que
     vale bastante más que una miniatura genérica cuando el paciente intenta
     recordar el ejercicio en casa.

     La foto va al bucket `ejercicios`, que es PÚBLICO a propósito: no es dato
     clínico, y el paciente la abre desde su rutina sin firmar nada. Se guarda
     también su `image_ruta` porque al reemplazarla hay que retirar la anterior,
     y de una URL pública no se deduce con seguridad qué objeto borrar.
     ====================================================================== */
  /** Catálogo completo: lo que hay en la base, con el de `store.js` de respaldo. */
  const listarEjercicios = async ({ incluirInactivos = false } = {}) => {
    let q = sb.from('ejercicios').select('*').order('categoria', { ascending: true }).order('nombre', { ascending: true });
    if (!incluirInactivos) q = q.eq('activo', true);
    const rows = ok(await q);
    // Si la base todavía no se ha sembrado, al menos se ve el catálogo local.
    return rows.length ? rows : Store.CATALOGO_EJERCICIOS.map((e) => ({ ...e, propio: false, activo: true }));
  };

  /**
   * Sube la foto de un ejercicio y devuelve `{ruta, url}`.
   * A diferencia del expediente, aquí SÍ se comprime: es material didáctico y
   * una foto de 8 MB del móvil tarda en abrirse justo cuando el paciente la
   * necesita, en mitad de su rutina.
   */
  const _subirFotoEjercicio = async (dataUrl, ejercicioId) => {
    const blob = _dataUrlABlob(dataUrl);
    const ruta = `${ejercicioId}/${uid('ej')}.jpg`;
    ok(await sb.storage.from('ejercicios').upload(ruta, blob, { contentType: 'image/jpeg', upsert: false }));
    const { data } = sb.storage.from('ejercicios').getPublicUrl(ruta);
    return { ruta, url: data.publicUrl };
  };

  /**
   * Alta o edición de un ejercicio.
   *
   * `foto` es un dataURL ya comprimido por `UI.readImageCompressed`, o null
   * para dejar la que hubiera. `foto === ''` significa «quítala».
   *
   * El id es `text`, no uuid, porque los del catálogo base son legibles
   * (`ex_01`) y las rutinas ya existentes los referencian. Los nuevos se
   * generan con prefijo propio para no chocar nunca con un `ex_NN` que llegue
   * en una actualización del catálogo.
   */
  const guardarEjercicio = async ({ id = null, nombre, categoria, descripcion = '', cue = '',
                                    sets = 3, reps = 10, hold = 0, activo = true, foto = null }) => {
    const titulo = String(nombre || '').trim();
    if (!titulo) throw new Error('El ejercicio necesita un nombre.');
    if (!String(categoria || '').trim()) throw new Error('Elige una categoría para el ejercicio.');

    const esNuevo = !id;
    const ejercicioId = id || `ej_${uid('x')}`;

    const fila = {
      id: ejercicioId,
      nombre: titulo.slice(0, 120),
      categoria: String(categoria).trim(),
      descripcion: String(descripcion || '').trim(),
      cue: String(cue || '').trim(),
      sets: Math.max(0, Number(sets) || 0),
      reps: Math.max(0, Number(reps) || 0),
      hold: Math.max(0, Number(hold) || 0),
      activo: !!activo
    };
    if (esNuevo) fila.propio = true;

    // La foto anterior, para retirarla solo si todo lo demás sale bien.
    const previo = id
      ? (ok(await sb.from('ejercicios').select('image_ruta').eq('id', id).limit(1))[0] || {})
      : {};

    let subida = null;
    if (foto && String(foto).startsWith('data:')) {
      subida = await _subirFotoEjercicio(foto, ejercicioId);
      fila.image_url = subida.url;
      fila.image_ruta = subida.ruta;
    } else if (foto === '') {
      fila.image_url = '';
      fila.image_ruta = '';
    }

    try {
      const guardado = _escrituraTolerante(
        (f) => sb.from('ejercicios').upsert(f, { onConflict: 'id' }).select().single(),
        fila, ['image_ruta', 'propio', 'creado_en']);
      const r = await guardado;

      // Solo ahora: si el guardado hubiera fallado, borrar la foto vieja
      // habría dejado al ejercicio sin imagen y sin forma de recuperarla.
      if ((subida || foto === '') && previo.image_ruta && previo.image_ruta !== fila.image_ruta) {
        await sb.storage.from('ejercicios').remove([previo.image_ruta]).catch(() => {});
      }
      return r;
    } catch (e) {
      // Al revés que antes: la foto recién subida se queda huérfana si no se
      // registró el ejercicio, así que se retira.
      if (subida) await sb.storage.from('ejercicios').remove([subida.ruta]).catch(() => {});
      throw e;
    }
  };

  /**
   * Retira un ejercicio del catálogo.
   *
   * Por defecto lo DESACTIVA en vez de borrarlo: las rutinas ya entregadas lo
   * referencian, y un borrado dejaría al paciente con un hueco en su rutina.
   * El borrado real solo se permite si nadie lo usa.
   */
  const eliminarEjercicio = async (id, { forzar = false } = {}) => {
    const { count } = await sb.from('rutina_items')
      .select('*', { count: 'exact', head: true }).eq('ejercicio_id', id);

    if (count > 0 && !forzar) {
      ok(await sb.from('ejercicios').update({ activo: false }).eq('id', id));
      return { borrado: false, desactivado: true, rutinas: count };
    }

    const fila = ok(await sb.from('ejercicios').select('image_ruta').eq('id', id).limit(1))[0];
    if (fila && fila.image_ruta) await sb.storage.from('ejercicios').remove([fila.image_ruta]).catch(() => {});
    ok(await sb.from('ejercicios').delete().eq('id', id));
    return { borrado: true, desactivado: false, rutinas: count || 0 };
  };

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
    // `is('anulado_en', null)` = solo los boletos que de verdad participan: un
    // boleto anulado ni cuenta ni compite. Si la base todavía no tiene esa
    // columna se reintenta sin el filtro, que es el comportamiento de antes.
    let res = await sb.from('boletos').select('paciente_id', { count: 'exact' })
      .eq('sorteo_id', s.id).is('anulado_en', null);

    if (res.error && _esColumna(res.error)) {
      _marcarFalta('boletos.anulado_en');
      res = await sb.from('boletos').select('paciente_id', { count: 'exact' })
        .eq('sorteo_id', s.id);
    }
    const totalBoletos = res.count || 0;
    const boletos = ok(res);
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

  /**
   * Participantes con el detalle de CADA boleto, no solo el conteo.
   *
   * El detalle hace falta porque una participación se puede anular suelta: la
   * interfaz necesita poder señalar cuál. Los anulados se devuelven también,
   * marcados, para poder deshacerlo.
   */
  const participantesDeSorteo = async (sorteoId) => {
    const rows = await _boletosDe(sorteoId);

    const map = new Map();
    rows.forEach((b) => {
      if (!map.has(b.paciente_id)) {
        map.set(b.paciente_id, { paciente_id: b.paciente_id, nombre: (b.pacientes && b.pacientes.nombre) || '—', boletos: [] });
      }
      map.get(b.paciente_id).boletos.push({
        id: b.id,
        codigo: b.codigo,
        creado_en: b.creado_en,
        anulado: !!b.anulado_en,
        motivo: b.motivo_anulacion || ''
      });
    });

    return [...map.values()].map((r) => {
      const vivos = r.boletos.filter((b) => !b.anulado);
      return { ...r, total: vivos.length, total_anulados: r.boletos.length - vivos.length };
    })
      // Quien se queda con cero boletos vivos baja del todo, pero sigue
      // visible: es la única forma de devolverle la participación.
      .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre));
  };

  /* --- Anulación de UNA participación -----------------------------------
     Distinto de excluir a la persona: excluir la saca de la rifa entera y de
     las siguientes emisiones; esto retira un boleto concreto y deja los demás
     en pie —el caso de la asistencia que se registró por error, o del boleto
     que se emitió dos veces por un doble clic.

     No se borra la fila: el boleto nace de una asistencia que sigue ahí, así
     que `sincronizar_boletos` lo repondría en el siguiente guardado. Se marca,
     y el `on conflict do nothing` de la sincronización respeta la marca.
     ---------------------------------------------------------------------- */

  /**
   * Boletos de un sorteo. Si la base todavía no tiene las columnas de
   * anulación, reintenta sin ellas: se pierde la marca de anulado —no hay
   * ninguna— pero la lista de participantes se sigue viendo, que es lo que no
   * puede faltar.
   */
  const _boletosDe = async (sorteoId) => {
    const COLS_ANULACION = 'anulado_en, motivo_anulacion, ';
    const base = 'id, codigo, creado_en, paciente_id, pacientes(nombre)';

    const pedir = (cols) => sb.from('boletos').select(cols)
      .eq('sorteo_id', sorteoId).order('creado_en', { ascending: true });

    const res = await pedir(COLS_ANULACION + base);
    if (res.error && _esColumna(res.error)) {
      _marcarFalta('boletos.anulado_en');
      return ok(await pedir(base));
    }
    return ok(res);
  };

  const anularBoleto = async (boletoId, { motivo = '' } = {}) => {
    const patch = {
      anulado_en: new Date().toISOString(),
      anulado_por: (_sesion && _sesion.perfil && _sesion.perfil.id) || null,
      motivo_anulacion: String(motivo || '').trim()
    };

    const res = await sb.from('boletos').update(patch).eq('id', boletoId).select().single();

    if (res.error && _esColumna(res.error)) {
      _marcarFalta('boletos.anulado_en');
      throw new Error('Tu base no tiene todavía la anulación por participación. Ejecuta supabase/schema.sql para habilitarla.');
    }
    return ok(res);
  };

  /** Devuelve una participación anulada. */
  const restaurarBoleto = async (boletoId) =>
    ok(await sb.from('boletos')
      .update({ anulado_en: null, anulado_por: null, motivo_anulacion: '' })
      .eq('id', boletoId).select().single());

  /* --- Participantes excluidos ------------------------------------------
     Sacar a alguien de la rifa NO puede ser solo borrarle los boletos: se
     emiten con cada asistencia y `sincronizar_boletos` los repone en el
     siguiente guardado del sorteo. La exclusión se guarda como hecho aparte
     en `sorteo_excluidos`, que es lo que consultan el trigger y la
     sincronización en el servidor.
     ---------------------------------------------------------------------- */
  const excluidosDeSorteo = async (sorteoId) => {
    const r = await opcional(
      sb.from('sorteo_excluidos').select('paciente_id, motivo, creado_en, pacientes(nombre)')
        .eq('sorteo_id', sorteoId).order('creado_en', { ascending: false }),
      { data: [], error: null },
      { objeto: 'sorteo_excluidos', tolerarPermiso: true });

    return (r.data || []).map((x) => ({
      paciente_id: x.paciente_id,
      nombre: (x.pacientes && x.pacientes.nombre) || '—',
      motivo: x.motivo || '',
      creado_en: x.creado_en
    }));
  };

  /**
   * Saca a un paciente de un sorteo: registra la exclusión y retira sus
   * boletos actuales.
   *
   * @returns {{permanente: boolean, boletos_eliminados: number}}
   *   `permanente:false` significa que la base todavía no tiene la tabla
   *   `sorteo_excluidos`: los boletos se han retirado, pero volverán a
   *   emitirse en cuanto se guarde el sorteo. Quien llama debe decirlo.
   */
  const excluirDeSorteo = async (sorteoId, pacienteId, { motivo = '' } = {}) => {
    let permanente = true;

    const { error } = await sb.from('sorteo_excluidos')
      .upsert({ sorteo_id: sorteoId, paciente_id: pacienteId, motivo: String(motivo || '') },
              { onConflict: 'sorteo_id,paciente_id' });

    if (error) {
      if (!_esFalta(error)) {
        if (_esPermiso(error)) throw _errPermiso('sorteo_excluidos');
        throw new Error(error.message);
      }
      _marcarFalta('sorteo_excluidos');
      permanente = false;
    } else {
      _marcarPresente('sorteo_excluidos');
    }

    const retirados = ok(await sb.from('boletos').delete()
      .eq('sorteo_id', sorteoId).eq('paciente_id', pacienteId).select('id'));

    return { permanente, boletos_eliminados: (retirados || []).length };
  };

  /** Deshace la exclusión y repone los boletos de sus asistencias. */
  const readmitirEnSorteo = async (sorteoId, pacienteId) => {
    const { error } = await sb.from('sorteo_excluidos')
      .delete().eq('sorteo_id', sorteoId).eq('paciente_id', pacienteId);
    if (error && !_esFalta(error)) throw new Error(error.message);

    return sincronizarBoletos(sorteoId);
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
      { data: [], error: null },
      { objeto: 'solicitudes_cita' });
    return r.data || [];
  };

  const listarSolicitudes = async ({ estado = null } = {}) => {
    let q = sb.from('solicitudes_cita').select('*').order('creado_en', { ascending: false });
    if (estado) q = q.eq('estado', estado);
    // Sin `tolerarPermiso`: si RLS bloquea la lectura hay que decirlo, no
    // pintar una lista vacía que parece «no hay solicitudes».
    const r = await opcional(q, { data: [], error: null }, { objeto: 'solicitudes_cita' });
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
        // Contador decorativo del panel: si la tabla aún no existe, o si RLS
        // no deja contarla, vale 0. Nunca debe tumbar el resto del resumen.
        opcional(sb.from('solicitudes_cita').select('*', { count: 'exact', head: true }).eq('estado', 'nueva'),
                 { count: 0, error: null },
                 { objeto: 'solicitudes_cita', tolerarPermiso: true })
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
     NOTIFICACIONES PUSH  ·  el lado del navegador

     Aquí solo se guarda la suscripción; quien manda los avisos es el Worker
     de Cloudflare (`worker/`), porque a las 18:00 o 40 minutos antes de una
     sesión no hay ninguna garantía de que la aplicación esté abierta —que es
     justo el motivo de que esto no pueda vivir en el frontend.

     Una suscripción es por navegador y aparato: el mismo fisio en el móvil y
     en el portátil son dos filas, y las dos deben recibir.
     ====================================================================== */

  /** ¿El navegador puede recibir push? (Safari < 16.4 y http:// no pueden). */
  const puedePush = () =>
    typeof window !== 'undefined' &&
    'serviceWorker' in (window.navigator || {}) &&
    'PushManager' in window &&
    'Notification' in window;

  /**
   * Registra —o refresca— la suscripción de ESTE navegador.
   *
   * Se hace upsert por `endpoint` y no insert porque el navegador puede
   * devolver el mismo endpoint tras un permiso reconcedido; sin el upsert
   * saldría un error de unicidad en un momento en que el usuario acaba de
   * decir que sí y esperaría que funcionara.
   */
  const registrarPush = async (suscripcion, { agente = '' } = {}) => {
    const s = typeof suscripcion.toJSON === 'function' ? suscripcion.toJSON() : suscripcion;
    if (!s || !s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth) {
      throw new Error('La suscripción del navegador llegó incompleta.');
    }
    if (!_sesion) await auth.sesion();
    if (!_sesion) throw new Error('Inicia sesión antes de activar las notificaciones.');

    const { data, error } = await sb.from('push_suscripciones').upsert({
      usuario_id: _sesion.user.id,
      endpoint: s.endpoint,
      p256dh: s.keys.p256dh,
      auth: s.keys.auth,
      agente: String(agente || '').slice(0, 200),
      fallos: 0
    }, { onConflict: 'endpoint' }).select().single();

    if (error) {
      if (_esFalta(error)) {
        _marcarFalta('push_suscripciones');
        throw new Error('Tu base no tiene todavía la tabla `push_suscripciones`. Ejecuta supabase/schema.sql.');
      }
      if (_esPermiso(error)) throw _errPermiso('push_suscripciones');
      throw new Error(error.message);
    }
    _marcarPresente('push_suscripciones');
    return data;
  };

  /** Da de baja este navegador. Por endpoint: no toca los demás aparatos. */
  const bajaPush = async (endpoint) => {
    const { error } = await sb.from('push_suscripciones').delete().eq('endpoint', endpoint);
    if (error && !_esFalta(error)) throw new Error(error.message);
    return true;
  };

  /** Aparatos suscritos del usuario en sesión, para poder revisarlos. */
  const suscripcionesPush = async () => {
    const r = await opcional(
      sb.from('push_suscripciones').select('id, endpoint, agente, creado_en, ultimo_ok')
        .order('creado_en', { ascending: false }),
      { data: [], error: null },
      { objeto: 'push_suscripciones', tolerarPermiso: true });
    return r.data || [];
  };

  /**
   * Citas del día siguiente con el teléfono a mano.
   *
   * La usa el Worker para armar el recordatorio de las 18:00, y también la
   * interfaz para enseñar exactamente lo que se va a mandar antes de que
   * llegue la hora.
   */
  const citasDeManana = async () => {
    const manana = isoDay(addDays(new Date(), 1));
    return _conNombre(ok(await sb.from('citas').select(SELECT_CITA)
      .eq('estado', 'agendada')
      .gte('inicia_en', `${manana}T00:00:00`)
      .lte('inicia_en', `${manana}T23:59:59`)
      .order('inicia_en', { ascending: true })));
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
    'listarPacientes', 'crearPaciente', 'crearPacienteExpres', 'actualizarPaciente', 'eliminarPaciente',
    'citasDeHoy', 'proximasCitas', 'citasDeManana', 'obtenerCita', 'crearCita', 'actualizarCita',
    'cancelarCita', 'marcarFalta', 'reactivarCita', 'eliminarCita', 'conflictosDeAgenda',
    'registrarAsistencia', 'eliminarAsistencia',
    'listarEjercicios', 'guardarEjercicio', 'eliminarEjercicio',
    'agregarOpcionValoracion', 'eliminarOpcionValoracion',
    'registrarPago', 'actualizarPago', 'eliminarPago', 'ingresosSemana',
    'guardarValoracion', 'crearNota', 'agregarAdjunto', 'eliminarNota',
    'subirArchivo', 'eliminarArchivo', 'enlaceDeArchivo',
    'guardarRutina', 'activarRutina', 'eliminarRutina',
    'guardarPromocion', 'eliminarPromocion',
    'listarSorteos', 'obtenerSorteo', 'guardarSorteo', 'eliminarSorteo',
    'sincronizarBoletos', 'participantesDeSorteo', 'realizarSorteo', 'publicarGanador',
    'excluidosDeSorteo', 'excluirDeSorteo', 'readmitirEnSorteo',
    'anularBoleto', 'restaurarBoleto',
    'listarSolicitudes', 'actualizarSolicitud', 'convertirSolicitud',
    'resumenDashboard',
    'setConfig', 'subirLogo', 'quitarLogo'
  ];

  // El paciente solo accede a lo suyo. El valor es la posición del argumento
  // que lleva el id de paciente.
  const SOLO_PROPIO = {
    obtenerPaciente: 0, citasDePaciente: 0, proximaCitaDePaciente: 0,
    asistenciasDePaciente: 0, pagosDePaciente: 0,
    valoracionDePaciente: 0, notasDePaciente: 0, archivosDePaciente: 0,
    rutinasDePaciente: 0, rutinaActiva: 0, misBoletos: 0,
    cumplimientoDePaciente: 0
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
    listarPacientes, obtenerPaciente, crearPaciente, crearPacienteExpres,
    actualizarPaciente, eliminarPaciente,
    citasDeHoy, proximasCitas, citasDeManana, citasDePaciente, proximaCitaDePaciente, obtenerCita,
    crearCita, actualizarCita, cancelarCita, marcarFalta, reactivarCita,
    eliminarCita, conflictosDeAgenda, cumplimientoDePaciente,
    registrarAsistencia, asistenciasDePaciente, eliminarAsistencia,
    registrarPago, actualizarPago, eliminarPago, ingresosSemana, pagosDePaciente,
    valoracionDePaciente, guardarValoracion,
    opcionesValoracion, agregarOpcionValoracion, eliminarOpcionValoracion,
    listarEjercicios, guardarEjercicio, eliminarEjercicio,
    notasDePaciente, crearNota, agregarAdjunto, eliminarNota,
    archivosDePaciente, subirArchivo, eliminarArchivo, enlaceDeArchivo,
    rutinasDePaciente, rutinaActiva, guardarRutina, activarRutina, eliminarRutina,
    listarPromociones, guardarPromocion, eliminarPromocion,
    listarSorteos, obtenerSorteo, guardarSorteo, eliminarSorteo,
    sincronizarBoletos, participantesDeSorteo, realizarSorteo, publicarGanador, misBoletos,
    excluidosDeSorteo, excluirDeSorteo, readmitirEnSorteo,
    anularBoleto, restaurarBoleto,
    registrarPush, bajaPush, suscripcionesPush,
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
    faltaEnEsquema,
    verificarEsquema,
    // Consulta de capacidad del navegador: no toca la base ni necesita sesión.
    puedePush
  });

  console.info('[CLIDANFI] API conectada a Supabase.');
})(window);
