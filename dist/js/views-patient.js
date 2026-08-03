/* ==========================================================================
   CLIDANFI · views-patient.js  ·  VISTA PACIENTE
   Interfaz simplificada, pensada para leerse de un vistazo en el celular.
   ========================================================================== */
(function (global) {
  'use strict';

  const {
    escapeHtml: E, icon, avatar, badge, emptyState, sectionTitle,
    fmtDate, fmtTime, fmtDateLong, relDay, isoDay, placeholderImage,
    toast, openSheet, closeSheet
  } = UI;

  const card = (inner, cls = '') =>
    `<section class="rounded-2xl border border-ink-200/70 bg-white p-4 shadow-card ${cls}">${inner}</section>`;

  /**
   * Paciente dueño de la sesión actual. Se resuelve SIEMPRE desde el token
   * (pacientes.usuario_id = auth.uid()), nunca desde un id de la URL o de la
   * configuración: así un paciente no puede pedir el expediente de otro.
   */
  async function pacienteActual() {
    return API.miPaciente();
  }

  /**
   * Secciones que exigen expediente (rutina, sorteos). En vez de un mensaje
   * muerto, remite a la vitrina para pedir la primera cita.
   */
  const necesitaExpediente = (titulo, que) => ({
    titulo,
    html: `
      <div class="space-y-4 px-4 pt-6 anim-fade-up">
        ${emptyState('user', `Aún no tienes ${que}`,
          'Se activa en cuanto la clínica cree tu expediente, después de tu primera cita.')}
        <a href="#/p/inicio"
          class="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 text-[14px] font-extrabold text-white active:scale-[.98]">
          ${icon('calendar', 'h-4.5 w-4.5')} Solicitar mi primera cita
        </a>
      </div>`
  });

  /* ======================================================================
     VITRINA · cuenta creada por autorregistro, todavía sin expediente
     No es un callejón sin salida: aquí se enseñan promociones y sorteos, y
     se puede pedir la primera cita.
     ====================================================================== */
  async function vitrina() {
    const [promos, sorteos, solicitudes] = await Promise.all([
      API.listarPromociones({ soloVigentes: true }),
      API.sorteosVitrina(),
      API.misSolicitudes()
    ]);

    const pendiente = solicitudes.find((s) => s.estado === 'nueva' || s.estado === 'contactada');
    const activos = sorteos.filter((s) => s.vigente);

    const html = `
      <div class="anim-fade-up">

        <div class="bg-gradient-to-br from-brand-600 via-brand-700 to-brand-800 px-5 pb-20 pt-7 text-white">
          <p class="text-[12px] font-bold uppercase tracking-wider text-brand-200">Bienvenido a</p>
          <h2 class="mt-1 text-[26px] font-extrabold leading-tight tracking-tight">CLIDANFI</h2>
          <p class="mt-1.5 text-[13px] leading-snug text-brand-100">
            Terapia física y rehabilitación. Solicita tu primera cita y conoce los beneficios vigentes.
          </p>
        </div>

        <div class="-mt-14 space-y-4 px-4 pb-4">

          <!-- Primera cita -->
          ${pendiente ? `
            <section class="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-card">
              <div class="flex items-start gap-3">
                <span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white">${icon('check', 'h-5 w-5')}</span>
                <div class="min-w-0">
                  <p class="text-[14px] font-extrabold text-emerald-900">Solicitud recibida</p>
                  <p class="mt-0.5 text-[12.5px] leading-snug text-emerald-800">
                    ${pendiente.estado === 'contactada'
                      ? 'Ya te contactamos. En breve confirmamos tu cita.'
                      : 'La clínica se pondrá en contacto contigo para confirmar día y hora.'}
                  </p>
                  <p class="mt-1 text-[11px] font-bold text-emerald-700">Enviada ${E(relDay(pendiente.creado_en))}</p>
                </div>
              </div>
            </section>`
            : `
            <section class="rounded-2xl bg-white p-4 shadow-lift">
              <div class="flex items-start gap-3">
                <span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700">${icon('calendar', 'h-5 w-5')}</span>
                <div class="min-w-0 flex-1">
                  <p class="text-[15px] font-extrabold text-ink-900">Solicita tu primera cita</p>
                  <p class="mt-0.5 text-[12.5px] leading-snug text-ink-500">
                    Cuéntanos qué te pasa y te contactamos para agendarte.
                  </p>
                </div>
              </div>
              <button data-action="solicitar-cita"
                class="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 text-[14.5px] font-extrabold text-white active:scale-[.98]">
                ${icon('plus', 'h-4.5 w-4.5')} Pedir cita
              </button>
            </section>`}

          <!-- Promociones -->
          ${promos.length ? `
            <div>
              ${sectionTitle('Promociones vigentes')}
              <div class="space-y-2.5">
                ${promos.map((p) => `
                  <article class="overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-4 text-white shadow-card">
                    <span class="rounded-full bg-white/25 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider backdrop-blur">
                      ${E(p.etiqueta || 'Promoción')}
                    </span>
                    <h3 class="mt-2.5 text-[17px] font-extrabold leading-tight">${E(p.titulo)}</h3>
                    <p class="mt-1.5 text-[12.5px] leading-relaxed text-brand-100">${E(p.descripcion)}</p>
                    <p class="mt-2.5 flex items-center gap-1.5 border-t border-white/25 pt-2 text-[11px] font-bold text-brand-100">
                      ${icon('clock', 'h-3.5 w-3.5')} Hasta el ${E(fmtDate(p.hasta))}
                    </p>
                  </article>`).join('')}
              </div>
            </div>` : ''}

          <!-- Sorteos -->
          ${activos.length ? `
            <div>
              ${sectionTitle('Sorteos en curso')}
              <div class="space-y-2.5">
                ${activos.map((s) => `
                  <article class="rounded-2xl border border-violet-200 bg-white p-4 shadow-card">
                    <div class="flex items-start gap-3">
                      <span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-600 text-white">${icon('gift', 'h-5 w-5')}</span>
                      <div class="min-w-0 flex-1">
                        <p class="text-[14px] font-extrabold text-ink-900">${E(s.titulo)}</p>
                        <p class="mt-0.5 text-[12.5px] leading-snug text-ink-600">${E(s.premio)}</p>
                      </div>
                    </div>
                    <p class="mt-2.5 rounded-lg bg-violet-50 px-3 py-2 text-[11.5px] font-semibold leading-snug text-violet-800">
                      Empieza tu tratamiento y ganas un boleto por cada asistencia. Cierra el ${E(fmtDate(s.termina_en))}.
                    </p>
                  </article>`).join('')}
              </div>
            </div>` : ''}

          <!-- Qué obtienes al ser paciente -->
          <div class="rounded-2xl border border-ink-200 bg-white p-4">
            ${sectionTitle('Al iniciar tu tratamiento')}
            <ul class="space-y-2.5">
              ${[
                ['clipboard', 'Valoración inicial completa', 'Exploración detallada para saber exactamente qué tratar.'],
                ['dumbbell', 'Rutina personalizada', 'Ejercicios con series y repeticiones, siempre a la mano en tu celular.'],
                ['ticket', 'Boletos de sorteo', 'Uno por cada asistencia, automáticamente.']
              ].map(([ic, t, d]) => `
                <li class="flex gap-3">
                  <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-100 text-brand-700">${icon(ic, 'h-4 w-4')}</span>
                  <span class="min-w-0">
                    <span class="block text-[13px] font-bold text-ink-800">${E(t)}</span>
                    <span class="block text-[11.5px] leading-snug text-ink-500">${E(d)}</span>
                  </span>
                </li>`).join('')}
            </ul>
          </div>
        </div>
      </div>`;

    return { titulo: 'Inicio', html };
  }

  /** Panel para pedir la primera cita. */
  async function sheetSolicitarCita() {
    const sesion = App.sesion;
    openSheet({
      title: 'Solicitar primera cita',
      subtitle: 'Te contactamos para confirmar día y hora',
      body: `
        <div class="space-y-3">
          <div>
            <label class="mb-1 block text-[12px] font-bold text-ink-700">Nombre completo *</label>
            <input id="sol-nombre" class="field" value="${E(sesion ? sesion.perfil.nombre : '')}" placeholder="Nombre y apellidos" />
          </div>
          <div>
            <label class="mb-1 block text-[12px] font-bold text-ink-700">Teléfono *</label>
            <input id="sol-tel" type="tel" inputmode="tel" class="field" placeholder="667 000 0000" />
          </div>
          <div>
            <label class="mb-1 block text-[12px] font-bold text-ink-700">¿Qué te pasa?</label>
            <textarea id="sol-motivo" class="field" placeholder="Ej. dolor lumbar desde hace 3 semanas"></textarea>
          </div>
          <div>
            <label class="mb-1 block text-[12px] font-bold text-ink-700">¿Cuándo te viene mejor?</label>
            <select id="sol-pref" class="field">
              ${['Entre semana por la mañana', 'Entre semana por la tarde', 'Sábado por la mañana', 'Me acomoda cualquier horario']
                .map((o) => `<option>${o}</option>`).join('')}
            </select>
          </div>
          ${UI.avisoGuardado()}
        </div>`,
      footer: `<button id="btn-solicitar"
                 class="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3.5 text-[14px] font-extrabold text-white active:scale-[.98]">
                 ${icon('save', 'h-4.5 w-4.5')} Enviar solicitud</button>`,
      onMount: (root) => {
        const boton = root.querySelector('#btn-solicitar');
        boton.addEventListener('click', () => {
          const nombre = root.querySelector('#sol-nombre').value.trim();
          const telefono = root.querySelector('#sol-tel').value.trim();
          if (!nombre || !telefono) return toast('Escribe tu nombre y tu teléfono', 'error');

          UI.guardarConEstado(boton, () => API.crearSolicitudCita({
            nombre, telefono,
            motivo: root.querySelector('#sol-motivo').value.trim(),
            preferencia: root.querySelector('#sol-pref').value
          }), {
            textoOk: 'Solicitud enviada',
            alTerminar: () => { closeSheet(); App.render(); }
          }).catch(() => { /* el aviso ya se mostró en el panel */ });
        });
      }
    });
  }

  /* --------------------------------------- Checklist diario (local) ------ */
  const claveChecks = (pid) => `clidanfi.checks.${pid}.${isoDay(new Date())}`;
  const leerChecks = (pid) => { try { return new Set(JSON.parse(localStorage.getItem(claveChecks(pid)) || '[]')); } catch { return new Set(); } };
  const guardarChecks = (pid, set) => { try { localStorage.setItem(claveChecks(pid), JSON.stringify([...set])); } catch {} };

  /* ======================================================================
     1 · INICIO
     ====================================================================== */
  async function inicio() {
    const p = await pacienteActual();
    if (!p) return vitrina();          // autorregistro sin expediente

    const [prox, rutina, promos, sorteos] = await Promise.all([
      API.proximaCitaDePaciente(p.id),
      API.rutinaActiva(p.id),
      API.listarPromociones({ soloVigentes: true }),
      API.misBoletos(p.id)
    ]);

    const usadas = p.paquete_usadas || 0, total = p.paquete_total || 0;
    const pct = total ? Math.round((usadas / total) * 100) : 0;
    const restantes = p.paquete_restantes;

    const hora = new Date().getHours();
    const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';
    const boletosTotal = sorteos.filter((s) => s.estado === 'activo').reduce((s2, s) => s2 + s.mis_boletos_total, 0);

    const html = `
      <div class="anim-fade-up">

        <!-- Bienvenida -->
        <div class="bg-gradient-to-br from-brand-600 via-brand-700 to-brand-800 px-5 pb-20 pt-6 text-white">
          <p class="text-[13px] font-medium text-brand-100">${E(saludo)},</p>
          <h2 class="mt-0.5 text-[24px] font-extrabold leading-tight tracking-tight">${E(p.nombre.split(' ').slice(0, 2).join(' '))}</h2>
          <p class="mt-1 text-[12px] font-medium capitalize text-brand-200">${E(fmtDateLong(new Date()))}</p>
        </div>

        <div class="-mt-14 space-y-4 px-4 pb-4">

          <!-- Próxima cita -->
          ${prox ? `
            <section class="overflow-hidden rounded-2xl bg-white shadow-lift">
              <div class="flex items-center gap-2 bg-brand-50 px-4 py-2 text-brand-700">
                ${icon('calendar', 'h-4 w-4')}
                <p class="text-[11px] font-extrabold uppercase tracking-wider">Tu próxima cita</p>
              </div>
              <div class="flex items-center gap-4 px-4 py-4">
                <div class="flex w-16 shrink-0 flex-col items-center rounded-xl bg-brand-600 py-2 text-white">
                  <span class="text-[10px] font-bold uppercase">${E(UI.MESES_S[new Date(prox.inicia_en).getMonth()])}</span>
                  <span class="text-[24px] font-extrabold leading-none">${new Date(prox.inicia_en).getDate()}</span>
                  <span class="text-[9.5px] font-bold uppercase">${E(UI.DIAS_S[new Date(prox.inicia_en).getDay()])}</span>
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-[17px] font-extrabold capitalize leading-tight text-ink-900">${E(relDay(prox.inicia_en))}</p>
                  <p class="mt-0.5 flex items-center gap-1.5 text-[13.5px] font-bold text-brand-700">
                    ${icon('clock', 'h-4 w-4')} ${E(fmtTime(prox.inicia_en))}
                  </p>
                  <p class="mt-1 truncate text-[12px] text-ink-500">${E(prox.motivo)} · ${prox.duracion_min} min</p>
                </div>
              </div>
              <div class="border-t border-ink-100 px-4 py-2.5">
                <p class="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-500">
                  ${icon('info', 'h-3.5 w-3.5')} Llega 10 minutos antes con ropa cómoda.
                </p>
              </div>
            </section>`
            : card(`
              <div class="flex items-center gap-3">
                <div class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-400">${icon('calendar', 'h-5 w-5')}</div>
                <div>
                  <p class="text-[14px] font-bold text-ink-800">No tienes citas agendadas</p>
                  <p class="text-[12px] text-ink-500">Comunícate con la clínica para agendar.</p>
                </div>
              </div>`)}

          <!-- Estatus del paquete -->
          ${card(`
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-[11px] font-extrabold uppercase tracking-wider text-ink-400">Tu paquete</p>
                <p class="mt-0.5 truncate text-[15px] font-extrabold text-ink-900">${E(p.paquete_nombre)}</p>
              </div>
              ${badge(restantes === 0 ? 'Agotado' : 'Activo', restantes === 0 ? 'rose' : 'green')}
            </div>

            <div class="mt-4 flex items-center gap-4">
              <div class="relative grid h-20 w-20 shrink-0 place-items-center">
                <svg viewBox="0 0 36 36" class="absolute inset-0 h-20 w-20 -rotate-90">
                  <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e4e2dd" stroke-width="4"></circle>
                  <!-- El arco representa las sesiones que le quedan al paciente -->
                  <circle cx="18" cy="18" r="15.5" fill="none" stroke="#ad2830" stroke-width="4" stroke-linecap="round"
                          stroke-dasharray="${(97.39 * (100 - pct) / 100).toFixed(2)} 97.39"></circle>
                </svg>
                <div class="text-center">
                  <p class="text-[20px] font-extrabold leading-none text-brand-700">${restantes}</p>
                  <p class="text-[9px] font-bold uppercase text-ink-400">restantes</p>
                </div>
              </div>
              <div class="min-w-0 flex-1 space-y-1.5 text-[12.5px]">
                <p class="flex justify-between"><span class="text-ink-500">Sesiones usadas</span><span class="font-bold text-ink-800">${usadas} de ${total}</span></p>
                <p class="flex justify-between"><span class="text-ink-500">Vigencia</span><span class="font-bold text-ink-800">${p.paquete_vence ? E(fmtDate(p.paquete_vence)) : '—'}</span></p>
                <p class="flex justify-between"><span class="text-ink-500">Visitas totales</span><span class="font-bold text-ink-800">${p.total_visitas}</span></p>
              </div>
            </div>
            ${restantes <= 2 && total > 0 ? `
              <p class="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] font-semibold leading-snug text-amber-800">
                ${icon('alert', 'h-4 w-4 shrink-0')} Te quedan pocas sesiones. Pregunta por la renovación de tu paquete.
              </p>` : ''}
          `)}

          <!-- Atajos -->
          <div class="grid grid-cols-2 gap-2.5">
            <a href="#/p/rutina" class="rounded-2xl border border-brand-200 bg-brand-50 p-3.5 shadow-card active:scale-[.98]">
              <div class="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white">${icon('dumbbell', 'h-4 w-4')}</div>
              <p class="mt-2 text-[13px] font-extrabold leading-tight text-brand-900">Mi rutina</p>
              <p class="text-[11px] font-semibold text-brand-700">${rutina ? `${rutina.items.length} ejercicios` : 'Sin asignar'}</p>
            </a>
            <a href="#/p/sorteos" class="rounded-2xl border border-violet-200 bg-violet-50 p-3.5 shadow-card active:scale-[.98]">
              <div class="grid h-9 w-9 place-items-center rounded-xl bg-violet-600 text-white">${icon('ticket', 'h-4 w-4')}</div>
              <p class="mt-2 text-[13px] font-extrabold leading-tight text-violet-900">Mis boletos</p>
              <p class="text-[11px] font-semibold text-violet-700">${boletosTotal} acumulado${boletosTotal === 1 ? '' : 's'}</p>
            </a>
          </div>

          <!-- Promo destacada -->
          ${promos.length ? `
            <a href="#/p/promociones" class="block overflow-hidden rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 p-4 text-white shadow-card active:scale-[.99]">
              <div class="flex items-center gap-2">${icon('tag', 'h-4 w-4')}
                <span class="text-[10.5px] font-extrabold uppercase tracking-wider">${E(promos[0].etiqueta || 'Promoción')}</span></div>
              <p class="mt-1.5 text-[16px] font-extrabold leading-tight">${E(promos[0].titulo)}</p>
              <p class="mt-1 clamp-2 text-[12px] leading-snug text-amber-50">${E(promos[0].descripcion)}</p>
              <p class="mt-2 text-[11px] font-bold text-amber-50">Ver todas las promociones →</p>
            </a>` : ''}
        </div>
      </div>`;

    return { titulo: 'Inicio', html };
  }

  /* ======================================================================
     2 · MI RUTINA
     ====================================================================== */
  async function rutina() {
    const p = await pacienteActual();
    if (!p) return necesitaExpediente('Mi rutina', 'una rutina asignada');

    const [activa, historial] = await Promise.all([API.rutinaActiva(p.id), API.rutinasDePaciente(p.id)]);
    const previas = historial.filter((r) => !activa || r.id !== activa.id);

    if (!activa) {
      return {
        titulo: 'Mi rutina',
        html: `<div class="px-4 pt-6">${emptyState('dumbbell', 'Aún no tienes rutina', 'Tu fisioterapeuta te asignará una rutina en tu próxima sesión.')}</div>`
      };
    }

    const hechos = leerChecks(p.id);

    const tarjeta = (it, i) => {
      const ex = it.ejercicio;
      const hecho = hechos.has(it.id);
      return `
        <article data-item="${it.id}"
          class="overflow-hidden rounded-2xl border ${hecho ? 'border-emerald-300 bg-emerald-50/50' : 'border-ink-200/70 bg-white'} shadow-card transition">
          <div class="flex gap-3 p-3">
            <div class="relative shrink-0">
              <img src="${E(ex.image_url || placeholderImage(ex.nombre, ex.categoria))}" alt="${E(ex.nombre)}"
                   class="h-[86px] w-[104px] rounded-xl object-cover" loading="lazy" />
              <span class="absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-ink-900/75 text-[11px] font-extrabold text-white">${i + 1}</span>
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-[10px] font-extrabold uppercase tracking-wide text-brand-600">${E(ex.categoria)}</p>
              <h3 class="mt-0.5 text-[14px] font-extrabold leading-tight text-ink-900">${E(ex.nombre)}</h3>
              <div class="mt-2 flex flex-wrap gap-1.5">
                <span class="rounded-lg bg-brand-100 px-2 py-1 text-[11px] font-extrabold text-brand-800">${it.series} series</span>
                <span class="rounded-lg bg-brand-100 px-2 py-1 text-[11px] font-extrabold text-brand-800">${it.reps} reps</span>
                ${it.hold ? `<span class="rounded-lg bg-brand-100 px-2 py-1 text-[11px] font-extrabold text-brand-800">${it.hold} seg</span>` : ''}
              </div>
              <p class="mt-1.5 text-[11px] font-semibold text-ink-500">${icon('refresh', 'inline h-3 w-3 -mt-0.5')} ${E(it.frecuencia)}</p>
            </div>
          </div>

          ${ex.descripcion ? `
            <div class="border-t border-ink-100 px-3 py-2.5">
              <p class="text-[12px] leading-relaxed text-ink-600">${E(ex.descripcion)}</p>
              ${ex.cue ? `<p class="mt-1.5 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11.5px] font-semibold leading-snug text-amber-800">
                ${icon('info', 'h-3.5 w-3.5 shrink-0')} ${E(ex.cue)}</p>` : ''}
            </div>` : ''}

          <button data-check="${it.id}"
            class="flex w-full items-center justify-center gap-2 border-t border-ink-100 py-2.5 text-[12.5px] font-extrabold transition
            ${hecho ? 'bg-emerald-600 text-white' : 'text-ink-500'}">
            ${icon('check', 'h-4 w-4', 3)} ${hecho ? 'Completado hoy' : 'Marcar como hecho'}
          </button>
        </article>`;
    };

    const html = `
      <div class="space-y-4 px-4 pb-4 pt-4 anim-fade-up">

        <div class="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-700 p-4 text-white shadow-card">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-[10.5px] font-extrabold uppercase tracking-wider text-brand-200">Rutina activa</p>
              <h2 class="mt-0.5 truncate text-[17px] font-extrabold">${E(activa.titulo)}</h2>
              <p class="mt-0.5 text-[11.5px] font-medium text-brand-100">Asignada el ${E(fmtDate(activa.creado_en))}</p>
            </div>
            <span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/20">${icon('dumbbell', 'h-5 w-5')}</span>
          </div>
          <div class="mt-3 flex items-center gap-2 rounded-xl bg-white/15 px-3 py-2">
            <div class="min-w-0 flex-1">
              <div class="h-1.5 w-full overflow-hidden rounded-full bg-white/25">
                <div id="barra-progreso" class="h-full rounded-full bg-white transition-all" style="width:0%"></div>
              </div>
            </div>
            <span id="txt-progreso" class="shrink-0 text-[11.5px] font-extrabold">0/${activa.items.length}</span>
          </div>
        </div>

        ${activa.notas ? `
          <div class="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-3">
            ${icon('info', 'h-4 w-4 shrink-0 text-amber-600')}
            <div>
              <p class="text-[11px] font-extrabold uppercase tracking-wide text-amber-700">Indicaciones</p>
              <p class="mt-0.5 text-[12.5px] font-semibold leading-snug text-amber-900">${E(activa.notas)}</p>
            </div>
          </div>` : ''}

        <div id="lista-ejercicios" class="space-y-3">
          ${activa.items.map(tarjeta).join('')}
        </div>

        ${previas.length ? `
          <div>
            ${sectionTitle('Rutinas anteriores')}
            <div class="space-y-2">
              ${previas.map((r) => `
                <button data-rutina-prev="${r.id}"
                  class="flex w-full items-center gap-3 rounded-2xl border border-ink-200/70 bg-white p-3 text-left shadow-card active:scale-[.99]">
                  <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-500">${icon('layers', 'h-4 w-4')}</span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-[13px] font-bold text-ink-800">${E(r.titulo)}</p>
                    <p class="text-[11.5px] text-ink-400">${E(fmtDate(r.creado_en))} · ${r.items.length} ejercicios</p>
                  </div>
                  ${icon('chevronR', 'h-4 w-4 shrink-0 text-ink-300')}
                </button>`).join('')}
            </div>
          </div>` : ''}
      </div>`;

    const onMount = (root) => {
      const barra = root.querySelector('#barra-progreso');
      const txt = root.querySelector('#txt-progreso');
      const total = activa.items.length;

      const actualizarProgreso = () => {
        const n = activa.items.filter((it) => hechos.has(it.id)).length;
        barra.style.width = `${total ? (n / total) * 100 : 0}%`;
        txt.textContent = `${n}/${total}`;
      };
      actualizarProgreso();

      root.querySelector('#lista-ejercicios').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-check]');
        if (!btn) return;
        const id = btn.dataset.check;
        hechos.has(id) ? hechos.delete(id) : hechos.add(id);
        guardarChecks(p.id, hechos);

        const art = root.querySelector(`[data-item="${id}"]`);
        const on = hechos.has(id);
        art.className = `overflow-hidden rounded-2xl border ${on ? 'border-emerald-300 bg-emerald-50/50' : 'border-ink-200/70 bg-white'} shadow-card transition`;
        btn.className = `flex w-full items-center justify-center gap-2 border-t border-ink-100 py-2.5 text-[12.5px] font-extrabold transition ${on ? 'bg-emerald-600 text-white' : 'text-ink-500'}`;
        btn.innerHTML = `${icon('check', 'h-4 w-4', 3)} ${on ? 'Completado hoy' : 'Marcar como hecho'}`;

        actualizarProgreso();
        if (activa.items.every((it) => hechos.has(it.id))) toast('¡Rutina completada por hoy! 💪');
      });

      // Ver una rutina anterior
      root.querySelectorAll('[data-rutina-prev]').forEach((b) => b.addEventListener('click', () => {
        const r = previas.find((x) => x.id === b.dataset.rutinaPrev);
        openSheet({
          title: r.titulo,
          subtitle: `${fmtDate(r.creado_en)} · ${r.items.length} ejercicios`,
          size: 'mid',
          body: `<div class="space-y-2">${r.items.map((it) => `
            <div class="flex items-center gap-3 rounded-xl border border-ink-200 bg-white p-2">
              <img src="${E(it.ejercicio.image_url || placeholderImage(it.ejercicio.nombre, it.ejercicio.categoria))}"
                   alt="" class="h-12 w-16 shrink-0 rounded-lg object-cover" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-[12.5px] font-bold text-ink-800">${E(it.ejercicio.nombre)}</p>
                <p class="text-[11px] font-semibold text-ink-500">${it.series} × ${it.reps}${it.hold ? ` · ${it.hold}s` : ''} · ${E(it.frecuencia)}</p>
              </div>
            </div>`).join('')}</div>`
        });
      }));
    };

    return { titulo: 'Mi rutina', html, onMount };
  }

  /* ======================================================================
     3 · PROMOCIONES
     ====================================================================== */
  async function promociones() {
    const list = await API.listarPromociones();
    const vigentes = list.filter((p) => p.vigente);
    const pasadas = list.filter((p) => !p.vigente);

    const COLORES = {
      brand:  ['from-brand-500 to-brand-700', 'text-brand-50'],
      amber:  ['from-amber-400 to-amber-600', 'text-amber-50'],
      violet: ['from-violet-500 to-violet-700', 'text-violet-50'],
      ink:    ['from-ink-500 to-ink-700', 'text-ink-100']
    };

    const tarjeta = (p) => {
      const [grad, sub] = COLORES[p.color] || COLORES.brand;
      return `
        <article class="overflow-hidden rounded-2xl bg-gradient-to-br ${grad} p-4 text-white shadow-card">
          <div class="flex items-start justify-between gap-3">
            <span class="rounded-full bg-white/25 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider backdrop-blur">
              ${E(p.etiqueta || 'Promoción')}
            </span>
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/20">${icon('tag', 'h-4 w-4')}</span>
          </div>
          <h3 class="mt-3 text-[18px] font-extrabold leading-tight">${E(p.titulo)}</h3>
          <p class="mt-1.5 text-[12.5px] leading-relaxed ${sub}">${E(p.descripcion)}</p>
          <div class="mt-3 flex items-center gap-1.5 border-t border-white/25 pt-2.5 text-[11px] font-bold ${sub}">
            ${icon('clock', 'h-3.5 w-3.5')} Vigente hasta el ${E(fmtDate(p.hasta))}
          </div>
        </article>`;
    };

    const html = `
      <div class="space-y-4 px-4 pb-4 pt-4 anim-fade-up">
        <div class="px-1">
          <h2 class="text-[20px] font-extrabold tracking-tight text-ink-900">Promociones</h2>
          <p class="mt-0.5 text-[12.5px] text-ink-500">Beneficios vigentes para pacientes de CLIDANFI.</p>
        </div>

        ${vigentes.length ? vigentes.map(tarjeta).join('')
          : emptyState('tag', 'Sin promociones vigentes', 'Muy pronto tendremos nuevos beneficios para ti.')}

        ${pasadas.length ? `
          <div class="pt-2">
            ${sectionTitle('Promociones anteriores')}
            <div class="space-y-2">
              ${pasadas.map((p) => `
                <div class="rounded-2xl border border-ink-200 bg-white p-3 opacity-70 shadow-card">
                  <p class="text-[13px] font-extrabold text-ink-800">${E(p.titulo)}</p>
                  <p class="mt-0.5 clamp-2 text-[12px] leading-snug text-ink-500">${E(p.descripcion)}</p>
                  <p class="mt-1 text-[10.5px] font-bold text-ink-400">Finalizó el ${E(fmtDate(p.hasta))}</p>
                </div>`).join('')}
            </div>
          </div>` : ''}

        <div class="rounded-2xl border border-brand-200 bg-brand-50 p-4">
          <p class="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-brand-700">
            ${icon('phone', 'h-3.5 w-3.5')} ¿Te interesa alguna?
          </p>
          <p class="mt-1 text-[12.5px] font-semibold leading-snug text-brand-900">
            Pregunta en recepción o coméntalo en tu próxima sesión para aplicarla.
          </p>
        </div>
      </div>`;

    return { titulo: 'Promociones', html };
  }

  /* ======================================================================
     4 · SORTEOS
     ====================================================================== */
  async function sorteos() {
    const p = await pacienteActual();
    if (!p) return necesitaExpediente('Sorteos', 'boletos acumulados');

    const list = await API.misBoletos(p.id);
    const activos = list.filter((s) => s.estado === 'activo');
    const pasados = list.filter((s) => s.estado !== 'activo');
    const totalBoletos = activos.reduce((s, x) => s + x.mis_boletos_total, 0);

    const tarjetaActiva = (s) => `
      <article class="overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-card">
        <header class="bg-gradient-to-br from-violet-600 to-violet-800 px-4 py-4 text-white">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-[10.5px] font-extrabold uppercase tracking-wider text-violet-200">Sorteo activo</p>
              <h3 class="mt-0.5 text-[17px] font-extrabold leading-tight">${E(s.titulo)}</h3>
            </div>
            <span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/20">${icon('gift', 'h-5 w-5')}</span>
          </div>
          <div class="mt-3 rounded-xl bg-white/15 px-3 py-2.5 backdrop-blur">
            <p class="text-[10px] font-extrabold uppercase tracking-wider text-violet-200">Premio</p>
            <p class="mt-0.5 text-[13.5px] font-bold leading-snug">${E(s.premio)}</p>
          </div>
        </header>

        <div class="px-4 py-4">
          <div class="flex items-center gap-3 rounded-2xl bg-violet-50 p-3.5">
            <div class="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-violet-600 text-white">
              <span class="text-[22px] font-extrabold leading-none">${s.mis_boletos_total}</span>
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-[13.5px] font-extrabold text-violet-900">
                ${s.mis_boletos_total === 0 ? 'Aún no tienes boletos' : `Tienes ${s.mis_boletos_total} boleto${s.mis_boletos_total === 1 ? '' : 's'}`}
              </p>
              <p class="text-[11.5px] font-semibold leading-snug text-violet-700">
                ${s.mis_boletos_total === 0 ? 'Asiste a tu terapia para participar.' : 'Cada asistencia suma un boleto más.'}
              </p>
            </div>
          </div>

          ${s.mis_boletos_total ? `
            <p class="mb-2 mt-3 text-[10.5px] font-extrabold uppercase tracking-wider text-ink-400">Tus boletos</p>
            <div class="flex flex-wrap gap-1.5">
              ${s.mis_boletos.map((c) => `
                <span class="rounded-lg border border-dashed border-violet-300 bg-violet-50 px-2.5 py-1 font-mono text-[11.5px] font-extrabold tracking-wider text-violet-800">${E(c)}</span>`).join('')}
            </div>` : ''}

          <div class="mt-3 grid grid-cols-3 gap-2 border-t border-ink-100 pt-3 text-center">
            <div><p class="text-[15px] font-extrabold text-ink-900">${s.total_participantes}</p><p class="text-[10px] font-bold uppercase text-ink-400">Participan</p></div>
            <div><p class="text-[15px] font-extrabold text-ink-900">${s.total_boletos}</p><p class="text-[10px] font-bold uppercase text-ink-400">Boletos</p></div>
            <div><p class="text-[15px] font-extrabold text-ink-900">${s.dias_restantes}</p><p class="text-[10px] font-bold uppercase text-ink-400">Días</p></div>
          </div>

          ${s.descripcion ? `<p class="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-[11.5px] leading-snug text-ink-600">${E(s.descripcion)}</p>` : ''}
          <p class="mt-2 text-center text-[11px] font-semibold text-ink-400">Cierra el ${E(fmtDate(s.termina_en))}</p>
        </div>
      </article>`;

    const tarjetaPasada = (s) => `
      <article class="overflow-hidden rounded-2xl border ${s.soy_ganador ? 'border-amber-300' : 'border-ink-200'} bg-white shadow-card">
        <div class="flex items-start gap-3 p-3.5">
          <span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl ${s.soy_ganador ? 'bg-amber-400 text-white' : 'bg-ink-100 text-ink-400'}">
            ${icon('award', 'h-5 w-5')}
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-[13.5px] font-extrabold text-ink-900">${E(s.titulo)}</p>
            <p class="mt-0.5 clamp-2 text-[11.5px] leading-snug text-ink-500">${E(s.premio)}</p>
            <p class="mt-1 text-[10.5px] font-bold text-ink-400">Finalizó el ${E(fmtDate(s.termina_en))}</p>
          </div>
        </div>
        <div class="border-t ${s.soy_ganador ? 'border-amber-200 bg-amber-50' : 'border-ink-100 bg-ink-50'} px-3.5 py-2.5">
          ${s.ganador_nombre ? `
            <p class="text-[10px] font-extrabold uppercase tracking-wider ${s.soy_ganador ? 'text-amber-700' : 'text-ink-400'}">Ganador</p>
            <p class="mt-0.5 text-[13px] font-extrabold ${s.soy_ganador ? 'text-amber-900' : 'text-ink-800'}">
              ${s.soy_ganador ? '🎉 ¡Ganaste tú!' : E(s.ganador_nombre)}
              <span class="ml-1 font-mono text-[11px] font-bold opacity-70">${E(s.ganador_boleto || '')}</span>
            </p>
            ${s.mis_boletos_total && !s.soy_ganador ? `<p class="mt-0.5 text-[11px] font-semibold text-ink-500">Participaste con ${s.mis_boletos_total} boleto${s.mis_boletos_total === 1 ? '' : 's'}.</p>` : ''}`
            : `<p class="text-[12px] font-semibold text-ink-500">Ganador por anunciar.</p>`}
        </div>
      </article>`;

    const html = `
      <div class="space-y-4 px-4 pb-4 pt-4 anim-fade-up">
        <div class="flex items-center gap-3 rounded-2xl bg-gradient-to-br from-violet-600 to-violet-700 px-4 py-4 text-white shadow-card">
          <span class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/20">${icon('ticket', 'h-6 w-6')}</span>
          <div class="min-w-0 flex-1">
            <p class="text-[10.5px] font-extrabold uppercase tracking-wider text-violet-200">Total acumulado</p>
            <p class="text-[22px] font-extrabold leading-none">${totalBoletos} boleto${totalBoletos === 1 ? '' : 's'}</p>
            <p class="mt-1 text-[11.5px] font-medium text-violet-100">Ganas 1 boleto por cada asistencia.</p>
          </div>
        </div>

        ${activos.length ? activos.map(tarjetaActiva).join('')
          : emptyState('gift', 'No hay sorteos activos', 'Te avisaremos cuando comience el siguiente sorteo.')}

        ${pasados.length ? `
          <div class="pt-2">
            ${sectionTitle('Sorteos anteriores')}
            <div class="space-y-2">${pasados.map(tarjetaPasada).join('')}</div>
          </div>` : ''}
      </div>`;

    return { titulo: 'Sorteos', html };
  }

  global.VistaPaciente = { inicio, rutina, promociones, sorteos, pacienteActual, vitrina, sheetSolicitarCita };
})(window);
