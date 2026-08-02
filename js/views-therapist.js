/* ==========================================================================
   CLIDANFI · views-therapist.js  ·  VISTA FISIOTERAPEUTA
   Cada vista devuelve { titulo, html, onMount? }.
   Nunca toca localStorage: solo habla con API.*
   ========================================================================== */
(function (global) {
  'use strict';

  const {
    escapeHtml: E, icon, avatar, badge, emptyState, sectionTitle,
    fmtMoney, fmtMoneyShort, fmtTime, fmtDate, fmtDateLong, fmtDateTime, relDay,
    toLocalInput, isoDay, addDays, startOfDay, placeholderImage, readImageCompressed,
    toast, openSheet, closeSheet, confirmSheet, uid
  } = UI;

  /* ======================================================================
     BLOQUES REUTILIZABLES
     ====================================================================== */

  const card = (inner, cls = '') =>
    `<section class="rounded-2xl border border-ink-200/70 bg-white p-4 shadow-card ${cls}">${inner}</section>`;

  /**
   * Botón flotante. Va dentro de un contenedor con el mismo ancho máximo que
   * la app para que quede alineado al marco también en escritorio.
   */
  const fab = (accion, aria, color = 'bg-brand-600') => `
    <div class="pointer-events-none fixed bottom-24 left-1/2 z-20 flex w-full max-w-[480px] -translate-x-1/2 justify-end px-4">
      <button data-action="${accion}" aria-label="${E(aria)}"
        class="pointer-events-auto grid h-14 w-14 place-items-center rounded-full ${color} text-white shadow-lift active:scale-95">
        ${icon('plus', 'h-6 w-6', 2.4)}
      </button>
    </div>`;

  const ESTADO_CITA = {
    agendada:   ['brand', 'Agendada'],
    completada: ['green', 'Atendida'],
    no_asistio: ['rose', 'No asistió'],
    cancelada:  ['ink', 'Cancelada']
  };

  /** Tarjeta de cita reutilizada en dashboard, agenda y ficha. */
  function citaRow(c, { conFecha = false } = {}) {
    const [tone, label] = ESTADO_CITA[c.estado] || ESTADO_CITA.agendada;
    return `
      <button data-action="cita-menu" data-id="${c.id}"
        class="flex w-full items-center gap-3 rounded-2xl border border-ink-200/70 bg-white p-3 text-left shadow-card transition active:scale-[.99]">
        <div class="flex w-14 shrink-0 flex-col items-center rounded-xl bg-brand-50 py-1.5 text-brand-800">
          <span class="text-[13px] font-extrabold leading-none">${E(fmtTime(c.inicia_en).replace(/\s?[ap]\.m\./, ''))}</span>
          <span class="mt-0.5 text-[9px] font-bold uppercase">${E((fmtTime(c.inicia_en).match(/[ap]\.m\./) || [''])[0])}</span>
        </div>
        ${avatar(c.paciente_nombre, 'h-9 w-9 text-[11px]')}
        <div class="min-w-0 flex-1">
          <p class="truncate text-[14px] font-bold text-ink-900">${E(c.paciente_nombre)}</p>
          <p class="truncate text-[12px] text-ink-500">${E(c.motivo)} · ${c.duracion_min} min</p>
          ${conFecha ? `<p class="mt-0.5 text-[11px] font-semibold text-ink-400">${E(fmtDate(c.inicia_en))}</p>` : ''}
        </div>
        <div class="flex shrink-0 flex-col items-end gap-1">
          ${badge(label, tone)}
          ${icon('chevronR', 'h-4 w-4 text-ink-300')}
        </div>
      </button>`;
  }

  /** Fila de la lista de pacientes. */
  function pacienteRow(p) {
    const restantes = p.paquete_restantes;
    const tonePaq = restantes === 0 ? 'rose' : restantes <= 2 ? 'amber' : 'green';
    return `
      <a href="#/t/paciente/${p.id}"
        class="flex items-center gap-3 rounded-2xl border border-ink-200/70 bg-white p-3 shadow-card transition active:scale-[.99]">
        ${avatar(p.nombre)}
        <div class="min-w-0 flex-1">
          <p class="truncate text-[14.5px] font-bold text-ink-900">${E(p.nombre)}</p>
          <p class="truncate text-[12px] text-ink-500">${E(p.diagnostico || 'Sin diagnóstico registrado')}</p>
          <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span class="inline-flex items-center gap-1 text-[11px] font-bold ${p.ultima_asistencia ? 'text-brand-700' : 'text-ink-400'}">
              ${icon('clock', 'h-3 w-3')} ${E(relDay(p.ultima_asistencia))}
            </span>
            ${badge(`${restantes} de ${p.paquete_total || 0}`, tonePaq)}
          </div>
        </div>
        ${icon('chevronR', 'h-4 w-4 shrink-0 text-ink-300')}
      </a>`;
  }

  /* ======================================================================
     1 · DASHBOARD
     ====================================================================== */
  async function dashboard() {
    const [r, cfg] = await Promise.all([API.resumenDashboard(), API.getConfig()]);
    const { ingresos } = r;
    const max = Math.max(1, ...ingresos.porDia.map((d) => d.total));

    const hora = new Date().getHours();
    const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';

    const barras = ingresos.porDia.map((d) => {
      const h = Math.round((d.total / max) * 72) || 3;
      return `
        <div class="flex flex-1 flex-col items-center gap-1.5">
          <span class="text-[9px] font-bold ${d.total ? 'text-brand-700' : 'text-transparent'}">${E(fmtMoneyShort(d.total))}</span>
          <div class="flex h-[76px] w-full items-end justify-center">
            <div class="bar w-full max-w-[22px] rounded-t-md ${d.esHoy ? 'bg-brand-600' : d.total ? 'bg-brand-300' : 'bg-ink-200'}"
                 style="height:${h}px" title="${E(d.label)}: ${E(fmtMoney(d.total))}"></div>
          </div>
          <span class="text-[10px] font-bold ${d.esHoy ? 'text-brand-700' : 'text-ink-400'}">${E(d.label)}</span>
        </div>`;
    }).join('');

    const variacion = ingresos.variacion === null
      ? `<span class="text-[11px] font-semibold text-ink-400">Sin comparativo</span>`
      : `<span class="inline-flex items-center gap-1 rounded-full ${ingresos.variacion >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'} px-2 py-0.5 text-[11px] font-extrabold">
           ${icon('trendingUp', `h-3 w-3 ${ingresos.variacion >= 0 ? '' : 'rotate-180'}`)} ${ingresos.variacion >= 0 ? '+' : ''}${ingresos.variacion}%
         </span>`;

    // El tono se pasa como clases completas: Tailwind purga las que se
    // construyen por interpolación (`bg-${x}-100` nunca llegaría al CSS).
    const kpi = (ico, valor, label, tono = 'bg-brand-100 text-brand-700') => `
      <div class="flex-1 rounded-2xl border border-ink-200/70 bg-white p-3 shadow-card">
        <div class="mb-1.5 grid h-8 w-8 place-items-center rounded-lg ${tono}">${icon(ico, 'h-4 w-4')}</div>
        <p class="text-[19px] font-extrabold leading-none text-ink-900">${E(valor)}</p>
        <p class="mt-1 text-[11px] font-semibold leading-tight text-ink-500">${E(label)}</p>
      </div>`;

    const html = `
      <div class="space-y-4 px-4 pt-4 anim-fade-up">

        <!-- Saludo -->
        <div class="px-1">
          <p class="text-[12px] font-semibold text-ink-500">${E(saludo)},</p>
          <h2 class="text-[20px] font-extrabold tracking-tight text-ink-900">${E(cfg.fisio)}</h2>
          <p class="mt-0.5 text-[12px] font-medium capitalize text-ink-400">${E(fmtDateLong(new Date()))}</p>
        </div>

        <!-- Ingresos de la semana -->
        ${card(`
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-[11px] font-extrabold uppercase tracking-wider text-ink-400">Ingresos de la semana</p>
              <p class="mt-1 text-[28px] font-extrabold leading-none tracking-tight text-ink-900">${E(fmtMoney(ingresos.total))}</p>
              <div class="mt-2 flex items-center gap-2">
                ${variacion}
                <span class="text-[11px] font-medium text-ink-400">vs. ${E(fmtMoney(ingresos.semanaAnterior))}</span>
              </div>
            </div>
            <div class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white">${icon('wallet', 'h-5 w-5')}</div>
          </div>
          <div class="mt-4 flex items-end gap-1.5">${barras}</div>
          <p class="mt-2 text-center text-[10.5px] font-medium text-ink-400">
            ${E(fmtDate(ingresos.inicio))} – ${E(fmtDate(ingresos.fin))} · Ticket prom. ${E(fmtMoney(r.ticket_promedio))}
          </p>
        `)}

        <!-- KPIs -->
        <div class="flex gap-2.5">
          ${kpi('calendar', `${r.citas_hoy_pendientes}`, 'Citas pendientes hoy')}
          ${kpi('check', `${r.atendidos_hoy}`, 'Atendidos hoy', 'bg-emerald-100 text-emerald-700')}
          ${kpi('users', `${r.atendidos_semana}`, 'Sesiones esta semana', 'bg-amber-100 text-amber-700')}
        </div>

        <!-- Agenda de hoy -->
        <div>
          ${sectionTitle('Agenda de hoy',
            `<a href="#/t/agenda" class="text-[12px] font-bold text-brand-700">Ver todo</a>`)}
          <div class="space-y-2">
            ${r.citas_hoy.length
              ? r.citas_hoy.map((c) => citaRow(c)).join('')
              : emptyState('calendar', 'Sin citas para hoy', 'Agenda una cita desde la pestaña Agenda.')}
          </div>
        </div>

        <!-- Accesos rápidos -->
        <div>
          ${sectionTitle('Accesos rápidos')}
          <div class="grid grid-cols-2 gap-2.5">
            ${[
              ['nuevo-paciente', 'users', 'Nuevo paciente', 'bg-brand-100 text-brand-700'],
              ['nueva-cita', 'calendar', 'Agendar cita', 'bg-blue-100 text-blue-700'],
              ['nuevo-sorteo', 'gift', 'Crear sorteo', 'bg-violet-100 text-violet-700'],
              ['nueva-promo', 'tag', 'Nueva promoción', 'bg-amber-100 text-amber-700']
            ].map(([act, ic, label, tono]) => `
              <button data-action="${act}"
                class="flex items-center gap-2.5 rounded-2xl border border-ink-200/70 bg-white p-3 text-left shadow-card active:scale-[.98]">
                <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tono}">${icon(ic, 'h-4 w-4')}</span>
                <span class="text-[12.5px] font-bold leading-tight text-ink-800">${E(label)}</span>
              </button>`).join('')}
          </div>
        </div>

        <!-- Estado del marketing -->
        <div class="flex gap-2.5">
          <a href="#/t/sorteos" class="flex-1 rounded-2xl border border-violet-200 bg-violet-50 p-3.5 shadow-card active:scale-[.98]">
            <div class="flex items-center gap-2 text-violet-800">${icon('gift', 'h-4 w-4')}<span class="text-[11px] font-extrabold uppercase tracking-wide">Sorteos</span></div>
            <p class="mt-1.5 text-[20px] font-extrabold leading-none text-violet-900">${r.sorteos_activos}</p>
            <p class="text-[11px] font-semibold text-violet-700">activos ahora</p>
          </a>
          <button data-action="ver-promos" class="flex-1 rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-left shadow-card active:scale-[.98]">
            <div class="flex items-center gap-2 text-amber-800">${icon('tag', 'h-4 w-4')}<span class="text-[11px] font-extrabold uppercase tracking-wide">Promos</span></div>
            <p class="mt-1.5 text-[20px] font-extrabold leading-none text-amber-900">${r.promos_vigentes}</p>
            <p class="text-[11px] font-semibold text-amber-700">vigentes</p>
          </button>
        </div>
      </div>`;

    return { titulo: 'Inicio', html };
  }

  /* ======================================================================
     2 · AGENDA
     ====================================================================== */
  async function agenda(_params, query) {
    const filtro = query.f || 'proximas';
    const citas = filtro === 'hoy' ? await API.citasDeHoy() : await API.proximasCitas({ dias: 21 });

    // Agrupa por día
    const grupos = new Map();
    citas.forEach((c) => {
      const k = isoDay(c.inicia_en);
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(c);
    });

    const tab = (v, label) => `
      <a href="#/t/agenda?f=${v}"
        class="flex-1 rounded-xl py-2 text-center text-[12.5px] font-bold transition
        ${filtro === v ? 'bg-white text-brand-700 shadow-sm' : 'text-ink-500'}">${E(label)}</a>`;

    const html = `
      <div class="space-y-4 px-4 pt-4 anim-fade-up">
        <div class="flex gap-1 rounded-2xl bg-ink-100 p-1">
          ${tab('hoy', 'Hoy')}${tab('proximas', 'Próximas')}
        </div>

        ${grupos.size === 0
          ? emptyState('calendar', 'No hay citas en este periodo', 'Toca el botón + para agendar una nueva cita.')
          : [...grupos.entries()].map(([dia, list]) => `
              <div>
                <div class="mb-2 flex items-center gap-2 px-1">
                  <h3 class="text-[13px] font-extrabold capitalize text-ink-800">${E(relDay(dia))}</h3>
                  <span class="text-[11px] font-semibold text-ink-400">${E(fmtDate(dia))}</span>
                  <span class="ml-auto rounded-full bg-ink-100 px-2 py-0.5 text-[10.5px] font-bold text-ink-600">${list.length} cita${list.length === 1 ? '' : 's'}</span>
                </div>
                <div class="space-y-2">${list.map((c) => citaRow(c)).join('')}</div>
              </div>`).join('')}
      </div>

      ${fab('nueva-cita', 'Agendar cita', 'bg-brand-600')}`;

    return { titulo: 'Agenda', html };
  }

  /* ======================================================================
     3 · LISTA DE PACIENTES
     ====================================================================== */
  let _busqueda = '';

  async function pacientes() {
    const list = await API.listarPacientes({ q: _busqueda });

    const html = `
      <div class="anim-fade-up">
        <!-- Buscador -->
        <div class="sticky top-0 z-10 bg-ink-50/95 px-4 pb-3 pt-4 backdrop-blur">
          <div class="relative">
            <span class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400">${icon('search', 'h-4.5 w-4.5')}</span>
            <input id="buscador-pacientes" type="search" inputmode="search" autocomplete="off"
              value="${E(_busqueda)}" placeholder="Buscar por nombre, diagnóstico o teléfono"
              class="field !pl-11 !pr-10 !py-3 !rounded-2xl shadow-card" />
            ${_busqueda ? `<button data-action="limpiar-busqueda" aria-label="Limpiar"
              class="absolute right-3 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-ink-200 text-ink-600">
              ${icon('x', 'h-3.5 w-3.5')}</button>` : ''}
          </div>
          <p class="mt-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold text-ink-400">
            ${icon('filter', 'h-3.5 w-3.5')} Ordenados por última asistencia · ${list.length} paciente${list.length === 1 ? '' : 's'}
          </p>
        </div>

        <div class="space-y-2 px-4 pb-4">
          ${list.length
            ? list.map(pacienteRow).join('')
            : emptyState('users', _busqueda ? 'Sin resultados' : 'Aún no hay pacientes',
                _busqueda ? `No encontramos pacientes que coincidan con "${_busqueda}".` : 'Registra al primer paciente con el botón +.')}
        </div>
      </div>

      ${fab('nuevo-paciente', 'Nuevo paciente', 'bg-brand-600')}`;

    const onMount = (root) => {
      const input = root.querySelector('#buscador-pacientes');
      if (!input) return;
      let t;
      input.addEventListener('input', (e) => {
        _busqueda = e.target.value;
        clearTimeout(t);
        t = setTimeout(async () => {
          const nuevos = await API.listarPacientes({ q: _busqueda });
          const cont = root.querySelector('.space-y-2.px-4.pb-4');
          if (cont) {
            cont.innerHTML = nuevos.length
              ? nuevos.map(pacienteRow).join('')
              : emptyState('users', 'Sin resultados', `No encontramos pacientes que coincidan con "${_busqueda}".`);
          }
          const meta = root.querySelector('p.mt-2');
          if (meta) meta.innerHTML = `${icon('filter', 'h-3.5 w-3.5')} Ordenados por última asistencia · ${nuevos.length} paciente${nuevos.length === 1 ? '' : 's'}`;
        }, 180);
      });
    };

    return { titulo: 'Pacientes', html, onMount };
  }

  /* ======================================================================
     4 · FICHA DEL PACIENTE
     ====================================================================== */
  async function paciente(params, query) {
    const id = params.id;
    const p = await API.obtenerPaciente(id);
    if (!p) return { titulo: 'Paciente', html: `<div class="p-4">${emptyState('alert', 'Paciente no encontrado')}</div>` };

    const tab = query.tab || 'resumen';
    const usadas = p.paquete_usadas || 0, total = p.paquete_total || 0;
    const pct = total ? Math.round((usadas / total) * 100) : 0;

    const tabs = [
      ['resumen', 'Resumen'], ['valoracion', 'Valoración'],
      ['historial', 'Historial'], ['rutinas', 'Rutinas']
    ].map(([k, label]) => `
      <a href="#/t/paciente/${id}?tab=${k}"
        class="shrink-0 rounded-xl px-3.5 py-2 text-[12.5px] font-bold transition
        ${tab === k ? 'bg-brand-600 text-white shadow-sm' : 'bg-white text-ink-600 border border-ink-200'}">${E(label)}</a>`).join('');

    const contenido =
      tab === 'valoracion' ? await tabValoracion(p) :
      tab === 'historial'  ? await tabHistorial(p)  :
      tab === 'rutinas'    ? await tabRutinas(p)    :
                             await tabResumen(p, { usadas, total, pct });

    const html = `
      <div class="anim-fade-up">
        <!-- Encabezado del paciente -->
        <div class="bg-gradient-to-b from-brand-700 to-brand-600 px-4 pb-16 pt-5 text-white">
          <div class="flex items-start gap-3">
            <div class="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/20 text-[17px] font-extrabold ring-1 ring-white/30 backdrop-blur">
              ${E(UI.initials(p.nombre))}
            </div>
            <div class="min-w-0 flex-1">
              <h2 class="truncate text-[18px] font-extrabold leading-tight">${E(p.nombre)}</h2>
              <p class="mt-0.5 truncate text-[12.5px] font-medium text-brand-100">${E(p.diagnostico || 'Sin diagnóstico')}</p>
              <p class="mt-1 text-[11.5px] font-medium text-brand-200">
                ${p.edad ? `${p.edad} años` : 'Edad no registrada'} · ${E(p.sexo === 'F' ? 'Femenino' : p.sexo === 'M' ? 'Masculino' : '—')} · ${p.total_visitas} visitas
              </p>
            </div>
            <button data-action="editar-paciente" data-id="${id}" aria-label="Editar paciente"
              class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15 active:scale-95">${icon('edit', 'h-4 w-4')}</button>
          </div>

          <div class="mt-4 grid grid-cols-3 gap-2">
            <button data-action="registrar-asistencia" data-id="${id}"
              class="flex flex-col items-center gap-1 rounded-xl bg-white/15 py-2.5 backdrop-blur active:scale-95">
              ${icon('check', 'h-4 w-4')}<span class="text-[10.5px] font-bold">Asistencia</span>
            </button>
            <button data-action="nueva-cita" data-id="${id}"
              class="flex flex-col items-center gap-1 rounded-xl bg-white/15 py-2.5 backdrop-blur active:scale-95">
              ${icon('calendar', 'h-4 w-4')}<span class="text-[10.5px] font-bold">Agendar</span>
            </button>
            <a href="tel:${E(String(p.telefono || '').replace(/\s/g, ''))}"
              class="flex flex-col items-center gap-1 rounded-xl bg-white/15 py-2.5 backdrop-blur active:scale-95">
              ${icon('phone', 'h-4 w-4')}<span class="text-[10.5px] font-bold">Llamar</span>
            </a>
          </div>
        </div>

        <!-- Tabs -->
        <div class="sticky top-0 z-10 -mt-12 bg-transparent px-4">
          <div class="scroll-x no-scrollbar pb-1">${tabs}</div>
        </div>

        <div class="mt-3 space-y-4 px-4 pb-6">${contenido}</div>
      </div>`;

    return { titulo: p.nombre, html, volver: '#/t/pacientes' };
  }

  /* --------------------------------------------------- Tab · Resumen ----- */
  async function tabResumen(p, { usadas, total, pct }) {
    const [asistencias, pagos, citas] = await Promise.all([
      API.asistenciasDePaciente(p.id), API.pagosDePaciente(p.id), API.citasDePaciente(p.id)
    ]);
    const totalPagado = pagos.reduce((s, x) => s + x.monto, 0);
    const prox = p.proxima_cita;

    return `
      ${card(`
        <div class="flex items-center justify-between">
          <p class="text-[11px] font-extrabold uppercase tracking-wider text-ink-400">Paquete de sesiones</p>
          ${badge(p.paquete_restantes === 0 ? 'Agotado' : `${p.paquete_restantes} restantes`, p.paquete_restantes === 0 ? 'rose' : p.paquete_restantes <= 2 ? 'amber' : 'green')}
        </div>
        <p class="mt-1.5 text-[15px] font-extrabold text-ink-900">${E(p.paquete_nombre)}</p>
        <div class="mt-2.5 h-2.5 w-full overflow-hidden rounded-full bg-ink-100">
          <div class="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600 transition-all" style="width:${pct}%"></div>
        </div>
        <div class="mt-1.5 flex justify-between text-[11.5px] font-semibold text-ink-500">
          <span>${usadas} de ${total} usadas</span>
          <span>${p.paquete_vence ? `Vence ${E(fmtDate(p.paquete_vence))}` : 'Sin vigencia'}</span>
        </div>
      `)}

      ${prox ? card(`
        <div class="flex items-center gap-3">
          <div class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700">${icon('calendar', 'h-5 w-5')}</div>
          <div class="min-w-0 flex-1">
            <p class="text-[11px] font-extrabold uppercase tracking-wider text-ink-400">Próxima cita</p>
            <p class="truncate text-[14.5px] font-bold capitalize text-ink-900">${E(relDay(prox.inicia_en))} · ${E(fmtTime(prox.inicia_en))}</p>
            <p class="truncate text-[12px] text-ink-500">${E(prox.motivo)}</p>
          </div>
        </div>`) : card(`
        <div class="flex items-center gap-3">
          <div class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-400">${icon('calendar', 'h-5 w-5')}</div>
          <div class="min-w-0 flex-1">
            <p class="text-[13.5px] font-bold text-ink-700">Sin próxima cita agendada</p>
            <button data-action="nueva-cita" data-id="${p.id}" class="mt-0.5 text-[12px] font-bold text-brand-700">Agendar ahora →</button>
          </div>
        </div>`)}

      <div class="grid grid-cols-2 gap-2.5">
        ${card(`<p class="text-[11px] font-extrabold uppercase tracking-wider text-ink-400">Total facturado</p>
                <p class="mt-1 text-[20px] font-extrabold text-ink-900">${E(fmtMoney(totalPagado))}</p>
                <p class="text-[11px] font-medium text-ink-400">${pagos.length} pagos</p>`)}
        ${card(`<p class="text-[11px] font-extrabold uppercase tracking-wider text-ink-400">Última visita</p>
                <p class="mt-1 text-[16px] font-extrabold capitalize text-ink-900">${E(relDay(p.ultima_asistencia))}</p>
                <p class="text-[11px] font-medium text-ink-400">${p.total_visitas} en total</p>`)}
      </div>

      ${card(`
        <p class="text-[11px] font-extrabold uppercase tracking-wider text-ink-400">Contacto</p>
        <div class="mt-2 space-y-1.5 text-[13px]">
          <p class="flex items-center gap-2 text-ink-700">${icon('phone', 'h-4 w-4 text-ink-400')} ${E(p.telefono || '—')}</p>
          <p class="flex items-center gap-2 text-ink-700">${icon('bell', 'h-4 w-4 text-ink-400')} ${E(p.email || '—')}</p>
          ${p.alergias ? `<p class="flex items-center gap-2 text-rose-600">${icon('alert', 'h-4 w-4')} Alergias: ${E(p.alergias)}</p>` : ''}
        </div>
      `)}

      <div>
        ${sectionTitle('Últimas asistencias')}
        <div class="space-y-2">
          ${asistencias.length ? asistencias.slice(0, 6).map((a) => `
            <div class="flex items-center gap-3 rounded-2xl border border-ink-200/70 bg-white px-3 py-2.5 shadow-card">
              <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-700">${icon('check', 'h-4 w-4')}</span>
              <div class="min-w-0 flex-1">
                <p class="text-[13px] font-bold capitalize text-ink-800">${E(relDay(a.asistio_en))}</p>
                <p class="text-[11.5px] text-ink-400">${E(fmtDateTime(a.asistio_en))}</p>
              </div>
              ${badge('+1 boleto', 'violet')}
            </div>`).join('')
            : emptyState('check', 'Sin asistencias registradas')}
        </div>
      </div>`;
  }

  /* ------------------------------------------------ Tab · Valoración ----- */
  async function tabValoracion(p) {
    const v = await API.valoracionDePaciente(p.id);

    if (!v) {
      return `
        ${emptyState('clipboard', 'Sin valoración inicial', 'Crea la valoración activando solo las secciones que necesites según la dolencia.')}
        <button data-action="abrir-valoracion" data-id="${p.id}"
          class="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 text-[14px] font-bold text-white shadow-card active:scale-[.98]">
          ${icon('plus', 'h-4.5 w-4.5')} Crear valoración inicial
        </button>`;
    }

    const activas = Store.SECCIONES_VALORACION.filter((s) => v.secciones_activas.includes(s.key));

    const renderValor = (campo, val) => {
      if (val === undefined || val === null || val === '' || (Array.isArray(val) && !val.length)) return null;
      if (campo.type === 'checks') return val.join(' · ');
      if (campo.type === 'range') return `${val}${campo.suffix || ''}`;
      if (campo.type === 'number') return `${val} ${campo.suffix || ''}`.trim();
      if (campo.type === 'rom' || campo.type === 'mmt') {
        const filas = Object.entries(val).filter(([, r]) => r && (r.izq || r.der));
        return filas.length ? filas.map(([k, r]) => `${k}: I ${r.izq || '—'} / D ${r.der || '—'}`).join(' · ') : null;
      }
      if (campo.type === 'tests') {
        const marcados = Object.entries(val).filter(([, r]) => r && r !== 'NE');
        return marcados.length ? marcados.map(([k, r]) => `${k}: ${r}`).join(' · ') : null;
      }
      return String(val);
    };

    return `
      <div class="flex items-center justify-between rounded-2xl border border-brand-200 bg-brand-50 px-3.5 py-3">
        <div>
          <p class="text-[11px] font-extrabold uppercase tracking-wider text-brand-700">Valoración inicial</p>
          <p class="text-[13px] font-bold text-brand-900">${E(fmtDate(v.creado_en))} · ${activas.length} secciones</p>
        </div>
        <button data-action="abrir-valoracion" data-id="${p.id}"
          class="flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-2 text-[12.5px] font-bold text-white active:scale-95">
          ${icon('edit', 'h-3.5 w-3.5')} Editar
        </button>
      </div>

      ${activas.map((sec) => {
        const datos = v.datos[sec.key] || {};
        const filas = sec.campos.map((c) => {
          const txt = renderValor(c, datos[c.key]);
          return txt ? `
            <div class="border-t border-ink-100 py-2 first:border-0 first:pt-0">
              <p class="text-[10.5px] font-extrabold uppercase tracking-wide text-ink-400">${E(c.label)}</p>
              <p class="mt-0.5 text-[13px] leading-snug text-ink-800">${E(txt)}</p>
            </div>` : '';
        }).filter(Boolean).join('');

        return card(`
          <div class="mb-2 flex items-center gap-2">
            <span class="grid h-7 w-7 place-items-center rounded-lg bg-brand-100 text-brand-700">${icon(sec.icono, 'h-3.5 w-3.5')}</span>
            <h3 class="text-[13.5px] font-extrabold text-ink-900">${E(sec.titulo)}</h3>
          </div>
          ${filas || `<p class="text-[12.5px] italic text-ink-400">Sección activada sin datos capturados.</p>`}
        `);
      }).join('')}`;
  }

  /* -------------------------------------------------- Tab · Historial ---- */
  async function tabHistorial(p) {
    const notas = await API.notasDePaciente(p.id);
    const fotos = notas.flatMap((n) => (n.adjuntos || []).map((a) => ({ ...a, nota_id: n.id })));

    return `
      <button data-action="nueva-nota" data-id="${p.id}"
        class="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 text-[14px] font-bold text-white shadow-card active:scale-[.98]">
        ${icon('plus', 'h-4.5 w-4.5')} Nueva nota de evolución
      </button>

      ${fotos.length ? `
        <div>
          ${sectionTitle(`Evidencias (${fotos.length})`)}
          <div class="scroll-x no-scrollbar">
            ${fotos.map((f) => `
              <button data-action="ver-foto" data-url="${E(f.url)}" data-titulo="${E(f.titulo)}"
                class="w-28 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card active:scale-95">
                <img src="${E(f.url)}" alt="${E(f.titulo)}" class="h-24 w-full object-cover" loading="lazy" />
                <p class="truncate px-1.5 py-1 text-left text-[10px] font-bold text-ink-600">${E(f.titulo)}</p>
              </button>`).join('')}
          </div>
        </div>` : ''}

      <div>
        ${sectionTitle('Notas de evolución')}
        ${notas.length ? `
          <div class="relative space-y-3 pl-5">
            <div class="absolute bottom-2 left-[7px] top-2 w-px bg-ink-200"></div>
            ${notas.map((n) => `
              <article class="relative">
                <span class="absolute -left-[19px] top-3.5 h-3 w-3 rounded-full border-2 border-white bg-brand-500 ring-1 ring-brand-200"></span>
                ${card(`
                  <div class="flex items-start justify-between gap-2">
                    <div>
                      <p class="text-[12.5px] font-extrabold capitalize text-ink-900">${E(relDay(n.creado_en))}</p>
                      <p class="text-[11px] font-medium text-ink-400">${E(fmtDateTime(n.creado_en))}</p>
                    </div>
                    <div class="flex shrink-0 items-center gap-1.5">
                      ${n.eva !== null && n.eva !== undefined ? badge(`EVA ${n.eva}/10`, n.eva >= 7 ? 'rose' : n.eva >= 4 ? 'amber' : 'green') : ''}
                      <button data-action="borrar-nota" data-id="${n.id}" aria-label="Eliminar nota"
                        class="grid h-7 w-7 place-items-center rounded-lg bg-ink-100 text-ink-500 active:scale-90">${icon('trash', 'h-3.5 w-3.5')}</button>
                    </div>
                  </div>
                  <p class="mt-2 text-[13px] leading-relaxed text-ink-700">${E(n.texto)}</p>
                  ${(n.adjuntos || []).length ? `
                    <div class="mt-2.5 flex gap-2 overflow-x-auto no-scrollbar">
                      ${n.adjuntos.map((a) => `
                        <button data-action="ver-foto" data-url="${E(a.url)}" data-titulo="${E(a.titulo)}"
                          class="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-ink-200 active:scale-95">
                          <img src="${E(a.url)}" alt="${E(a.titulo)}" class="h-full w-full object-cover" loading="lazy" />
                        </button>`).join('')}
                    </div>` : ''}
                `)}
              </article>`).join('')}
          </div>`
          : emptyState('clipboard', 'Sin notas de evolución', 'Registra la evolución sesión a sesión y adjunta fotos de las pruebas.')}
      </div>`;
  }

  /* ---------------------------------------------------- Tab · Rutinas ---- */
  async function tabRutinas(p) {
    const rutinas = await API.rutinasDePaciente(p.id);

    const itemMini = (it) => `
      <div class="flex items-center gap-2.5 border-t border-ink-100 py-2 first:border-0">
        <img src="${E(it.ejercicio.image_url || placeholderImage(it.ejercicio.nombre, it.ejercicio.categoria))}"
             alt="${E(it.ejercicio.nombre)}" class="h-11 w-14 shrink-0 rounded-lg object-cover" loading="lazy" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-[12.5px] font-bold text-ink-800">${E(it.ejercicio.nombre)}</p>
          <p class="text-[11px] font-semibold text-ink-500">
            ${it.series} × ${it.reps}${it.hold ? ` · ${it.hold}s` : ''} · ${E(it.frecuencia)}
          </p>
        </div>
      </div>`;

    return `
      <button data-action="abrir-rutina" data-id="${p.id}"
        class="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 text-[14px] font-bold text-white shadow-card active:scale-[.98]">
        ${icon('plus', 'h-4.5 w-4.5')} Generar nueva rutina
      </button>

      ${rutinas.length ? rutinas.map((r, i) => `
        <section class="overflow-hidden rounded-2xl border ${r.activa ? 'border-brand-300 ring-2 ring-brand-100' : 'border-ink-200/70'} bg-white shadow-card">
          <header class="flex items-start gap-2 px-4 pt-3.5">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <h3 class="truncate text-[14px] font-extrabold text-ink-900">${E(r.titulo)}</h3>
                ${r.activa ? badge('Activa', 'brand') : ''}
              </div>
              <p class="mt-0.5 text-[11.5px] font-medium text-ink-400">${E(fmtDate(r.creado_en))} · ${r.items.length} ejercicios</p>
            </div>
            <div class="flex shrink-0 gap-1">
              ${!r.activa ? `<button data-action="activar-rutina" data-id="${r.id}" title="Marcar como activa"
                class="grid h-8 w-8 place-items-center rounded-lg bg-brand-100 text-brand-700 active:scale-90">${icon('check', 'h-4 w-4')}</button>` : ''}
              <button data-action="editar-rutina" data-id="${p.id}" data-rid="${r.id}" aria-label="Editar rutina"
                class="grid h-8 w-8 place-items-center rounded-lg bg-ink-100 text-ink-600 active:scale-90">${icon('edit', 'h-3.5 w-3.5')}</button>
              <button data-action="borrar-rutina" data-id="${r.id}" aria-label="Eliminar rutina"
                class="grid h-8 w-8 place-items-center rounded-lg bg-ink-100 text-ink-500 active:scale-90">${icon('trash', 'h-3.5 w-3.5')}</button>
            </div>
          </header>
          ${r.notas ? `<p class="mx-4 mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11.5px] font-medium leading-snug text-amber-800">${E(r.notas)}</p>` : ''}
          <div class="px-4 pb-3 pt-1">${r.items.map(itemMini).join('')}</div>
        </section>`).join('')
        : emptyState('dumbbell', 'Sin rutinas asignadas', 'Arma la primera rutina desde el catálogo visual de ejercicios.')}`;
  }

  /* ======================================================================
     5 · VALORACIÓN INICIAL DINÁMICA (pantalla completa)
     ====================================================================== */
  async function valoracion(params) {
    const p = await API.obtenerPaciente(params.id);
    if (!p) return { titulo: 'Valoración', html: `<div class="p-4">${emptyState('alert', 'Paciente no encontrado')}</div>` };

    const v = await API.valoracionDePaciente(p.id);
    const activas = new Set(v ? v.secciones_activas : ['general', 'dolor', 'diagnostico']);
    const datos = v ? v.datos : {};

    /* --- Render de un campo según su tipo --- */
    function campo(sec, c) {
      const val = (datos[sec.key] || {})[c.key];
      const name = `${sec.key}.${c.key}`;
      const label = `<label class="mb-1 block text-[12px] font-bold text-ink-700">${E(c.label)}</label>`;

      switch (c.type) {
        case 'textarea':
          return `<div>${label}<textarea class="field" data-f="${name}" placeholder="${E(c.placeholder || '')}">${E(val || '')}</textarea></div>`;

        case 'number':
          return `<div>${label}<div class="flex items-center gap-2">
            <input type="number" inputmode="decimal" class="field" data-f="${name}" value="${E(val ?? '')}" />
            ${c.suffix ? `<span class="shrink-0 text-[12px] font-bold text-ink-400">${E(c.suffix)}</span>` : ''}
          </div></div>`;

        case 'select':
          return `<div>${label}<select class="field" data-f="${name}">
            <option value="">— Selecciona —</option>
            ${c.options.map((o) => `<option ${val === o ? 'selected' : ''}>${E(o)}</option>`).join('')}
          </select></div>`;

        case 'range': {
          const v0 = val ?? 0;
          const color = v0 >= 7 ? 'text-rose-600' : v0 >= 4 ? 'text-amber-600' : 'text-emerald-600';
          return `<div>
            <div class="mb-1 flex items-center justify-between">
              <label class="text-[12px] font-bold text-ink-700">${E(c.label)}</label>
              <output class="text-[15px] font-extrabold ${color}" data-out="${name}">${v0}${E(c.suffix || '')}</output>
            </div>
            <input type="range" class="eva" min="${c.min}" max="${c.max}" step="${c.step}" value="${v0}" data-f="${name}" data-range="1" />
            <div class="flex justify-between text-[10px] font-semibold text-ink-400"><span>Sin dolor</span><span>Máximo</span></div>
          </div>`;
        }

        case 'checks': {
          const set = new Set(Array.isArray(val) ? val : []);
          return `<div>${label}<div class="flex flex-wrap gap-1.5">
            ${c.options.map((o) => `
              <label class="cursor-pointer">
                <input type="checkbox" class="peer sr-only" data-f="${name}" data-multi="1" value="${E(o)}" ${set.has(o) ? 'checked' : ''} />
                <span class="inline-block rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-ink-600
                  peer-checked:border-brand-500 peer-checked:bg-brand-50 peer-checked:text-brand-800">${E(o)}</span>
              </label>`).join('')}
          </div></div>`;
        }

        case 'rom':
        case 'mmt': {
          const obj = val || {};
          const esRom = c.type === 'rom';
          return `<div>${label}
            <div class="overflow-hidden rounded-xl border border-ink-200 bg-white p-2">
              <table class="tbl">
                <thead><tr><th>Movimiento / músculo</th><th class="w-[70px] text-center">Izq.</th><th class="w-[70px] text-center">Der.</th></tr></thead>
                <tbody>
                  ${c.rows.map((row) => {
                    const r = obj[row] || {};
                    const attrs = esRom ? 'type="number" inputmode="numeric" placeholder="°"' : 'type="number" min="0" max="5" step="1" inputmode="numeric" placeholder="0-5"';
                    return `<tr>
                      <td class="text-[12px] font-semibold text-ink-700">${E(row)}</td>
                      <td><input ${attrs} data-f="${name}" data-row="${E(row)}" data-side="izq" value="${E(r.izq ?? '')}" /></td>
                      <td><input ${attrs} data-f="${name}" data-row="${E(row)}" data-side="der" value="${E(r.der ?? '')}" /></td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div></div>`;
        }

        case 'tests': {
          const obj = val || {};
          return `<div>${label}
            <div class="space-y-1.5">
              ${c.options.map((t) => {
                const cur = obj[t] || 'NE';
                const op = (v2, txt, cls) => `
                  <label class="cursor-pointer">
                    <input type="radio" class="peer sr-only" name="${E(name + '::' + t)}" data-f="${name}" data-row="${E(t)}" data-test="1" value="${v2}" ${cur === v2 ? 'checked' : ''} />
                    <span class="inline-block rounded-lg px-2.5 py-1 text-[11px] font-bold text-ink-500 ${cls}">${txt}</span>
                  </label>`;
                return `<div class="flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2">
                  <span class="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink-700">${E(t)}</span>
                  ${op('Pos', 'Positivo', 'peer-checked:bg-rose-100 peer-checked:text-rose-700')}
                  ${op('Neg', 'Negativo', 'peer-checked:bg-emerald-100 peer-checked:text-emerald-700')}
                  ${op('NE', 'N/E', 'peer-checked:bg-ink-200 peer-checked:text-ink-700')}
                </div>`;
              }).join('')}
            </div></div>`;
        }

        default:
          return `<div>${label}<input type="text" class="field" data-f="${name}" value="${E(val ?? '')}" placeholder="${E(c.placeholder || '')}" /></div>`;
      }
    }

    const secciones = Store.SECCIONES_VALORACION.map((sec) => {
      const on = sec.always || activas.has(sec.key);
      return `
        <section data-sec="${sec.key}" class="overflow-hidden rounded-2xl border ${on ? 'border-brand-200' : 'border-ink-200/70'} bg-white shadow-card transition">
          <header class="flex items-center gap-3 px-4 py-3">
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl ${on ? 'bg-brand-100 text-brand-700' : 'bg-ink-100 text-ink-400'}">
              ${icon(sec.icono, 'h-4 w-4')}
            </span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-[13.5px] font-extrabold text-ink-900">${E(sec.titulo)}</p>
              <p class="truncate text-[11px] font-medium text-ink-400">${E(sec.resumen)}</p>
            </div>
            ${sec.always
              ? badge('Obligatoria', 'brand')
              : `<label class="relative inline-flex shrink-0 cursor-pointer items-center">
                   <input type="checkbox" class="peer sr-only" data-toggle-sec="${sec.key}" ${on ? 'checked' : ''} />
                   <span class="h-6 w-11 rounded-full bg-ink-200 transition peer-checked:bg-brand-600"></span>
                   <span class="pointer-events-none absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5"></span>
                 </label>`}
          </header>
          <div data-body="${sec.key}" class="${on ? '' : 'hidden'} space-y-3.5 border-t border-ink-100 px-4 py-4">
            ${sec.campos.map((c) => campo(sec, c)).join('')}
          </div>
        </section>`;
    }).join('');

    const html = `
      <div class="space-y-3.5 px-4 pb-32 pt-4 anim-fade-up">
        <div class="rounded-2xl bg-brand-50 px-4 py-3">
          <p class="text-[11px] font-extrabold uppercase tracking-wider text-brand-700">Valoración inicial</p>
          <p class="text-[15px] font-extrabold text-brand-900">${E(p.nombre)}</p>
          <p class="mt-1 text-[11.5px] font-medium leading-snug text-brand-700">
            Activa únicamente las secciones que apliquen a la dolencia. Las obligatorias siempre se guardan.
          </p>
        </div>
        ${secciones}
      </div>

      <div class="fixed bottom-0 left-1/2 z-20 w-full max-w-[480px] -translate-x-1/2 border-t border-ink-200 bg-white/95 px-4 py-3 backdrop-blur nav-safe">
        <button data-action="guardar-valoracion" data-id="${p.id}" data-vid="${v ? v.id : ''}"
          class="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 text-[14.5px] font-extrabold text-white shadow-card active:scale-[.98]">
          ${icon('save', 'h-4.5 w-4.5')} Guardar valoración
        </button>
      </div>`;

    const onMount = (root) => {
      // Activar / desactivar secciones
      root.querySelectorAll('[data-toggle-sec]').forEach((chk) => {
        chk.addEventListener('change', () => {
          const key = chk.dataset.toggleSec;
          const body = root.querySelector(`[data-body="${key}"]`);
          const sec = root.querySelector(`[data-sec="${key}"]`);
          body.classList.toggle('hidden', !chk.checked);
          sec.classList.toggle('border-brand-200', chk.checked);
          sec.classList.toggle('border-ink-200/70', !chk.checked);
          const badgeIcon = sec.querySelector('header > span');
          badgeIcon.className = `grid h-9 w-9 shrink-0 place-items-center rounded-xl ${chk.checked ? 'bg-brand-100 text-brand-700' : 'bg-ink-100 text-ink-400'}`;
          if (chk.checked) body.classList.add('anim-fade');
        });
      });

      // Salida en vivo de los sliders EVA
      root.querySelectorAll('[data-range]').forEach((r) => {
        r.addEventListener('input', () => {
          const out = root.querySelector(`[data-out="${r.dataset.f}"]`);
          if (!out) return;
          const suf = out.textContent.replace(/^[\d.]+/, '');
          out.textContent = r.value + suf;
          const v0 = Number(r.value);
          out.className = `text-[15px] font-extrabold ${v0 >= 7 ? 'text-rose-600' : v0 >= 4 ? 'text-amber-600' : 'text-emerald-600'}`;
        });
      });
    };

    return { titulo: 'Valoración inicial', html, onMount, volver: `#/t/paciente/${p.id}?tab=valoracion` };
  }

  /** Lee el formulario de valoración del DOM y arma el objeto de datos. */
  function leerValoracion(root) {
    const activas = ['general', 'diagnostico'];
    root.querySelectorAll('[data-toggle-sec]').forEach((c) => { if (c.checked) activas.push(c.dataset.toggleSec); });

    const datos = {};
    const put = (path, value) => {
      const [sec, key] = path.split('.');
      datos[sec] = datos[sec] || {};
      datos[sec][key] = value;
    };

    // Campos simples
    root.querySelectorAll('[data-f]:not([data-multi]):not([data-row])').forEach((el) => {
      put(el.dataset.f, el.type === 'number' || el.dataset.range ? (el.value === '' ? null : Number(el.value)) : el.value);
    });

    // Checks múltiples
    const multi = {};
    root.querySelectorAll('[data-multi]').forEach((el) => {
      multi[el.dataset.f] = multi[el.dataset.f] || [];
      if (el.checked) multi[el.dataset.f].push(el.value);
    });
    Object.entries(multi).forEach(([k, v]) => put(k, v));

    // Tablas ROM / MMT
    const tablas = {};
    root.querySelectorAll('[data-row][data-side]').forEach((el) => {
      const f = el.dataset.f;
      tablas[f] = tablas[f] || {};
      tablas[f][el.dataset.row] = tablas[f][el.dataset.row] || {};
      tablas[f][el.dataset.row][el.dataset.side] = el.value === '' ? null : Number(el.value);
    });
    Object.entries(tablas).forEach(([k, v]) => put(k, v));

    // Pruebas especiales
    const tests = {};
    root.querySelectorAll('[data-test]:checked').forEach((el) => {
      tests[el.dataset.f] = tests[el.dataset.f] || {};
      tests[el.dataset.f][el.dataset.row] = el.value;
    });
    Object.entries(tests).forEach(([k, v]) => put(k, v));

    return { secciones_activas: [...new Set(activas)], datos };
  }

  /* ======================================================================
     6 · GENERADOR DE RUTINAS (catálogo visual)
     ====================================================================== */
  async function rutinaEditor(params, query) {
    const p = await API.obtenerPaciente(params.id);
    if (!p) return { titulo: 'Rutina', html: `<div class="p-4">${emptyState('alert', 'Paciente no encontrado')}</div>` };

    let base = null;
    if (query.rid) {
      const todas = await API.rutinasDePaciente(p.id);
      base = todas.find((r) => r.id === query.rid) || null;
    }

    const seleccion = base
      ? base.items.map((it) => ({ ejercicio_id: it.ejercicio_id, series: it.series, reps: it.reps, hold: it.hold, frecuencia: it.frecuencia, nota: it.nota }))
      : [];

    const cats = ['Todas', ...Store.CATEGORIAS_EJERCICIO];

    const tarjetaCatalogo = (ex) => `
      <button data-ex="${ex.id}"
        class="group relative w-[132px] overflow-hidden rounded-2xl border border-ink-200 bg-white text-left shadow-card active:scale-95">
        <img src="${E(ex.image_url || placeholderImage(ex.nombre, ex.categoria))}" alt="${E(ex.nombre)}"
             class="h-20 w-full object-cover" loading="lazy" />
        <span data-check="${ex.id}" class="absolute right-1.5 top-1.5 hidden grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-white shadow">
          ${icon('check', 'h-3.5 w-3.5', 3)}
        </span>
        <div class="p-2">
          <p class="line-clamp-2 clamp-2 text-[11.5px] font-bold leading-tight text-ink-800">${E(ex.nombre)}</p>
          <p class="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-600">${E(ex.categoria)}</p>
        </div>
      </button>`;

    const html = `
      <div class="space-y-4 px-4 pb-40 pt-4 anim-fade-up">

        <div class="rounded-2xl bg-brand-50 px-4 py-3">
          <p class="text-[11px] font-extrabold uppercase tracking-wider text-brand-700">${base ? 'Editar rutina' : 'Nueva rutina'}</p>
          <p class="text-[15px] font-extrabold text-brand-900">${E(p.nombre)}</p>
        </div>

        ${card(`
          <label class="mb-1 block text-[12px] font-bold text-ink-700">Título de la rutina</label>
          <input id="rut-titulo" class="field" value="${E(base ? base.titulo : 'Fase 1 · inicial')}" placeholder="Ej. Fase 2 · fortalecimiento" />
          <label class="mb-1 mt-3 block text-[12px] font-bold text-ink-700">Indicaciones generales</label>
          <textarea id="rut-notas" class="field" placeholder="Ej. Realizar 5 días a la semana. Suspender si el dolor supera 5/10.">${E(base ? base.notas : '')}</textarea>
        `)}

        <!-- Catálogo -->
        <div>
          ${sectionTitle('Catálogo de ejercicios')}
          <div class="scroll-x no-scrollbar mb-2.5">
            ${cats.map((c, i) => `
              <button data-cat="${E(c)}"
                class="chip-cat rounded-full border px-3 py-1.5 text-[12px] font-bold transition
                ${i === 0 ? 'border-brand-500 bg-brand-600 text-white' : 'border-ink-200 bg-white text-ink-600'}">${E(c)}</button>`).join('')}
          </div>
          <div class="relative mb-2.5">
            <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">${icon('search', 'h-4 w-4')}</span>
            <input id="ex-buscar" type="search" placeholder="Buscar ejercicio…" class="field !pl-10 !py-2.5" />
          </div>
          <div id="catalogo" class="scroll-x no-scrollbar pb-1">
            ${Store.CATALOGO_EJERCICIOS.map(tarjetaCatalogo).join('')}
          </div>
        </div>

        <!-- Seleccionados -->
        <div>
          ${sectionTitle('Ejercicios de la rutina', `<span id="conteo-sel" class="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-extrabold text-brand-800">0</span>`)}
          <div id="seleccionados" class="space-y-2"></div>
        </div>
      </div>

      <div class="fixed bottom-0 left-1/2 z-20 w-full max-w-[480px] -translate-x-1/2 border-t border-ink-200 bg-white/95 px-4 py-3 backdrop-blur nav-safe">
        <button data-action="guardar-rutina" data-id="${p.id}" data-rid="${base ? base.id : ''}"
          class="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 text-[14.5px] font-extrabold text-white shadow-card active:scale-[.98]">
          ${icon('save', 'h-4.5 w-4.5')} Guardar y activar rutina
        </button>
      </div>`;

    const onMount = (root) => {
      const cont = root.querySelector('#seleccionados');
      const conteo = root.querySelector('#conteo-sel');
      const catalogo = root.querySelector('#catalogo');

      const filaSeleccion = (sel, idx) => {
        const ex = Store.ejercicio(sel.ejercicio_id);
        return `
          <div class="rounded-2xl border border-ink-200/70 bg-white p-2.5 shadow-card" data-sel="${idx}">
            <div class="flex items-center gap-2.5">
              <img src="${E(ex.image_url || placeholderImage(ex.nombre, ex.categoria))}" alt="" class="h-12 w-14 shrink-0 rounded-lg object-cover" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-[12.5px] font-bold text-ink-800">${E(ex.nombre)}</p>
                <p class="truncate text-[10.5px] font-semibold uppercase tracking-wide text-brand-600">${E(ex.categoria)}</p>
              </div>
              <div class="flex shrink-0 gap-1">
                <button data-move="-1" data-idx="${idx}" aria-label="Subir" class="grid h-7 w-7 place-items-center rounded-lg bg-ink-100 text-ink-500 active:scale-90">${icon('chevronD', 'h-3.5 w-3.5 rotate-180')}</button>
                <button data-move="1" data-idx="${idx}" aria-label="Bajar" class="grid h-7 w-7 place-items-center rounded-lg bg-ink-100 text-ink-500 active:scale-90">${icon('chevronD', 'h-3.5 w-3.5')}</button>
                <button data-quitar="${idx}" aria-label="Quitar" class="grid h-7 w-7 place-items-center rounded-lg bg-rose-100 text-rose-600 active:scale-90">${icon('x', 'h-3.5 w-3.5')}</button>
              </div>
            </div>
            <div class="mt-2 grid grid-cols-4 gap-1.5">
              ${[['series', 'Series', sel.series], ['reps', 'Reps', sel.reps], ['hold', 'Seg.', sel.hold]].map(([k, lbl, v]) => `
                <div>
                  <label class="mb-0.5 block text-center text-[9.5px] font-extrabold uppercase tracking-wide text-ink-400">${lbl}</label>
                  <input type="number" min="0" inputmode="numeric" value="${v}" data-idx="${idx}" data-campo="${k}"
                    class="w-full rounded-lg border border-ink-200 py-1.5 text-center text-[13px] font-bold text-ink-800 focus:border-brand-500 focus:outline-none" />
                </div>`).join('')}
              <div>
                <label class="mb-0.5 block text-center text-[9.5px] font-extrabold uppercase tracking-wide text-ink-400">Frec.</label>
                <select data-idx="${idx}" data-campo="frecuencia"
                  class="w-full rounded-lg border border-ink-200 py-1.5 text-center text-[11px] font-bold text-ink-800 focus:border-brand-500 focus:outline-none">
                  ${['Diario', '5 × semana', '3 × semana', '2 × semana'].map((f) => `<option ${sel.frecuencia === f ? 'selected' : ''}>${f}</option>`).join('')}
                </select>
              </div>
            </div>
          </div>`;
      };

      const pintar = () => {
        cont.innerHTML = seleccion.length
          ? seleccion.map(filaSeleccion).join('')
          : emptyState('dumbbell', 'Aún no hay ejercicios', 'Toca las tarjetas del catálogo para agregarlos.');
        conteo.textContent = seleccion.length;
        // marca los seleccionados en el catálogo
        catalogo.querySelectorAll('[data-check]').forEach((chk) => {
          const on = seleccion.some((s) => s.ejercicio_id === chk.dataset.check);
          chk.classList.toggle('hidden', !on);
          chk.classList.toggle('grid', on);
        });
      };

      // Añadir / quitar desde el catálogo
      catalogo.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-ex]');
        if (!btn) return;
        const exId = btn.dataset.ex;
        const i = seleccion.findIndex((s) => s.ejercicio_id === exId);
        if (i >= 0) { seleccion.splice(i, 1); }
        else {
          const ex = Store.ejercicio(exId);
          seleccion.push({ ejercicio_id: exId, series: ex.sets, reps: ex.reps, hold: ex.hold, frecuencia: 'Diario', nota: '' });
        }
        pintar();
      });

      // Editar / reordenar / quitar en la lista
      cont.addEventListener('input', (e) => {
        const el = e.target.closest('[data-campo]');
        if (!el) return;
        const i = Number(el.dataset.idx);
        seleccion[i][el.dataset.campo] = el.dataset.campo === 'frecuencia' ? el.value : Number(el.value) || 0;
      });
      cont.addEventListener('change', (e) => {
        const el = e.target.closest('select[data-campo]');
        if (el) seleccion[Number(el.dataset.idx)].frecuencia = el.value;
      });
      cont.addEventListener('click', (e) => {
        const quitar = e.target.closest('[data-quitar]');
        if (quitar) { seleccion.splice(Number(quitar.dataset.quitar), 1); return pintar(); }
        const mover = e.target.closest('[data-move]');
        if (mover) {
          const i = Number(mover.dataset.idx), j = i + Number(mover.dataset.move);
          if (j < 0 || j >= seleccion.length) return;
          [seleccion[i], seleccion[j]] = [seleccion[j], seleccion[i]];
          pintar();
        }
      });

      // Filtros del catálogo
      let cat = 'Todas', q = '';
      const filtrar = () => {
        const term = UI.normalize(q);
        const list = Store.CATALOGO_EJERCICIOS.filter((ex) =>
          (cat === 'Todas' || ex.categoria === cat) &&
          (!term || UI.normalize(ex.nombre).includes(term) || UI.normalize(ex.descripcion).includes(term)));
        catalogo.innerHTML = list.length ? list.map(tarjetaCatalogo).join('')
          : `<p class="px-2 py-6 text-[12.5px] font-semibold text-ink-400">Sin ejercicios en esta categoría.</p>`;
        pintar();
      };
      root.querySelectorAll('.chip-cat').forEach((b) => b.addEventListener('click', () => {
        cat = b.dataset.cat;
        root.querySelectorAll('.chip-cat').forEach((x) => {
          const on = x === b;
          x.className = `chip-cat rounded-full border px-3 py-1.5 text-[12px] font-bold transition ${on ? 'border-brand-500 bg-brand-600 text-white' : 'border-ink-200 bg-white text-ink-600'}`;
        });
        filtrar();
      }));
      root.querySelector('#ex-buscar').addEventListener('input', (e) => { q = e.target.value; filtrar(); });

      pintar();
      // Expone la selección para el handler de guardado
      global.__rutinaSeleccion = seleccion;
    };

    return { titulo: base ? 'Editar rutina' : 'Nueva rutina', html, onMount, volver: `#/t/paciente/${p.id}?tab=rutinas` };
  }

  /* ======================================================================
     7 · SORTEOS / RIFAS
     ====================================================================== */
  async function sorteos() {
    const list = await API.listarSorteos();

    const tarjeta = (s) => {
      const activo = s.estado === 'activo';
      const tone = activo ? 'brand' : s.estado === 'sorteado' ? 'violet' : 'ink';
      return `
        <section class="overflow-hidden rounded-2xl border ${activo ? 'border-brand-200' : 'border-ink-200/70'} bg-white shadow-card">
          <header class="flex items-start gap-3 bg-gradient-to-br ${activo ? 'from-brand-600 to-brand-700' : 'from-ink-600 to-ink-700'} px-4 py-3.5 text-white">
            <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/20">${icon('gift', 'h-5 w-5')}</span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <h3 class="truncate text-[14.5px] font-extrabold">${E(s.titulo)}</h3>
                ${badge(activo ? (s.vigente ? 'Activo' : 'Fuera de fecha') : s.estado === 'sorteado' ? 'Sorteado' : 'Cerrado', 'ink')}
              </div>
              <p class="mt-0.5 line-clamp-2 clamp-2 text-[12px] leading-snug text-white/85">${E(s.premio)}</p>
            </div>
            <button data-action="editar-sorteo" data-id="${s.id}" aria-label="Editar sorteo"
              class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/15 active:scale-90">${icon('edit', 'h-3.5 w-3.5')}</button>
          </header>

          <div class="grid grid-cols-3 divide-x divide-ink-100 border-b border-ink-100">
            ${[[s.total_boletos, 'Boletos'], [s.total_participantes, 'Participantes'], [activo ? s.dias_restantes : 0, 'Días restantes']]
              .map(([v, l]) => `<div class="px-2 py-2.5 text-center">
                  <p class="text-[17px] font-extrabold leading-none text-ink-900">${v}</p>
                  <p class="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-400">${l}</p>
                </div>`).join('')}
          </div>

          <div class="px-4 py-3">
            <p class="text-[11.5px] font-medium text-ink-500">
              ${icon('clock', 'inline h-3.5 w-3.5 -mt-0.5')} ${E(fmtDate(s.inicia_en))} – ${E(fmtDate(s.termina_en))}
            </p>

            ${s.ganador_nombre ? `
              <div class="mt-2.5 flex items-center gap-2.5 rounded-xl bg-amber-50 px-3 py-2.5 ring-1 ring-amber-200">
                <span class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-400 text-white">${icon('award', 'h-5 w-5')}</span>
                <div class="min-w-0 flex-1">
                  <p class="text-[10.5px] font-extrabold uppercase tracking-wide text-amber-700">Ganador</p>
                  <p class="truncate text-[13.5px] font-extrabold text-amber-900">${E(s.ganador_nombre)}</p>
                  <p class="text-[11px] font-bold text-amber-700">Boleto ${E(s.ganador_boleto || '')}</p>
                </div>
                ${badge(s.publicado ? 'Publicado' : 'Sin publicar', s.publicado ? 'green' : 'amber')}
              </div>` : ''}

            <div class="mt-3 flex flex-wrap gap-2">
              <button data-action="ver-participantes" data-id="${s.id}"
                class="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-ink-100 py-2.5 text-[12.5px] font-bold text-ink-700 active:scale-95">
                ${icon('users', 'h-4 w-4')} Participantes
              </button>
              ${s.ganador_paciente_id
                ? `<button data-action="publicar-sorteo" data-id="${s.id}" data-pub="${s.publicado ? '0' : '1'}"
                     class="flex flex-1 items-center justify-center gap-1.5 rounded-xl ${s.publicado ? 'bg-ink-100 text-ink-700' : 'bg-emerald-600 text-white'} py-2.5 text-[12.5px] font-bold active:scale-95">
                     ${icon(s.publicado ? 'x' : 'check', 'h-4 w-4')} ${s.publicado ? 'Ocultar' : 'Publicar'}
                   </button>`
                : `<button data-action="realizar-sorteo" data-id="${s.id}" ${s.total_boletos ? '' : 'disabled'}
                     class="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-violet-600 py-2.5 text-[12.5px] font-bold text-white active:scale-95 disabled:opacity-40">
                     ${icon('shuffle', 'h-4 w-4')} Sortear
                   </button>`}
            </div>
          </div>
        </section>`;
    };

    const html = `
      <div class="space-y-4 px-4 pb-4 pt-4 anim-fade-up">
        <div class="rounded-2xl bg-gradient-to-br from-violet-600 to-violet-700 px-4 py-4 text-white shadow-card">
          <div class="flex items-center gap-2">${icon('sparkles', 'h-4 w-4')}
            <p class="text-[11px] font-extrabold uppercase tracking-wider">Programa de fidelidad</p></div>
          <p class="mt-1.5 text-[13px] leading-snug text-violet-100">
            Cada asistencia registrada genera <strong class="text-white">1 boleto automático</strong> en todos los sorteos activos vigentes.
          </p>
        </div>

        ${list.length ? list.map(tarjeta).join('')
          : emptyState('gift', 'Sin sorteos creados', 'Crea el primer sorteo para premiar la constancia de tus pacientes.')}
      </div>

      ${fab('nuevo-sorteo', 'Nuevo sorteo', 'bg-violet-600')}`;

    return { titulo: 'Sorteos', html };
  }

  /* ======================================================================
     8 · SHEETS (formularios y acciones)
     ====================================================================== */

  const val = (root, sel) => { const el = root.querySelector(sel); return el ? el.value.trim() : ''; };

  /* --- Nuevo / editar paciente --------------------------------------- */
  async function sheetPaciente(id = null) {
    const p = id ? await API.obtenerPaciente(id) : null;
    openSheet({
      title: p ? 'Editar paciente' : 'Nuevo paciente',
      subtitle: p ? p.nombre : 'Registra los datos básicos',
      size: 'tall',
      body: `
        <div class="space-y-3">
          <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Nombre completo *</label>
            <input id="f-nombre" class="field" value="${E(p ? p.nombre : '')}" placeholder="Nombre y apellidos" /></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Edad</label>
              <input id="f-edad" type="number" inputmode="numeric" class="field" value="${E(p ? p.edad ?? '' : '')}" /></div>
            <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Sexo</label>
              <select id="f-sexo" class="field">
                <option value="">—</option>
                <option value="F" ${p && p.sexo === 'F' ? 'selected' : ''}>Femenino</option>
                <option value="M" ${p && p.sexo === 'M' ? 'selected' : ''}>Masculino</option>
              </select></div>
          </div>
          <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Teléfono</label>
            <input id="f-tel" type="tel" inputmode="tel" class="field" value="${E(p ? p.telefono : '')}" placeholder="667 000 0000" /></div>
          <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Correo</label>
            <input id="f-email" type="email" inputmode="email" class="field" value="${E(p ? p.email : '')}" /></div>
          <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Diagnóstico / motivo</label>
            <input id="f-dx" class="field" value="${E(p ? p.diagnostico : '')}" placeholder="Ej. Lumbalgia mecánica" /></div>
          <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Alergias</label>
            <input id="f-alergias" class="field" value="${E(p ? p.alergias : '')}" placeholder="Opcional" /></div>

          <div class="rounded-xl bg-brand-50 p-3">
            <p class="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-brand-700">Paquete de sesiones</p>
            <input id="f-paq-nombre" class="field mb-2" value="${E(p ? p.paquete_nombre : 'Paquete 10 sesiones')}" placeholder="Nombre del paquete" />
            <div class="grid grid-cols-3 gap-2">
              <div><label class="mb-1 block text-[11px] font-bold text-ink-600">Total</label>
                <input id="f-paq-total" type="number" min="0" class="field" value="${p ? p.paquete_total : 10}" /></div>
              <div><label class="mb-1 block text-[11px] font-bold text-ink-600">Usadas</label>
                <input id="f-paq-usadas" type="number" min="0" class="field" value="${p ? p.paquete_usadas : 0}" /></div>
              <div><label class="mb-1 block text-[11px] font-bold text-ink-600">Vence</label>
                <input id="f-paq-vence" type="date" class="field" value="${p && p.paquete_vence ? isoDay(p.paquete_vence) : ''}" /></div>
            </div>
          </div>
        </div>`,
      footer: `<button id="btn-guardar-pac" class="w-full rounded-xl bg-brand-600 py-3.5 text-[14px] font-extrabold text-white active:scale-[.98]">
                 ${p ? 'Guardar cambios' : 'Registrar paciente'}</button>`,
      onMount: (root) => {
        root.querySelector('#btn-guardar-pac').addEventListener('click', async () => {
          const nombre = val(root, '#f-nombre');
          if (!nombre) return toast('El nombre es obligatorio', 'error');
          const vence = val(root, '#f-paq-vence');
          const data = {
            nombre,
            edad: Number(val(root, '#f-edad')) || null,
            sexo: val(root, '#f-sexo'),
            telefono: val(root, '#f-tel'),
            email: val(root, '#f-email'),
            diagnostico: val(root, '#f-dx'),
            alergias: val(root, '#f-alergias'),
            paquete_nombre: val(root, '#f-paq-nombre'),
            paquete_total: Number(val(root, '#f-paq-total')) || 0,
            paquete_usadas: Number(val(root, '#f-paq-usadas')) || 0,
            paquete_vence: vence ? new Date(vence + 'T20:00:00').toISOString() : null
          };
          if (p) { await API.actualizarPaciente(p.id, data); toast('Paciente actualizado'); }
          else { const nuevo = await API.crearPaciente(data); toast('Paciente registrado'); location.hash = `#/t/paciente/${nuevo.id}`; }
          closeSheet();
          App.render();
        });
      }
    });
  }

  /* --- Nueva cita ------------------------------------------------------ */
  async function sheetCita(pacienteId = null, citaId = null) {
    const pacs = await API.listarPacientes();
    const cita = citaId
      ? (await API.citasDeHoy()).concat(await API.proximasCitas({ dias: 60 })).find((c) => c.id === citaId)
      : null;

    const def = cita ? new Date(cita.inicia_en) : (() => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; })();

    openSheet({
      title: cita ? 'Reagendar cita' : 'Agendar cita',
      size: 'auto',
      body: `
        <div class="space-y-3">
          <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Paciente *</label>
            <select id="f-cita-pac" class="field">
              ${pacs.map((p) => `<option value="${p.id}" ${(cita ? cita.paciente_id : pacienteId) === p.id ? 'selected' : ''}>${E(p.nombre)}</option>`).join('')}
            </select></div>
          <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Fecha y hora *</label>
            <input id="f-cita-fecha" type="datetime-local" class="field" value="${toLocalInput(def)}" /></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Duración</label>
              <select id="f-cita-dur" class="field">
                ${[30, 45, 60, 90].map((m) => `<option value="${m}" ${(cita ? cita.duracion_min : 45) === m ? 'selected' : ''}>${m} min</option>`).join('')}
              </select></div>
            <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Motivo</label>
              <select id="f-cita-motivo" class="field">
                ${['Sesión de rehabilitación', 'Valoración inicial', 'Control y progresión', 'Terapia manual', 'Reevaluación', 'Punción seca']
                  .map((m) => `<option ${cita && cita.motivo === m ? 'selected' : ''}>${E(m)}</option>`).join('')}
              </select></div>
          </div>
          <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Notas</label>
            <textarea id="f-cita-notas" class="field" placeholder="Opcional">${E(cita ? cita.notas : '')}</textarea></div>
        </div>`,
      footer: `<button id="btn-guardar-cita" class="w-full rounded-xl bg-brand-600 py-3.5 text-[14px] font-extrabold text-white active:scale-[.98]">
                 ${cita ? 'Guardar cambios' : 'Agendar'}</button>`,
      onMount: (root) => {
        root.querySelector('#btn-guardar-cita').addEventListener('click', async () => {
          const fecha = val(root, '#f-cita-fecha');
          if (!fecha) return toast('Selecciona fecha y hora', 'error');
          const data = {
            paciente_id: val(root, '#f-cita-pac'),
            inicia_en: new Date(fecha).toISOString(),
            duracion_min: Number(val(root, '#f-cita-dur')),
            motivo: val(root, '#f-cita-motivo'),
            notas: val(root, '#f-cita-notas')
          };
          if (cita) { await API.actualizarCita(cita.id, data); toast('Cita actualizada'); }
          else { await API.crearCita(data); toast('Cita agendada'); }
          closeSheet();
          App.render();
        });
      }
    });
  }

  /* --- Menú de acciones sobre una cita -------------------------------- */
  async function sheetMenuCita(citaId) {
    const todas = (await API.citasDeHoy()).concat(await API.proximasCitas({ dias: 60 }));
    const c = todas.find((x) => x.id === citaId);
    if (!c) return toast('Cita no encontrada', 'error');

    const opt = (act, ico, label, cls = 'text-ink-700') => `
      <button data-opt="${act}" class="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left ${cls} active:bg-ink-100">
        <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-100">${icon(ico, 'h-4 w-4')}</span>
        <span class="text-[13.5px] font-bold">${E(label)}</span>
      </button>`;

    openSheet({
      title: c.paciente_nombre,
      subtitle: `${fmtDateTime(c.inicia_en)} · ${c.motivo}`,
      body: `
        <div class="space-y-1">
          ${opt('ficha', 'user', 'Abrir ficha del paciente')}
          ${c.estado === 'agendada' ? opt('asistencia', 'check', 'Registrar asistencia', 'text-emerald-700') : ''}
          ${opt('reagendar', 'calendar', 'Reagendar')}
          ${c.estado === 'agendada' ? opt('no-asistio', 'alert', 'Marcar como "no asistió"', 'text-amber-700') : ''}
          ${opt('eliminar', 'trash', 'Eliminar cita', 'text-rose-600')}
        </div>`,
      onMount: (root) => root.querySelectorAll('[data-opt]').forEach((b) => b.addEventListener('click', async () => {
        const a = b.dataset.opt;
        closeSheet();
        if (a === 'ficha') return void (location.hash = `#/t/paciente/${c.paciente_id}`);
        if (a === 'asistencia') return sheetAsistencia(c.paciente_id, c.id);
        if (a === 'reagendar') return sheetCita(c.paciente_id, c.id);
        if (a === 'no-asistio') { await API.actualizarCita(c.id, { estado: 'no_asistio' }); toast('Cita marcada como no asistida', 'warn'); return App.render(); }
        if (a === 'eliminar') {
          const ok = await confirmSheet({ title: 'Eliminar cita', message: `¿Eliminar la cita de ${c.paciente_nombre} del ${fmtDateTime(c.inicia_en)}?`, confirmText: 'Eliminar', tone: 'danger' });
          if (ok) { await API.eliminarCita(c.id); toast('Cita eliminada'); App.render(); }
        }
      }))
    });
  }

  /* --- Registrar asistencia ------------------------------------------- */
  async function sheetAsistencia(pacienteId, citaId = null) {
    const [p, cfg, sorteosActivos] = await Promise.all([
      API.obtenerPaciente(pacienteId), API.getConfig(), API.listarSorteos()
    ]);
    if (!p) return toast('Paciente no encontrado', 'error');
    const vigentes = sorteosActivos.filter((s) => s.vigente);

    openSheet({
      title: 'Registrar asistencia',
      subtitle: p.nombre,
      body: `
        <div class="space-y-3">
          <div class="flex items-center gap-3 rounded-xl bg-brand-50 p-3">
            ${avatar(p.nombre, 'h-10 w-10 text-[12px]')}
            <div class="min-w-0 flex-1">
              <p class="truncate text-[13.5px] font-bold text-brand-900">${E(p.nombre)}</p>
              <p class="text-[11.5px] font-semibold text-brand-700">Quedan ${p.paquete_restantes} de ${p.paquete_total} sesiones</p>
            </div>
          </div>

          <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Fecha y hora</label>
            <input id="f-asi-fecha" type="datetime-local" class="field" value="${toLocalInput(new Date())}" /></div>

          <label class="flex items-center gap-2.5 rounded-xl border border-ink-200 p-3">
            <input id="f-asi-cobrar" type="checkbox" checked class="h-5 w-5 rounded" />
            <span class="text-[13px] font-bold text-ink-700">Registrar cobro de esta sesión</span>
          </label>

          <div id="bloque-cobro" class="grid grid-cols-2 gap-3">
            <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Monto</label>
              <input id="f-asi-monto" type="number" inputmode="decimal" class="field" value="${cfg.precio_sesion}" /></div>
            <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Método</label>
              <select id="f-asi-metodo" class="field">${['Efectivo', 'Transferencia', 'Tarjeta'].map((m) => `<option>${m}</option>`).join('')}</select></div>
          </div>

          <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Nota rápida</label>
            <input id="f-asi-nota" class="field" placeholder="Opcional" /></div>

          ${vigentes.length ? `
            <div class="rounded-xl bg-violet-50 p-3 ring-1 ring-violet-200">
              <p class="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-violet-700">
                ${icon('ticket', 'h-3.5 w-3.5')} Se emitirán ${vigentes.length} boleto${vigentes.length === 1 ? '' : 's'}
              </p>
              <p class="mt-1 text-[12px] font-semibold leading-snug text-violet-800">${E(vigentes.map((s) => s.titulo).join(' · '))}</p>
            </div>` : ''}
        </div>`,
      footer: `<button id="btn-guardar-asi" class="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 text-[14px] font-extrabold text-white active:scale-[.98]">
                 ${icon('check', 'h-4.5 w-4.5')} Confirmar asistencia</button>`,
      onMount: (root) => {
        const chk = root.querySelector('#f-asi-cobrar');
        const bloque = root.querySelector('#bloque-cobro');
        chk.addEventListener('change', () => bloque.classList.toggle('hidden', !chk.checked));

        root.querySelector('#btn-guardar-asi').addEventListener('click', async () => {
          const r = await API.registrarAsistencia({
            paciente_id: p.id,
            cita_id: citaId,
            fecha: val(root, '#f-asi-fecha') || null,
            monto: chk.checked ? Number(val(root, '#f-asi-monto')) : null,
            metodo: val(root, '#f-asi-metodo'),
            nota: val(root, '#f-asi-nota')
          });
          closeSheet();
          toast(r.boletos.length ? `Asistencia registrada · +${r.boletos.length} boleto(s)` : 'Asistencia registrada');
          App.render();
        });
      }
    });
  }

  /* --- Nueva nota de evolución + fotos -------------------------------- */
  async function sheetNota(pacienteId) {
    const adjuntos = [];
    openSheet({
      title: 'Nota de evolución',
      subtitle: 'Registro clínico de la sesión',
      size: 'tall',
      body: `
        <div class="space-y-3">
          <div>
            <div class="mb-1 flex items-center justify-between">
              <label class="text-[12px] font-bold text-ink-700">Dolor referido (EVA)</label>
              <output id="out-eva" class="text-[15px] font-extrabold text-emerald-600">0/10</output>
            </div>
            <input id="f-nota-eva" type="range" class="eva" min="0" max="10" step="1" value="0" />
          </div>

          <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Evolución *</label>
            <textarea id="f-nota-texto" class="field !min-h-[120px]" placeholder="Respuesta al tratamiento, hallazgos, progresión del plan…"></textarea></div>

          <div>
            <label class="mb-1 block text-[12px] font-bold text-ink-700">Fotos / evidencias</label>
            <label class="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-300 bg-ink-50 py-5 active:scale-[.99]">
              ${icon('camera', 'h-5 w-5 text-ink-400')}
              <span class="text-[12.5px] font-bold text-ink-500">Tomar foto o subir imagen</span>
              <input id="f-nota-fotos" type="file" accept="image/*" capture="environment" multiple class="sr-only" />
            </label>
            <p class="mt-1 px-1 text-[11px] text-ink-400">Ej. test de marcha, postura, goniometría, radiografías.</p>
            <div id="previews" class="mt-2 flex flex-wrap gap-2"></div>
          </div>
        </div>`,
      footer: `<button id="btn-guardar-nota" class="w-full rounded-xl bg-brand-600 py-3.5 text-[14px] font-extrabold text-white active:scale-[.98]">Guardar nota</button>`,
      onMount: (root) => {
        const out = root.querySelector('#out-eva');
        root.querySelector('#f-nota-eva').addEventListener('input', (e) => {
          const v = Number(e.target.value);
          out.textContent = `${v}/10`;
          out.className = `text-[15px] font-extrabold ${v >= 7 ? 'text-rose-600' : v >= 4 ? 'text-amber-600' : 'text-emerald-600'}`;
        });

        const previews = root.querySelector('#previews');
        const pintar = () => {
          previews.innerHTML = adjuntos.map((a, i) => `
            <div class="relative h-20 w-20 overflow-hidden rounded-xl border border-ink-200">
              <img src="${E(a.url)}" alt="${E(a.titulo)}" class="h-full w-full object-cover" />
              <button data-del="${i}" aria-label="Quitar"
                class="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-ink-900/70 text-white">${icon('x', 'h-3 w-3', 3)}</button>
            </div>`).join('');
        };
        previews.addEventListener('click', (e) => {
          const b = e.target.closest('[data-del]');
          if (b) { adjuntos.splice(Number(b.dataset.del), 1); pintar(); }
        });

        root.querySelector('#f-nota-fotos').addEventListener('change', async (e) => {
          for (const file of [...e.target.files]) {
            try {
              const url = await readImageCompressed(file);
              adjuntos.push({ url, titulo: file.name.replace(/\.[^.]+$/, '').slice(0, 30) || 'Evidencia' });
            } catch (err) { toast('No se pudo procesar una imagen', 'error'); }
          }
          e.target.value = '';
          pintar();
        });

        root.querySelector('#btn-guardar-nota').addEventListener('click', async () => {
          const texto = val(root, '#f-nota-texto');
          if (!texto) return toast('Escribe la evolución', 'error');
          await API.crearNota({
            paciente_id: pacienteId, texto,
            eva: Number(root.querySelector('#f-nota-eva').value),
            adjuntos
          });
          closeSheet();
          toast('Nota guardada');
          App.render();
        });
      }
    });
  }

  /* --- Visor de foto --------------------------------------------------- */
  function sheetFoto(url, titulo) {
    openSheet({
      title: titulo || 'Evidencia',
      body: `<img src="${E(url)}" alt="${E(titulo || '')}" class="w-full rounded-xl object-contain" />`
    });
  }

  /* --- Nuevo / editar sorteo ------------------------------------------ */
  async function sheetSorteo(id = null) {
    const s = id ? await API.obtenerSorteo(id) : null;
    const hoy = new Date();
    const fin = addDays(hoy, 30);

    openSheet({
      title: s ? 'Editar sorteo' : 'Nuevo sorteo',
      subtitle: 'Un boleto por cada asistencia registrada',
      size: 'tall',
      body: `
        <div class="space-y-3">
          <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Título *</label>
            <input id="f-sor-titulo" class="field" value="${E(s ? s.titulo : '')}" placeholder="Ej. Sorteo de septiembre" /></div>
          <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Premio *</label>
            <input id="f-sor-premio" class="field" value="${E(s ? s.premio : '')}" placeholder="Ej. Masaje descontracturante de 60 min" /></div>
          <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Descripción / bases</label>
            <textarea id="f-sor-desc" class="field" placeholder="Cómo participar, restricciones, entrega del premio…">${E(s ? s.descripcion : '')}</textarea></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Inicia *</label>
              <input id="f-sor-ini" type="date" class="field" value="${s ? isoDay(s.inicia_en) : isoDay(hoy)}" /></div>
            <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Termina *</label>
              <input id="f-sor-fin" type="date" class="field" value="${s ? isoDay(s.termina_en) : isoDay(fin)}" /></div>
          </div>
          <label class="flex items-center gap-2.5 rounded-xl border border-ink-200 p-3">
            <input id="f-sor-pub" type="checkbox" ${!s || s.publicado ? 'checked' : ''} class="h-5 w-5 rounded" />
            <span class="text-[13px] font-bold text-ink-700">Visible para los pacientes</span>
          </label>
          <div class="rounded-xl bg-violet-50 p-3 text-[12px] font-semibold leading-snug text-violet-800 ring-1 ring-violet-200">
            Al guardar se emiten automáticamente los boletos de todas las asistencias dentro del periodo.
          </div>
          ${s ? `<button id="btn-borrar-sorteo" class="w-full rounded-xl bg-rose-50 py-3 text-[13px] font-bold text-rose-600 active:scale-[.98]">Eliminar sorteo</button>` : ''}
        </div>`,
      footer: `<button id="btn-guardar-sorteo" class="w-full rounded-xl bg-violet-600 py-3.5 text-[14px] font-extrabold text-white active:scale-[.98]">
                 ${s ? 'Guardar cambios' : 'Crear sorteo'}</button>`,
      onMount: (root) => {
        const del = root.querySelector('#btn-borrar-sorteo');
        if (del) del.addEventListener('click', async () => {
          closeSheet();
          const ok = await confirmSheet({ title: 'Eliminar sorteo', message: 'Se eliminarán también todos sus boletos. Esta acción no se puede deshacer.', confirmText: 'Eliminar', tone: 'danger' });
          if (ok) { await API.eliminarSorteo(s.id); toast('Sorteo eliminado'); App.render(); }
        });

        root.querySelector('#btn-guardar-sorteo').addEventListener('click', async () => {
          const titulo = val(root, '#f-sor-titulo'), premio = val(root, '#f-sor-premio');
          const ini = val(root, '#f-sor-ini'), fin2 = val(root, '#f-sor-fin');
          if (!titulo || !premio) return toast('Título y premio son obligatorios', 'error');
          if (!ini || !fin2 || new Date(fin2) < new Date(ini)) return toast('Revisa el rango de fechas', 'error');

          const r = await API.guardarSorteo({
            id: s ? s.id : undefined,
            titulo, premio,
            descripcion: val(root, '#f-sor-desc'),
            inicia_en: new Date(ini + 'T00:00:00').toISOString(),
            termina_en: new Date(fin2 + 'T23:59:59').toISOString(),
            publicado: root.querySelector('#f-sor-pub').checked
          });
          closeSheet();
          toast(`Sorteo guardado · ${r.total_boletos} boletos emitidos`);
          App.render();
        });
      }
    });
  }

  /* --- Participantes de un sorteo ------------------------------------- */
  async function sheetParticipantes(sorteoId) {
    const [s, list] = await Promise.all([API.obtenerSorteo(sorteoId), API.participantesDeSorteo(sorteoId)]);
    openSheet({
      title: 'Participantes',
      subtitle: `${s.titulo} · ${s.total_boletos} boletos`,
      size: 'mid',
      body: list.length ? `
        <div class="space-y-2">
          ${list.map((r, i) => `
            <div class="flex items-center gap-3 rounded-xl border border-ink-200 bg-white p-2.5">
              <span class="w-5 shrink-0 text-center text-[12px] font-extrabold text-ink-400">${i + 1}</span>
              ${avatar(r.nombre, 'h-9 w-9 text-[11px]')}
              <div class="min-w-0 flex-1">
                <p class="truncate text-[13px] font-bold text-ink-800">${E(r.nombre)}</p>
                <p class="truncate text-[10.5px] font-medium text-ink-400">${E(r.boletos.slice(0, 4).join(' · '))}${r.boletos.length > 4 ? ` +${r.boletos.length - 4}` : ''}</p>
              </div>
              <span class="shrink-0 rounded-full bg-violet-100 px-2.5 py-1 text-[12px] font-extrabold text-violet-800">${r.total}</span>
            </div>`).join('')}
        </div>`
        : emptyState('ticket', 'Aún no hay boletos', 'Los boletos se emiten al registrar asistencias dentro del periodo.')
    });
  }

  /* --- Animación de sorteo -------------------------------------------- */
  async function ejecutarSorteo(sorteoId) {
    const s = await API.obtenerSorteo(sorteoId);
    const ok = await confirmSheet({
      title: 'Realizar sorteo',
      message: `Se elegirá un ganador al azar entre los ${s.total_boletos} boletos de "${s.titulo}". La acción quedará registrada.`,
      confirmText: 'Sortear ahora'
    });
    if (!ok) return;

    const participantes = await API.participantesDeSorteo(sorteoId);

    openSheet({
      title: 'Sorteando…',
      subtitle: s.premio,
      body: `
        <div class="py-6 text-center">
          <div class="mx-auto grid h-20 w-20 place-items-center rounded-full bg-violet-100 text-violet-700">${icon('shuffle', 'h-9 w-9')}</div>
          <p id="ruleta" class="mt-5 min-h-[28px] text-[18px] font-extrabold text-ink-900">—</p>
          <p class="mt-1 text-[12px] font-semibold text-ink-400">Seleccionando boleto ganador</p>
          <div class="mx-auto mt-4 h-1.5 w-40 overflow-hidden rounded-full bg-ink-100">
            <div id="barra-sorteo" class="h-full w-0 rounded-full bg-violet-600 transition-all duration-[2400ms] ease-out"></div>
          </div>
        </div>`,
      onMount: async (root) => {
        const ruleta = root.querySelector('#ruleta');
        requestAnimationFrame(() => { root.querySelector('#barra-sorteo').style.width = '100%'; });

        const nombres = participantes.map((p) => p.nombre);
        let i = 0;
        const timer = setInterval(() => {
          ruleta.textContent = nombres[i++ % nombres.length] || '…';
        }, 90);

        const r = await new Promise((res) => setTimeout(async () => res(await API.realizarSorteo(sorteoId)), 2500));
        clearInterval(timer);

        openSheet({
          title: '¡Tenemos ganador!',
          subtitle: s.titulo,
          body: `
            <div class="anim-pop py-4 text-center">
              <div class="mx-auto grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-lift">
                ${icon('award', 'h-12 w-12', 2)}
              </div>
              <p class="mt-4 text-[22px] font-extrabold leading-tight text-ink-900">${E(r.ganador.nombre)}</p>
              <p class="mt-1 inline-block rounded-full bg-ink-900 px-3 py-1 text-[13px] font-extrabold tracking-widest text-white">${E(r.ganador.codigo)}</p>
              <div class="mt-4 rounded-xl bg-brand-50 p-3">
                <p class="text-[11px] font-extrabold uppercase tracking-wide text-brand-700">Premio</p>
                <p class="text-[14px] font-bold text-brand-900">${E(s.premio)}</p>
              </div>
              <p class="mt-3 text-[12px] font-medium text-ink-500">Ganó entre ${r.ganador.total_boletos} boletos participantes.</p>
            </div>`,
          footer: `
            <div class="flex gap-2">
              <button id="sor-despues" class="flex-1 rounded-xl bg-ink-100 py-3 text-[13.5px] font-bold text-ink-700">Publicar después</button>
              <button id="sor-publicar" class="flex-1 rounded-xl bg-emerald-600 py-3 text-[13.5px] font-bold text-white">Publicar ganador</button>
            </div>`,
          onMount: (r2) => {
            r2.querySelector('#sor-despues').addEventListener('click', () => { closeSheet(); App.render(); });
            r2.querySelector('#sor-publicar').addEventListener('click', async () => {
              await API.publicarGanador(sorteoId, true);
              closeSheet();
              toast('Ganador publicado en la app de pacientes');
              App.render();
            });
          }
        });
      }
    });
  }

  /* --- Promociones ----------------------------------------------------- */
  async function sheetPromos() {
    const list = await API.listarPromociones();
    openSheet({
      title: 'Promociones',
      subtitle: 'Lo que ven tus pacientes',
      size: 'tall',
      body: `
        <button id="btn-nueva-promo" class="mb-3 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 text-[13.5px] font-extrabold text-white active:scale-[.98]">
          ${icon('plus', 'h-4 w-4')} Nueva promoción
        </button>
        <div class="space-y-2">
          ${list.length ? list.map((p) => `
            <div class="rounded-xl border ${p.vigente ? 'border-amber-200 bg-amber-50' : 'border-ink-200 bg-white'} p-3">
              <div class="flex items-start gap-2">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <p class="truncate text-[13.5px] font-extrabold text-ink-900">${E(p.titulo)}</p>
                    ${badge(p.vigente ? 'Vigente' : 'Inactiva', p.vigente ? 'green' : 'ink')}
                  </div>
                  <p class="mt-0.5 clamp-2 text-[12px] leading-snug text-ink-600">${E(p.descripcion)}</p>
                  <p class="mt-1 text-[10.5px] font-bold text-ink-400">${E(fmtDate(p.desde))} – ${E(fmtDate(p.hasta))}</p>
                </div>
                <button data-promo-del="${p.id}" aria-label="Eliminar" class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white text-rose-500 ring-1 ring-ink-200 active:scale-90">${icon('trash', 'h-3.5 w-3.5')}</button>
              </div>
            </div>`).join('')
            : emptyState('tag', 'Sin promociones')}
        </div>`,
      onMount: (root) => {
        root.querySelector('#btn-nueva-promo').addEventListener('click', () => { closeSheet(); sheetPromoForm(); });
        root.querySelectorAll('[data-promo-del]').forEach((b) => b.addEventListener('click', async () => {
          await API.eliminarPromocion(b.dataset.promoDel);
          toast('Promoción eliminada');
          closeSheet();
          sheetPromos();
        }));
      }
    });
  }

  function sheetPromoForm() {
    const hoy = new Date(), fin = addDays(hoy, 30);
    openSheet({
      title: 'Nueva promoción',
      body: `
        <div class="space-y-3">
          <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Título *</label>
            <input id="f-pro-titulo" class="field" placeholder="Ej. 20% en paquete de 10 sesiones" /></div>
          <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Descripción</label>
            <textarea id="f-pro-desc" class="field" placeholder="Condiciones y vigencia"></textarea></div>
          <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Etiqueta</label>
            <input id="f-pro-tag" class="field" placeholder="Ej. Paquetes" /></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Desde</label>
              <input id="f-pro-desde" type="date" class="field" value="${isoDay(hoy)}" /></div>
            <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Hasta</label>
              <input id="f-pro-hasta" type="date" class="field" value="${isoDay(fin)}" /></div>
          </div>
        </div>`,
      footer: `<button id="btn-guardar-promo" class="w-full rounded-xl bg-amber-500 py-3.5 text-[14px] font-extrabold text-white active:scale-[.98]">Publicar promoción</button>`,
      onMount: (root) => {
        root.querySelector('#btn-guardar-promo').addEventListener('click', async () => {
          const titulo = val(root, '#f-pro-titulo');
          if (!titulo) return toast('El título es obligatorio', 'error');
          await API.guardarPromocion({
            titulo,
            descripcion: val(root, '#f-pro-desc'),
            etiqueta: val(root, '#f-pro-tag') || 'Promoción',
            color: 'amber',
            desde: new Date(val(root, '#f-pro-desde') + 'T00:00:00').toISOString(),
            hasta: new Date(val(root, '#f-pro-hasta') + 'T23:59:59').toISOString(),
            activa: true
          });
          closeSheet();
          toast('Promoción publicada');
          App.render();
        });
      }
    });
  }

  /* ======================================================================
     EXPORT
     ====================================================================== */
  global.VistaFisio = {
    dashboard, agenda, pacientes, paciente, valoracion, rutinaEditor, sorteos,
    leerValoracion,
    sheetPaciente, sheetCita, sheetMenuCita, sheetAsistencia, sheetNota, sheetFoto,
    sheetSorteo, sheetParticipantes, ejecutarSorteo, sheetPromos, sheetPromoForm
  };
})(window);
