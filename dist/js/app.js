/* ==========================================================================
   CLIDANFI · app.js  ·  ROUTER + SHELL + GUARDIA DE SESIÓN
   - Sin sesión válida NO se renderiza ninguna vista salvo la de acceso.
   - El rol viene del perfil del usuario, nunca de un control de la interfaz.
   - Cada ruta declara qué rol la puede abrir; entrar por URL a una ruta ajena
     redirige al inicio del propio rol.
   ========================================================================== */
(function (global) {
  'use strict';

  const { icon, escapeHtml: E, avatar, toast, openSheet, closeSheet, confirmSheet } = UI;

  /* ======================================================================
     RUTAS  ·  `rol` es la autorización de la pantalla
     ====================================================================== */
  const RUTAS = [
    // Fisioterapeuta
    { patron: /^\/t\/dashboard$/,            vista: () => VistaFisio.dashboard,    rol: 'fisio' },
    { patron: /^\/t\/agenda$/,               vista: () => VistaFisio.agenda,       rol: 'fisio' },
    { patron: /^\/t\/pacientes$/,            vista: () => VistaFisio.pacientes,    rol: 'fisio' },
    { patron: /^\/t\/paciente\/([^/?]+)$/,   vista: () => VistaFisio.paciente,     rol: 'fisio', claves: ['id'] },
    // `sinNav`: pantallas de formulario a pantalla completa. Se oculta el menú
    // inferior para que no tape la barra de guardar; se sale con «volver».
    { patron: /^\/t\/valoracion\/([^/?]+)$/, vista: () => VistaFisio.valoracion,   rol: 'fisio', claves: ['id'], sinNav: true },
    { patron: /^\/t\/rutina\/([^/?]+)$/,     vista: () => VistaFisio.rutinaEditor, rol: 'fisio', claves: ['id'], sinNav: true },
    { patron: /^\/t\/sorteos$/,              vista: () => VistaFisio.sorteos,      rol: 'fisio' },
    // Paciente
    { patron: /^\/p\/inicio$/,               vista: () => VistaPaciente.inicio,      rol: 'paciente' },
    { patron: /^\/p\/rutina$/,               vista: () => VistaPaciente.rutina,      rol: 'paciente' },
    { patron: /^\/p\/promociones$/,          vista: () => VistaPaciente.promociones, rol: 'paciente' },
    { patron: /^\/p\/sorteos$/,              vista: () => VistaPaciente.sorteos,     rol: 'paciente' }
  ];

  const NAV = {
    fisio: [
      { href: '#/t/dashboard', icono: 'home',     label: 'Inicio' },
      { href: '#/t/agenda',    icono: 'calendar', label: 'Agenda' },
      { href: '#/t/pacientes', icono: 'users',    label: 'Pacientes' },
      { href: '#/t/sorteos',   icono: 'gift',     label: 'Sorteos' }
    ],
    paciente: [
      { href: '#/p/inicio',      icono: 'home',     label: 'Inicio' },
      { href: '#/p/rutina',      icono: 'dumbbell', label: 'Mi rutina' },
      { href: '#/p/promociones', icono: 'tag',      label: 'Promos' },
      { href: '#/p/sorteos',     icono: 'ticket',   label: 'Sorteos' }
    ]
  };

  const INICIO = { fisio: '#/t/dashboard', paciente: '#/p/inicio' };

  /* ======================================================================
     ESTADO
     ====================================================================== */
  const estado = {
    sesion: null,   // { user, perfil }
    ruta: null,
    renderizando: false
  };

  const rol = () => (estado.sesion ? estado.sesion.perfil.rol : null);
  const autenticado = () => !!estado.sesion;

  /* ======================================================================
     HASH
     ====================================================================== */
  function parseHash(hashPreferido) {
    const raw = (hashPreferido || location.hash || '').replace(/^#/, '');
    if (!raw) return null;
    const [path, qs = ''] = raw.split('?');
    const query = Object.fromEntries(new URLSearchParams(qs));

    for (const r of RUTAS) {
      const m = path.match(r.patron);
      if (m) {
        const params = {};
        (r.claves || []).forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { def: r, params, query, path };
      }
    }
    return null;
  }

  /* ======================================================================
     RENDER
     ====================================================================== */
  async function render() {
    if (estado.renderizando) return;
    estado.renderizando = true;

    const root = document.getElementById('view-root');

    try {
      /* --- Puerta 1: sin configuración válida no hay aplicación --------- */
      if (!global.CLIDANFI_LISTO) {
        estado.ruta = null;
        const vista = await VistaAuth.configuracion();
        mostrarChrome(false);
        root.innerHTML = vista.html;
        irArriba(root);
        if (vista.onMount) vista.onMount(root);
        return;
      }

      /* --- Puerta 2: sin sesión, solo la pantalla de acceso ------------- */
      if (!autenticado()) {
        estado.ruta = null;
        const vista = await VistaAuth.login();
        mostrarChrome(false);
        root.innerHTML = vista.html;
        irArriba(root);
        if (vista.onMount) vista.onMount(root);
        return;
      }

      /* --- Puerta 3: rol desconocido ------------------------------------ */
      if (!NAV[rol()]) {
        mostrarChrome(false);
        root.innerHTML = pantallaRolInvalido();
        return;
      }

      /* --- Autorización de la ruta -------------------------------------- */
      let ruta = parseHash();
      if (!ruta || ruta.def.rol !== rol()) {
        // Ruta inexistente o de otro rol: al inicio del rol propio.
        if (ruta && ruta.def.rol !== rol()) {
          console.warn('[CLIDANFI] Ruta no autorizada para el rol actual:', ruta.path);
        }
        location.hash = INICIO[rol()];
        ruta = parseHash();
        if (!ruta) return;
      }
      estado.ruta = ruta;

      // Al salir de una pantalla con formulario, el aviso de "sin guardar"
      // deja de aplicar (si el usuario llegó aquí, ya confirmó la salida).
      if (!/^\/t\/(valoracion|rutina)\//.test(ruta.path) && global.VistaFisio) VistaFisio.marcarLimpio();

      const resultado = await ruta.def.vista()(ruta.params, ruta.query);

      const conNav = !ruta.def.sinNav;
      mostrarChrome(true, conNav);
      root.innerHTML = resultado.html;
      irArriba(root);

      pintarBarraContexto(resultado);
      if (conNav) pintarNav();
      pintarUsuario();

      if (resultado.onMount) resultado.onMount(root);
    } catch (err) {
      console.error('[CLIDANFI] Error al renderizar:', err);
      pintarError(root, err);
    } finally {
      estado.renderizando = false;
    }
  }

  /**
   * Vuelve arriba. En móvil se desplaza el documento; en escritorio el que
   * tiene el scroll es #view-root, dentro del marco.
   */
  function irArriba(root) {
    window.scrollTo(0, 0);
    if (root) root.scrollTop = 0;
  }

  /** El perfil existe pero su rol no corresponde a ninguna vista. */
  function pantallaRolInvalido() {
    const r = estado.sesion.perfil.rol;
    return `
      <div class="flex min-h-[100dvh] flex-col justify-center px-6 py-10">
        <div class="rounded-2xl border border-brand-200 bg-brand-50 p-4">
          <p class="flex items-center gap-2 text-[13.5px] font-extrabold text-brand-800">
            ${icon('alert', 'h-4 w-4')} Rol no reconocido
          </p>
          <p class="mt-1.5 text-[12.5px] leading-snug text-brand-900">
            Tu perfil tiene el rol <code class="rounded bg-brand-100 px-1 font-mono">${E(String(r))}</code>,
            que no corresponde a ninguna vista. Debe ser <code class="rounded bg-brand-100 px-1 font-mono">fisio</code>
            o <code class="rounded bg-brand-100 px-1 font-mono">paciente</code>.
          </p>
        </div>
        <button data-action="cerrar-sesion" class="mt-5 w-full rounded-2xl bg-ink-900 py-3.5 text-[14.5px] font-extrabold text-white active:scale-[.98]">
          Cerrar sesión
        </button>
      </div>`;
  }

  function pintarError(root, err) {
    const denegado = /Acceso denegado|Sesión no iniciada/i.test(err.message || '');
    root.innerHTML = `
      <div class="p-4">
        <div class="rounded-2xl border ${denegado ? 'border-amber-200 bg-amber-50' : 'border-rose-200 bg-rose-50'} p-4">
          <p class="flex items-center gap-2 text-[13px] font-extrabold ${denegado ? 'text-amber-800' : 'text-rose-800'}">
            ${icon(denegado ? 'lock' : 'alert', 'h-4 w-4')} ${denegado ? 'Acceso restringido' : 'Ocurrió un error'}
          </p>
          <p class="mt-1 text-[12px] ${denegado ? 'text-amber-700' : 'text-rose-700'}">${E(err.message || String(err))}</p>
          <div class="mt-3 flex gap-2">
            <button data-action="ir-inicio" class="rounded-lg bg-ink-800 px-3 py-2 text-[12.5px] font-bold text-white">Volver al inicio</button>
          </div>
        </div>
      </div>`;
  }

  /**
   * Muestra u oculta cabecera y navegación.
   * La pantalla de acceso va limpia; las de formulario conservan la cabecera
   * pero ocultan el menú inferior para no tapar la barra de guardar.
   */
  function mostrarChrome(visible, conNav = true) {
    document.getElementById('app-header').classList.toggle('hidden', !visible);
    document.getElementById('bottom-nav').classList.toggle('hidden', !visible || !conNav);
    // El hueco de pb-28 solo hace falta si el menú está a la vista; en las
    // pantallas de formulario el espacio lo reserva la propia vista.
    document.getElementById('view-root').classList.toggle('pb-28', visible && conNav);
  }

  function pintarBarraContexto(resultado) {
    const bar = document.getElementById('context-bar');
    const sub = document.getElementById('header-subtitle');
    const esRaiz = NAV[rol()].some((n) => n.href === '#' + estado.ruta.path);

    sub.textContent = rol() === 'fisio' ? 'Panel del fisioterapeuta' : 'Portal del paciente';

    if (esRaiz && !resultado.volver) {
      bar.classList.add('hidden');
      bar.classList.remove('flex');
      bar.innerHTML = '';
      return;
    }

    bar.classList.remove('hidden');
    bar.classList.add('flex');
    bar.innerHTML = `
      <button data-action="volver" data-href="${E(resultado.volver || '')}" aria-label="Volver"
        class="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-600 active:bg-ink-100">
        ${icon('arrowLeft', 'h-5 w-5')}
      </button>
      <p class="min-w-0 flex-1 truncate text-[14px] font-extrabold text-ink-900">${E(resultado.titulo || '')}</p>`;
  }

  function pintarNav() {
    const nav = document.getElementById('bottom-nav');
    const actual = '#' + estado.ruta.path;

    nav.innerHTML = `
      <div class="nav-safe flex items-stretch justify-around px-2 pt-2">
        ${NAV[rol()].map((it) => {
          const on = actual === it.href;
          return `
            <a href="${it.href}" class="nav-item flex flex-1 flex-col items-center gap-1 py-1" ${on ? 'aria-current="page"' : ''}>
              <span class="nav-icon-wrap grid h-7 w-14 place-items-center rounded-full transition">${icon(it.icono, 'h-5 w-5')}</span>
              <span class="text-[10px] font-bold leading-none">${E(it.label)}</span>
            </a>`;
        }).join('')}
      </div>`;
  }

  /** Chip del usuario en la cabecera (sustituye al antiguo switch de rol). */
  function pintarUsuario() {
    const cont = document.getElementById('user-chip');
    const nombre = estado.sesion.perfil.nombre || estado.sesion.user.email;
    cont.innerHTML = `
      <button data-action="abrir-cuenta" aria-label="Mi cuenta"
        class="flex items-center gap-2 rounded-full bg-ink-100 py-1 pl-1 pr-2.5 active:scale-95">
        ${avatar(nombre, 'h-7 w-7 text-[10px]')}
        <span class="max-w-[80px] truncate text-[11px] font-bold text-ink-700">${E(nombre.split(' ')[0])}</span>
      </button>`;
  }

  /* ======================================================================
     SESIÓN
     ====================================================================== */

  /** Arranca (o rearranca) la app tras un inicio de sesión correcto. */
  async function entrar() {
    estado.sesion = await API.auth.sesion();
    if (!estado.sesion) return render();
    // Cada rol aterriza en su propia pantalla de inicio.
    const destino = INICIO[rol()];
    if (location.hash !== destino) location.hash = destino;
    else await render();
  }

  async function salir() {
    const ok = await confirmSheet({
      title: 'Cerrar sesión',
      message: '¿Seguro que quieres salir de tu cuenta?',
      confirmText: 'Cerrar sesión'
    });
    if (!ok) return;

    await API.auth.salir();
    estado.sesion = null;
    // Limpia el hash para no dejar rastro de la última pantalla visitada.
    history.replaceState(null, '', location.pathname + location.search);
    await render();
    toast('Sesión cerrada');
  }

  function sheetCuenta() {
    const p = estado.sesion.perfil;
    const url = (global.CLIDANFI_ENV || {}).SUPABASE_URL || '';
    const esFisio = p.rol === 'fisio';

    openSheet({
      title: 'Mi cuenta',
      subtitle: estado.sesion.user.email,
      body: `
        <div class="space-y-2">
          <div class="flex items-center gap-3 rounded-xl bg-brand-50 p-3">
            ${avatar(p.nombre || estado.sesion.user.email, 'h-11 w-11 text-[13px]')}
            <div class="min-w-0 flex-1">
              <p class="truncate text-[14px] font-extrabold text-brand-900">${E(p.nombre || '—')}</p>
              <p class="text-[11.5px] font-bold uppercase tracking-wide text-brand-700">
                ${p.rol === 'fisio' ? 'Fisioterapeuta' : 'Paciente'}
              </p>
            </div>
          </div>

          <div class="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <span class="mt-0.5 text-emerald-600">${icon('shield', 'h-4 w-4')}</span>
            <div class="min-w-0">
              <p class="text-[12.5px] font-extrabold text-emerald-800">Conectado a Supabase</p>
              <p class="mt-0.5 break-all text-[11px] font-mono leading-snug text-emerald-700">${E(url)}</p>
              <p class="mt-1 text-[11.5px] leading-snug text-emerald-700">
                El acceso lo controlan las políticas RLS del servidor.
              </p>
            </div>
          </div>

          ${esFisio ? `
            <div class="flex items-start gap-2.5 rounded-xl border border-ink-200 bg-white p-3">
              <span class="mt-0.5 text-brand-600">${icon('lock', 'h-4 w-4')}</span>
              <div class="min-w-0">
                <p class="text-[12.5px] font-extrabold text-ink-800">Permisos de edición activos</p>
                <p class="mt-0.5 text-[11.5px] leading-snug text-ink-500">
                  Tu perfil es <strong>fisio</strong>, así que puedes crear y editar pacientes,
                  citas, valoraciones, rutinas y sorteos.
                </p>
              </div>
            </div>` : `
            <div class="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <span class="mt-0.5 text-amber-600">${icon('info', 'h-4 w-4')}</span>
              <div class="min-w-0">
                <p class="text-[12.5px] font-extrabold text-amber-800">Cuenta de solo lectura</p>
                <p class="mt-0.5 text-[11.5px] leading-snug text-amber-700">
                  Tu perfil es <strong>paciente</strong>: ves tu expediente pero no puedes editarlo.
                  Si deberías ser fisioterapeuta, pide que promuevan tu cuenta en la tabla
                  <code class="rounded bg-amber-100 px-1 font-mono text-[10.5px]">perfiles</code>.
                </p>
              </div>
            </div>`}

          <button data-action="cerrar-sesion" class="flex w-full items-center gap-3 rounded-xl border border-rose-200 p-3 text-left active:bg-rose-50">
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-rose-100 text-rose-600">${icon('logout', 'h-4 w-4')}</span>
            <span class="text-[13.5px] font-bold text-rose-600">Cerrar sesión</span>
          </button>
        </div>`,
      onMount: (root) => root.querySelectorAll('[data-action]').forEach((b) =>
        b.addEventListener('click', () => closeSheet()))
    });
  }

  /* ======================================================================
     DELEGACIÓN DE EVENTOS  ·  data-action="…"
     ====================================================================== */
  const ACCIONES = {
    /* --- sesión y navegación --- */
    'abrir-cuenta':  () => sheetCuenta(),
    'cerrar-sesion': () => salir(),
    'ir-inicio':     () => { location.hash = INICIO[rol()] || ''; render(); },
    'volver':        async (el) => {
      if (!(await confirmarSalida())) return;
      if (el.dataset.href) location.hash = el.dataset.href; else history.back();
    },

    /* --- pacientes --- */
    'nuevo-paciente':   () => VistaFisio.sheetPaciente(),
    'editar-paciente':  (el) => VistaFisio.sheetPaciente(el.dataset.id),
    'limpiar-busqueda': () => { const i = document.getElementById('buscador-pacientes'); if (i) { i.value = ''; i.dispatchEvent(new Event('input')); } },

    /* --- agenda --- */
    'nueva-cita': (el) => VistaFisio.sheetCita(el.dataset.id || null),
    'cita-menu':  (el) => VistaFisio.sheetMenuCita(el.dataset.id),

    /* --- clínico --- */
    'registrar-asistencia': (el) => VistaFisio.sheetAsistencia(el.dataset.id),
    'abrir-valoracion':     (el) => { location.hash = `#/t/valoracion/${el.dataset.id}`; },
    'nueva-nota':           (el) => VistaFisio.sheetNota(el.dataset.id),
    'ver-foto':             (el) => VistaFisio.sheetFoto(el.dataset.url, el.dataset.titulo),

    'borrar-nota': async (el) => {
      const ok = await confirmSheet({ title: 'Eliminar nota', message: '¿Eliminar esta nota de evolución y sus adjuntos?', confirmText: 'Eliminar', tone: 'danger' });
      if (ok) { await API.eliminarNota(el.dataset.id); toast('Nota eliminada'); render(); }
    },

    /* Guardado explícito de la valoración: recoge TODOS los campos del
       formulario (texto, número, deslizadores, casillas, desplegables, tablas
       de goniometría/fuerza y pruebas especiales) y los envía en una sola
       petición. Nada se ha persistido antes de pulsar aquí. */
    'guardar-valoracion': async (el) => {
      const root = document.getElementById('view-root');
      const { secciones_activas, datos } = VistaFisio.leerValoracion(root);

      await UI.guardarConEstado(el,
        () => API.guardarValoracion(el.dataset.id, { secciones_activas, datos, id: el.dataset.vid || null }),
        {
          textoOk: 'Valoración guardada',
          alTerminar: () => {
            VistaFisio.marcarLimpio();
            location.hash = `#/t/paciente/${el.dataset.id}?tab=valoracion`;
          }
        }).catch(() => { /* el aviso ya quedó bajo el botón; no se sale de la pantalla */ });
    },

    /* --- rutinas --- */
    'abrir-rutina':   (el) => { location.hash = `#/t/rutina/${el.dataset.id}`; },
    'editar-rutina':  (el) => { location.hash = `#/t/rutina/${el.dataset.id}?rid=${el.dataset.rid}`; },
    'activar-rutina': async (el) => { await API.activarRutina(el.dataset.id); toast('Rutina marcada como activa'); render(); },

    'borrar-rutina': async (el) => {
      const ok = await confirmSheet({ title: 'Eliminar rutina', message: 'Se eliminará esta versión de la rutina del historial.', confirmText: 'Eliminar', tone: 'danger' });
      if (ok) { await API.eliminarRutina(el.dataset.id); toast('Rutina eliminada'); render(); }
    },

    /* Guardado explícito de la rutina: título, indicaciones, ejercicios en su
       orden y, por cada uno, series, repeticiones, segundos y el desplegable
       de frecuencia. Todo en una sola petición al pulsar. */
    'guardar-rutina': async (el) => {
      const root = document.getElementById('view-root');
      const edicion = VistaFisio.rutinaEnEdicion();
      const items = edicion ? edicion.items : [];
      if (!items.length) return toast('Agrega al menos un ejercicio', 'error');

      const titulo = root.querySelector('#rut-titulo').value.trim() || 'Rutina sin título';
      const notas = root.querySelector('#rut-notas').value.trim();

      await UI.guardarConEstado(el,
        () => API.guardarRutina(el.dataset.id, { titulo, notas, items, id: el.dataset.rid || null }),
        {
          textoOk: 'Rutina guardada',
          alTerminar: () => {
            VistaFisio.marcarLimpio();
            location.hash = `#/t/paciente/${el.dataset.id}?tab=rutinas`;
          }
        }).catch(() => { /* el aviso ya quedó bajo el botón */ });
    },

    /* --- sorteos y promociones --- */
    'nuevo-sorteo':      () => VistaFisio.sheetSorteo(),
    'editar-sorteo':     (el) => VistaFisio.sheetSorteo(el.dataset.id),
    'ver-participantes': (el) => VistaFisio.sheetParticipantes(el.dataset.id),
    'realizar-sorteo':   (el) => VistaFisio.ejecutarSorteo(el.dataset.id),
    'publicar-sorteo':   async (el) => {
      await API.publicarGanador(el.dataset.id, el.dataset.pub === '1');
      toast(el.dataset.pub === '1' ? 'Ganador publicado' : 'Ganador oculto');
      render();
    },
    'ver-promos':  () => VistaFisio.sheetPromos(),
    'nueva-promo': () => VistaFisio.sheetPromoForm(),

    /* --- autorregistro --- */
    'ver-solicitudes': () => VistaFisio.sheetSolicitudes(),
    'solicitar-cita':  () => VistaPaciente.sheetSolicitarCita()
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = ACCIONES[el.dataset.action];
    if (!fn) return;
    e.preventDefault();
    Promise.resolve(fn(el, e)).catch((err) => {
      console.error('[CLIDANFI]', err);
      toast(err.message || 'No se pudo completar la acción', 'error', 4000);
    });
  });

  /* ======================================================================
     ARRANQUE
     ====================================================================== */
  window.addEventListener('hashchange', () => { closeSheet(); render(); });

  /* ======================================================================
     CAMBIOS SIN GUARDAR
     Como no hay autoguardado, salir de la valoración o del editor de rutinas
     con ediciones pendientes las perdería. Estas tres barreras lo evitan.
     ====================================================================== */

  /** ¿Estamos en una pantalla con formulario y hay algo sin guardar? */
  const haySinGuardar = () =>
    !!(global.VistaFisio && VistaFisio.hayCambiosSinGuardar && VistaFisio.hayCambiosSinGuardar());

  async function confirmarSalida() {
    if (!haySinGuardar()) return true;
    const salir = await confirmSheet({
      title: 'Cambios sin guardar',
      message: 'Si sales ahora se perderá lo que capturaste. ¿Quieres salir de todos modos?',
      confirmText: 'Salir sin guardar',
      tone: 'danger'
    });
    if (salir) VistaFisio.marcarLimpio();
    return salir;
  }

  // 1 · Navegación por la barra inferior o cualquier enlace interno
  document.addEventListener('click', async (e) => {
    const enlace = e.target.closest('a[href^="#/"]');
    if (!enlace || !haySinGuardar()) return;
    e.preventDefault();
    e.stopPropagation();
    if (await confirmarSalida()) location.hash = enlace.getAttribute('href');
  }, true);

  // 2 · Cerrar la pestaña o recargar
  window.addEventListener('beforeunload', (e) => {
    if (!haySinGuardar()) return;
    e.preventDefault();
    e.returnValue = '';
  });

  /* Red de seguridad: cualquier promesa sin capturar (por ejemplo el guardado
     dentro de un panel) se muestra al usuario en vez de morir en la consola. */
  window.addEventListener('unhandledrejection', (e) => {
    const msg = (e.reason && e.reason.message) || String(e.reason || '');
    if (!msg) return;
    console.error('[CLIDANFI] Promesa sin capturar:', e.reason);
    toast(msg, /Acceso denegado/.test(msg) ? 'warn' : 'error', 4500);
  });

  document.addEventListener('DOMContentLoaded', async () => {
    // Sin cliente de Supabase no hay API: se muestra la pantalla de configuración.
    if (!global.CLIDANFI_LISTO || !global.API) return render();

    // Cambios de sesión desde fuera (otra pestaña, token expirado en Supabase)
    API.auth.onCambio(async (sesion) => {
      const antes = estado.sesion ? estado.sesion.user.id : null;
      const ahora = sesion ? sesion.user.id : null;
      if (antes === ahora) return;
      estado.sesion = sesion;
      closeSheet();
      await render();
    });

    estado.sesion = await API.auth.sesion();

    if (autenticado() && !location.hash) location.hash = INICIO[rol()];
    render();
  });

  global.App = { render, entrar, salir, get rol() { return rol(); }, get sesion() { return estado.sesion; } };
})(window);
