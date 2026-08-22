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
    toast, openSheet, closeSheet, confirmSheet, uid,
    waLink, telWhatsApp, fmtBytes
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

  /* ======================================================================
     ESTADO DE EDICIÓN
     No hay autoguardado: lo capturado vive en el formulario hasta que el
     usuario pulsa «Guardar». Este bloque solo sirve para avisarle si intenta
     salir con cambios pendientes.
     ====================================================================== */
  let _sucio = false;
  const marcarSucio = () => { _sucio = true; pintarPendiente(true); };
  const marcarLimpio = () => { _sucio = false; pintarPendiente(false); };
  const hayCambiosSinGuardar = () => _sucio;

  /** Indicador «sin guardar» junto al botón. */
  function pintarPendiente(visible) {
    const el = document.getElementById('indicador-pendiente');
    if (el) el.classList.toggle('hidden', !visible);
  }

  /** Cualquier edición en el formulario marca cambios pendientes. */
  function vigilarCambios(root) {
    ['input', 'change'].forEach((ev) =>
      root.addEventListener(ev, (e) => {
        if (e.target.closest('[data-no-vigilar]')) return;
        marcarSucio();
      }, true));
  }

  /**
   * Barra inferior de guardado, común a valoración y rutinas.
   *
   * z-40 la coloca por encima del menú inferior (z-30). Además, estas dos
   * pantallas declaran `sinNav` en el router, así que el menú ni siquiera se
   * dibuja: la barra ocupa el borde inferior ella sola y nada la tapa.
   */
  const barraGuardar = (accion, datos, texto) => `
    <div class="fixed bottom-0 left-1/2 z-40 w-full max-w-[480px] -translate-x-1/2 border-t border-ink-200 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_-12px_rgba(0,0,0,.25)] backdrop-blur nav-safe">
      <p id="indicador-pendiente" class="mb-1.5 hidden items-center justify-center gap-1.5 text-[11.5px] font-bold text-amber-700">
        ${icon('alert', 'h-3.5 w-3.5')} Tienes cambios sin guardar
      </p>
      <button ${datos} data-action="${accion}"
        class="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 text-[14.5px] font-extrabold text-white shadow-card transition active:scale-[.98]">
        ${icon('save', 'h-4.5 w-4.5')} ${E(texto)}
      </button>
      ${UI.avisoGuardado()}
    </div>`;

  /* Rutina en edición. Antes vivía en `window.__rutinaSeleccion`, un global
     que cualquier script podía pisar; ahora es estado del módulo. */
  let _rutinaEnEdicion = null;
  const rutinaEnEdicion = () => _rutinaEnEdicion;

  const ESTADO_CITA = {
    agendada:   ['brand', 'Agendada'],
    completada: ['green', 'Atendida'],
    no_asistio: ['rose', 'No asistió'],
    cancelada:  ['ink', 'Cancelada']
  };

  /* ======================================================================
     WHATSAPP  ·  recordatorios y avisos
     ----------------------------------------------------------------------
     No hay integración con la API de negocio de WhatsApp (es de pago y exige
     servidor propio). Lo que se hace aquí es lo que ya funciona en cualquier
     teléfono: un enlace `wa.me` con el mensaje redactado, que abre la
     conversación con el paciente lista para enviar. El envío lo confirma
     siempre una persona, que además es lo que evita mandar recordatorios a
     quien acaba de cancelar.
     ====================================================================== */

  /** «María Fernanda Gómez» → «María»: el saludo suena a persona, no a base de datos. */
  const nombrePila = (nombre) => String(nombre || '').trim().split(/\s+/)[0] || '';

  /* Cada plantilla recibe la cita ya decorada (`paciente_nombre`) y la marca
     de la clínica. Nada de emojis decorativos de más: estos mensajes los lee
     gente en la calle y en pantallas pequeñas. */
  const MENSAJES = {
    recordatorio: (c, clinica) =>
      `Hola ${nombrePila(c.paciente_nombre)}, te saludamos de ${clinica}.\n\n` +
      `Te recordamos tu cita de fisioterapia:\n` +
      `📅 ${fmtDateLong(c.inicia_en)}\n` +
      `🕒 ${fmtTime(c.inicia_en)} (${c.duracion_min} min)\n` +
      `📋 ${c.motivo}\n\n` +
      `¿Nos confirmas que puedes asistir? Si necesitas moverla, respóndenos por aquí y la reagendamos.`,

    confirmacion: (c, clinica) =>
      `Hola ${nombrePila(c.paciente_nombre)}, tu cita en ${clinica} quedó agendada:\n\n` +
      `📅 ${fmtDateLong(c.inicia_en)}\n` +
      `🕒 ${fmtTime(c.inicia_en)} (${c.duracion_min} min)\n` +
      `📋 ${c.motivo}\n\n` +
      `Te esperamos. Llega 5 minutos antes y trae ropa cómoda.`,

    cancelacion: (c, clinica) =>
      `Hola ${nombrePila(c.paciente_nombre)}, te escribimos de ${clinica}.\n\n` +
      `Tu cita del ${fmtDateLong(c.inicia_en)} a las ${fmtTime(c.inicia_en)} quedó cancelada ` +
      `y el horario está libre de nuevo.\n\n` +
      `Cuando quieras retomamos tu tratamiento: dinos qué día te acomoda y te agendamos.`,

    seguimiento: (p, clinica) =>
      `Hola ${nombrePila(p.nombre)}, te saludamos de ${clinica}.\n\n` +
      `¿Cómo has seguido con tu tratamiento? Si quieres continuar con tus sesiones, ` +
      `dinos qué día te queda bien y te apartamos el horario.`,

    solicitud: (s, clinica) =>
      `Hola ${nombrePila(s.nombre)}, te escribimos de ${clinica}.\n\n` +
      `Recibimos tu solicitud de cita${s.motivo ? ` por «${s.motivo}»` : ''}. ` +
      `${s.preferencia ? `Vimos que prefieres ${s.preferencia}. ` : ''}` +
      `¿Te va bien que te agendemos esta semana? Dinos qué día y hora te acomodan.`
  };

  /**
   * Panel para revisar y enviar un mensaje por WhatsApp.
   *
   * El texto se puede editar antes de abrir la conversación: los recordatorios
   * automáticos se notan, y un ajuste de una línea cambia por completo cómo se
   * reciben. También se ofrece copiar el enlace, que es lo que se necesita
   * cuando quien atiende el teléfono de la clínica no es quien está frente a
   * esta pantalla.
   */
  function sheetWhatsApp({ telefono, nombre = '', mensaje = '', titulo = 'Enviar por WhatsApp', alEnviar = null }) {
    const numero = telWhatsApp(telefono);

    if (!numero) {
      return openSheet({
        title: 'Sin teléfono para WhatsApp',
        subtitle: nombre || '',
        body: emptyState('phone', 'Este paciente no tiene un teléfono utilizable',
          'Edita su ficha y captura un móvil de 10 dígitos para poder mandarle recordatorios.'),
        footer: `<button data-sheet-close class="w-full rounded-xl bg-ink-100 py-3 text-[13.5px] font-bold text-ink-700">Entendido</button>`
      });
    }

    openSheet({
      title: titulo,
      subtitle: `${nombre ? nombre + ' · ' : ''}+${numero}`,
      body: `
        <div class="space-y-3">
          <div class="rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-200">
            <p class="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-emerald-700">
              ${icon('whatsapp', 'h-3.5 w-3.5')} Mensaje listo para enviar
            </p>
            <p class="mt-1 text-[12px] font-semibold leading-snug text-emerald-800">
              Se abre la conversación con el texto escrito. Tú decides cuándo pulsar enviar.
            </p>
          </div>

          <div>
            <label class="mb-1 block text-[12px] font-bold text-ink-700">Mensaje</label>
            <textarea id="f-wa-texto" class="field !min-h-[190px] !text-[13px]">${E(mensaje)}</textarea>
          </div>
        </div>`,
      footer: `
        <div class="space-y-2">
          <a id="btn-wa-abrir" href="${E(waLink(telefono, mensaje))}" target="_blank" rel="noopener noreferrer"
            class="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 text-[14px] font-extrabold text-white active:scale-[.98]">
            ${icon('whatsapp', 'h-4.5 w-4.5')} Abrir WhatsApp
          </a>
          <button id="btn-wa-copiar" class="w-full rounded-xl bg-ink-100 py-2.5 text-[12.5px] font-bold text-ink-700 active:scale-[.98]">
            Copiar enlace del mensaje
          </button>
        </div>`,
      onMount: (root) => {
        const texto = root.querySelector('#f-wa-texto');
        const abrir = root.querySelector('#btn-wa-abrir');

        // El enlace se regenera con cada tecla: si no, se enviaría el mensaje
        // original y la edición del fisio se perdería sin avisar.
        const sincronizar = () => { abrir.href = waLink(telefono, texto.value); };
        texto.addEventListener('input', sincronizar);

        abrir.addEventListener('click', () => {
          closeSheet();
          if (alEnviar) Promise.resolve(alEnviar(texto.value)).catch((e) => toast(e.message, 'error'));
        });

        root.querySelector('#btn-wa-copiar').addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(waLink(telefono, texto.value));
            toast('Enlace copiado');
          } catch {
            toast('Tu navegador no dejó copiar. Mantén pulsado el texto para copiarlo.', 'warn', 4000);
          }
        });
      }
    });
  }

  /** Recordatorio de una cita concreta, con la marca de la clínica ya puesta. */
  async function whatsappCita(citaId, plantilla = 'recordatorio') {
    const [c, cfg] = await Promise.all([API.obtenerCita(citaId), API.getConfig()]);
    if (!c) return toast('Cita no encontrada', 'error');

    const clinica = cfg.clinica || 'la clínica';
    const armar = MENSAJES[plantilla] || MENSAJES.recordatorio;

    /* `seguimiento` es la única plantilla que habla de un paciente y no de una
       cita, y ahí el nombre viene en otra propiedad. Sin esta traducción el
       mensaje saldría con un «Hola ,» delante. */
    const sujeto = plantilla === 'seguimiento' ? { nombre: c.paciente_nombre } : c;

    sheetWhatsApp({
      telefono: c.paciente ? c.paciente.telefono : '',
      nombre: c.paciente_nombre,
      titulo: plantilla === 'cancelacion' ? 'Avisar de la cancelación' : 'Recordatorio de cita',
      mensaje: armar(sujeto, clinica)
    });
  }

  /**
   * Escribir a un paciente desde su ficha. Si tiene una cita por delante el
   * mensaje sale como recordatorio; si no, como seguimiento para retomar el
   * tratamiento, que es la conversación que de verdad toca en ese caso.
   */
  async function whatsappPaciente(pacienteId) {
    const [p, cfg] = await Promise.all([API.obtenerPaciente(pacienteId), API.getConfig()]);
    if (!p) return toast('Paciente no encontrado', 'error');

    const clinica = cfg.clinica || 'la clínica';
    const prox = p.proxima_cita;

    sheetWhatsApp({
      telefono: p.telefono,
      nombre: p.nombre,
      titulo: prox ? 'Recordatorio de cita' : 'Escribir al paciente',
      mensaje: prox
        ? MENSAJES.recordatorio({ ...prox, paciente_nombre: p.nombre }, clinica)
        : MENSAJES.seguimiento(p, clinica)
    });
  }

  /**
   * Tanda de recordatorios: las citas de los próximos días, una debajo de
   * otra, para ir mandándolas de un tirón sin volver a la agenda entre cada
   * una.
   */
  async function sheetRecordatorios(dias = 3) {
    const [citas, cfg] = await Promise.all([API.proximasCitas({ dias }), API.getConfig()]);
    const clinica = cfg.clinica || 'la clínica';

    const grupos = new Map();
    citas.forEach((c) => {
      const k = isoDay(c.inicia_en);
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(c);
    });

    const conTelefono = citas.filter((c) => telWhatsApp(c.paciente && c.paciente.telefono));
    const sinTelefono = citas.length - conTelefono.length;

    const fila = (c) => {
      const tel = c.paciente ? c.paciente.telefono : '';
      const ok = !!telWhatsApp(tel);
      return `
        <div class="flex items-center gap-2.5 rounded-xl border border-ink-200 bg-white p-2.5">
          <div class="flex w-12 shrink-0 flex-col items-center rounded-lg bg-brand-50 py-1 text-brand-800">
            <span class="text-[12px] font-extrabold leading-none">${E(fmtTime(c.inicia_en).replace(/\s?[ap]\.m\./, ''))}</span>
            <span class="text-[8.5px] font-bold uppercase">${E((fmtTime(c.inicia_en).match(/[ap]\.m\./) || [''])[0])}</span>
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-[13px] font-bold text-ink-800">${E(c.paciente_nombre)}</p>
            <p class="truncate text-[11px] text-ink-500">${E(c.motivo)}</p>
          </div>
          ${ok
            ? `<button data-wa-cita="${c.id}" data-enviado="0"
                 class="flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-[12px] font-bold text-white active:scale-95">
                 ${icon('whatsapp', 'h-3.5 w-3.5')} Enviar</button>`
            : `<span class="shrink-0 rounded-xl bg-ink-100 px-2.5 py-2 text-[11px] font-bold text-ink-400">Sin teléfono</span>`}
        </div>`;
    };

    openSheet({
      title: 'Recordatorios por WhatsApp',
      subtitle: `${conTelefono.length} cita${conTelefono.length === 1 ? '' : 's'} en los próximos ${dias} días`,
      size: 'tall',
      body: `
        <div class="mb-3 rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-200">
          <p class="text-[11px] font-extrabold uppercase tracking-wide text-emerald-700">Cómo funciona</p>
          <p class="mt-1 text-[12px] font-semibold leading-snug text-emerald-900">
            Cada botón abre la conversación del paciente con el recordatorio ya escrito.
            Revisa el texto y envíalo tú: así ningún mensaje sale sin que alguien lo lea.
          </p>
          ${sinTelefono ? `<p class="mt-1.5 text-[11.5px] font-bold text-emerald-800">
            ${sinTelefono} cita${sinTelefono === 1 ? '' : 's'} sin teléfono utilizable: captúralo en la ficha del paciente.</p>` : ''}
        </div>

        ${grupos.size
          ? [...grupos.entries()].map(([dia, list]) => `
              <div class="mb-3">
                <div class="mb-1.5 flex items-center gap-2 px-1">
                  <h3 class="text-[12.5px] font-extrabold capitalize text-ink-800">${E(relDay(dia))}</h3>
                  <span class="text-[11px] font-semibold text-ink-400">${E(fmtDate(dia))}</span>
                </div>
                <div class="space-y-1.5">${list.map(fila).join('')}</div>
              </div>`).join('')
          : emptyState('calendar', 'No hay citas próximas',
              'Cuando agendes citas aparecerán aquí para avisar a cada paciente.')}`,
      onMount: (root) => {
        root.querySelectorAll('[data-wa-cita]').forEach((b) => b.addEventListener('click', () => {
          const c = citas.find((x) => x.id === b.dataset.waCita);
          if (!c) return;
          sheetWhatsApp({
            telefono: c.paciente ? c.paciente.telefono : '',
            nombre: c.paciente_nombre,
            titulo: 'Recordatorio de cita',
            mensaje: MENSAJES.recordatorio(c, clinica),
            alEnviar: () => toast(`Recordatorio abierto para ${nombrePila(c.paciente_nombre)}`)
          });
        }));
      }
    });
  }

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
            ${p.expediente_pendiente ? badge('Historial pendiente', 'amber') : ''}
          </div>
        </div>
        ${icon('chevronR', 'h-4 w-4 shrink-0 text-ink-300')}
      </a>`;
  }

  /* ======================================================================
     1 · DASHBOARD
     ====================================================================== */
  async function dashboard() {
    // `verificarEsquema` PREGUNTA a la base en vez de fiarse del historial de
    // errores de la sesión. Devuelve un nombre solo cuando PostgREST responde
    // 42P01/PGRST205 (la relación no existe). Una tabla que existe pero está
    // cerrada por RLS responde sin error, así que ya no se reporta ausente.
    const [r, cfg, falta] = await Promise.all([
      API.resumenDashboard(),
      API.getConfig(),
      API.verificarEsquema ? API.verificarEsquema() : Promise.resolve(null)
    ]);
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

    // `falta` viene de la comprobación de arriba: si trae nombre, esa relación
    // NO existe en la base. No se rompe nada, pero hay que decirlo con claridad.

    const html = `
      <div class="space-y-4 px-4 pt-4 anim-fade-up">

        ${falta ? `
          <div class="rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <p class="flex items-center gap-2 text-[13px] font-extrabold text-amber-900">
              ${icon('alert', 'h-4 w-4 shrink-0')} Base de datos desactualizada
            </p>
            <p class="mt-1.5 text-[12.5px] leading-snug text-amber-800">
              Falta <code class="rounded bg-amber-100 px-1 font-mono text-[11.5px]">${E(falta)}</code> en tu proyecto de Supabase.
              Las funciones que dependen de ello están desactivadas, pero el resto sigue trabajando con normalidad.
            </p>
            <p class="mt-2 text-[12px] font-semibold text-amber-900">
              Solución: abre Supabase → SQL Editor y ejecuta <code class="rounded bg-amber-100 px-1 font-mono text-[11.5px]">supabase/schema.sql</code> completo.
            </p>
          </div>` : ''}

        ${r.solicitudes_nuevas ? `
          <button data-action="ver-solicitudes"
            class="flex w-full items-center gap-3 rounded-2xl border border-brand-200 bg-brand-50 p-3.5 text-left shadow-card active:scale-[.99]">
            <span class="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white">
              ${icon('bell', 'h-5 w-5')}
              <span class="absolute -right-1 -top-1 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-ink-900 px-1 text-[10px] font-extrabold text-white">${r.solicitudes_nuevas}</span>
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-[13.5px] font-extrabold text-brand-900">
                ${r.solicitudes_nuevas} solicitud${r.solicitudes_nuevas === 1 ? '' : 'es'} de cita
              </span>
              <span class="block text-[11.5px] font-semibold text-brand-700">Pacientes nuevos esperando respuesta</span>
            </span>
            ${icon('chevronR', 'h-4 w-4 shrink-0 text-brand-400')}
          </button>` : ''}

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

    // Solo cuenta lo que de verdad se puede recordar: citas vivas con un
    // teléfono utilizable. Un botón que promete «3 recordatorios» y luego
    // abre una lista de «sin teléfono» hace perder el viaje.
    const recordables = citas.filter((c) =>
      c.estado === 'agendada' && telWhatsApp(c.paciente && c.paciente.telefono)).length;

    const html = `
      <div class="space-y-4 px-4 pt-4 anim-fade-up">
        <div class="flex gap-1 rounded-2xl bg-ink-100 p-1">
          ${tab('hoy', 'Hoy')}${tab('proximas', 'Próximas')}
        </div>

        <button data-action="ver-recordatorios"
          class="flex w-full items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-left active:scale-[.99]">
          <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white">
            ${icon('whatsapp', 'h-4.5 w-4.5')}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-[13px] font-extrabold text-emerald-900">Recordatorios por WhatsApp</span>
            <span class="block text-[11.5px] font-semibold text-emerald-700">
              ${recordables ? `${recordables} cita${recordables === 1 ? '' : 's'} por avisar` : 'Avisa a tus pacientes de su próxima cita'}
            </span>
          </span>
          ${icon('chevronR', 'h-4 w-4 shrink-0 text-emerald-400')}
        </button>

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
        <div class="sticky top-0 z-10 bg-cream-100/95 px-4 pb-3 pt-4 backdrop-blur">
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

    /* Alta exprés sin historia clínica: el aviso va en TODAS las pestañas, no
       solo en el resumen, porque el hueco que deja se nota justo cuando se
       abre la valoración o se busca un diagnóstico que nadie capturó. */
    const avisoPendiente = p.expediente_pendiente ? `
      <div class="rounded-2xl border border-amber-300 bg-amber-50 p-3.5">
        <p class="flex items-center gap-2 text-[13px] font-extrabold text-amber-900">
          ${icon('alert', 'h-4 w-4 shrink-0')} Historial clínico pendiente
        </p>
        <p class="mt-1 text-[12px] leading-snug text-amber-800">
          Se agendó con lo mínimo (nombre y teléfono). Completa sus datos y su valoración
          cuando venga a consulta.
        </p>
        <div class="mt-2.5 flex gap-2">
          <button data-action="editar-paciente" data-id="${id}"
            class="flex-1 rounded-xl bg-amber-500 py-2 text-[12px] font-extrabold text-white active:scale-95">
            Completar datos
          </button>
          <button data-action="expediente-al-dia" data-id="${id}"
            class="rounded-xl bg-white px-3 py-2 text-[12px] font-bold text-amber-800 ring-1 ring-amber-300 active:scale-95">
            Ya está al día
          </button>
        </div>
      </div>` : '';

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

          <div class="mt-4 grid grid-cols-4 gap-2">
            <button data-action="registrar-asistencia" data-id="${id}"
              class="flex flex-col items-center gap-1 rounded-xl bg-white/15 py-2.5 backdrop-blur active:scale-95">
              ${icon('check', 'h-4 w-4')}<span class="text-[10.5px] font-bold">Asistencia</span>
            </button>
            <button data-action="nueva-cita" data-id="${id}"
              class="flex flex-col items-center gap-1 rounded-xl bg-white/15 py-2.5 backdrop-blur active:scale-95">
              ${icon('calendar', 'h-4 w-4')}<span class="text-[10.5px] font-bold">Agendar</span>
            </button>
            <button data-action="whatsapp-paciente" data-id="${id}"
              class="flex flex-col items-center gap-1 rounded-xl bg-white/15 py-2.5 backdrop-blur active:scale-95">
              ${icon('whatsapp', 'h-4 w-4')}<span class="text-[10.5px] font-bold">WhatsApp</span>
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

        <div class="mt-3 space-y-4 px-4 pb-6">${avisoPendiente}${contenido}</div>
      </div>`;

    /* La pestaña de historial trae un selector de archivos, y un `<input
       type="file">` no funciona por delegación de eventos: hay que engancharse
       a su `change`. Por eso esta vista estrena onMount. */
    const onMount = (root) => {
      const entrada = root.querySelector('#f-exp-archivo');
      if (entrada) entrada.addEventListener('change', (e) => subirArchivosExpediente(id, e.target));
    };

    return { titulo: p.nombre, html, onMount, volver: '#/t/pacientes' };
  }

  /* --------------------------------------------------- Tab · Resumen ----- */
  async function tabResumen(p, { usadas, total, pct }) {
    const [asistencias, pagos, citas, cumpl] = await Promise.all([
      API.asistenciasDePaciente(p.id), API.pagosDePaciente(p.id), API.citasDePaciente(p.id),
      API.cumplimientoDePaciente(p.id)
    ]);
    const totalPagado = pagos.reduce((s, x) => s + x.monto, 0);
    const prox = p.proxima_cita;

    return `
      ${total > 0 ? card(`
        <div class="flex items-center justify-between">
          <p class="text-[11px] font-extrabold uppercase tracking-wider text-ink-400">Paquete de sesiones</p>
          ${badge(p.paquete_restantes === 0 ? 'Agotado' : `${p.paquete_restantes} restantes`, p.paquete_restantes === 0 ? 'rose' : p.paquete_restantes <= 2 ? 'amber' : 'green')}
        </div>
        <p class="mt-1.5 text-[15px] font-extrabold text-ink-900">${E(p.paquete_nombre || 'Paquete')}</p>
        <div class="mt-2.5 h-2.5 w-full overflow-hidden rounded-full bg-ink-100">
          <div class="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600 transition-all" style="width:${pct}%"></div>
        </div>
        <div class="mt-1.5 flex justify-between text-[11.5px] font-semibold text-ink-500">
          <span>${usadas} de ${total} usadas</span>
          <span>${p.paquete_vence ? `Vence ${E(fmtDate(p.paquete_vence))}` : 'Sin vigencia'}</span>
        </div>
      `) : card(`
        <!-- Sin paquete no se pinta una barra al 0 %: parecería un paquete
             agotado, que es lo contrario de «paga por sesión». -->
        <p class="text-[11px] font-extrabold uppercase tracking-wider text-ink-400">Paquete de sesiones</p>
        <p class="mt-1 text-[13.5px] font-bold text-ink-700">Sin paquete · paga por sesión</p>
        <button data-action="editar-paciente" data-id="${p.id}"
          class="mt-2 rounded-xl bg-ink-100 px-3 py-1.5 text-[12px] font-bold text-ink-600 active:scale-95">
          Contratar un paquete
        </button>
      `)}

      ${(cumpl.faltas > 0 || cumpl.canceladas > 0) ? card(`
        <div class="flex items-center justify-between">
          <p class="text-[11px] font-extrabold uppercase tracking-wider text-ink-400">Control de asistencia</p>
          ${cumpl.cumplimiento !== null
            ? badge(`${cumpl.cumplimiento}% cumplimiento`,
                    cumpl.cumplimiento >= 85 ? 'green' : cumpl.cumplimiento >= 60 ? 'amber' : 'rose')
            : ''}
        </div>
        <div class="mt-2 grid grid-cols-3 gap-2 text-center">
          <div class="rounded-xl bg-emerald-50 py-2">
            <p class="text-[17px] font-extrabold text-emerald-700">${cumpl.asistidas}</p>
            <p class="text-[10.5px] font-bold uppercase tracking-wide text-emerald-600">Asistió</p>
          </div>
          <div class="rounded-xl bg-rose-50 py-2">
            <p class="text-[17px] font-extrabold text-rose-700">${cumpl.faltas}</p>
            <p class="text-[10.5px] font-bold uppercase tracking-wide text-rose-600">Faltas</p>
          </div>
          <div class="rounded-xl bg-ink-100 py-2">
            <p class="text-[17px] font-extrabold text-ink-600">${cumpl.canceladas}</p>
            <p class="text-[10.5px] font-bold uppercase tracking-wide text-ink-500">Canceló</p>
          </div>
        </div>
        ${cumpl.ultima_falta ? `
          <p class="mt-2 text-[11.5px] font-semibold text-ink-500">
            Última falta: ${E(fmtDate(cumpl.ultima_falta))}
          </p>` : ''}
        <p class="mt-1.5 text-[11px] leading-snug text-ink-400">
          Las cancelaciones no bajan el cumplimiento: avisar es justo lo que se quiere que hagan.
        </p>
      `) : ''}

      ${prox ? card(`
        <div class="flex items-center gap-3">
          <div class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700">${icon('calendar', 'h-5 w-5')}</div>
          <div class="min-w-0 flex-1">
            <p class="text-[11px] font-extrabold uppercase tracking-wider text-ink-400">Próxima cita</p>
            <p class="truncate text-[14.5px] font-bold capitalize text-ink-900">${E(relDay(prox.inicia_en))} · ${E(fmtTime(prox.inicia_en))}</p>
            <p class="truncate text-[12px] text-ink-500">${E(prox.motivo)}</p>
            ${prox.precio !== null && prox.precio !== undefined
              ? `<p class="mt-0.5 text-[11.5px] font-bold text-brand-700">Precio pactado: ${E(fmtMoney(prox.precio))}</p>` : ''}
          </div>
        </div>
        <div class="mt-2.5 flex gap-2">
          <button data-action="whatsapp-cita" data-id="${prox.id}"
            class="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2 text-[12px] font-bold text-white active:scale-95">
            ${icon('whatsapp', 'h-3.5 w-3.5')} Recordar
          </button>
          <button data-action="cancelar-cita" data-id="${prox.id}"
            class="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-rose-50 py-2 text-[12px] font-bold text-rose-600 ring-1 ring-rose-200 active:scale-95">
            ${icon('calendarX', 'h-3.5 w-3.5')} Cancelar
          </button>
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

    // jsonb/text[] pueden llegar nulos si la fila se creó fuera de la app
    const secciones = v.secciones_activas || [];
    const todosLosDatos = v.datos || {};
    const activas = Store.SECCIONES_VALORACION.filter((s) => secciones.includes(s.key));

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
        const datos = todosLosDatos[sec.key] || {};
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

  /** Miniatura de un archivo del expediente: la imagen se ve, el PDF se rotula. */
  const tarjetaArchivo = (a) => `
    <div class="w-32 shrink-0 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
      <button data-action="ver-archivo" data-id="${a.id}" data-pdf="${a.es_pdf ? '1' : '0'}"
        class="block w-full active:scale-95">
        ${a.es_pdf || !a.url
          ? `<span class="flex h-24 w-full flex-col items-center justify-center gap-1 bg-rose-50 text-rose-600">
               ${icon('file', 'h-7 w-7')}<span class="text-[10px] font-extrabold uppercase tracking-wide">PDF</span>
             </span>`
          : `<img src="${E(a.url)}" alt="${E(a.titulo)}" class="h-24 w-full object-cover" loading="lazy" />`}
        <p class="truncate px-1.5 pt-1 text-left text-[10.5px] font-bold text-ink-700">${E(a.titulo)}</p>
        <p class="truncate px-1.5 text-left text-[9.5px] font-semibold text-ink-400">
          ${E(a.categoria)} · ${E(fmtBytes(a.tamano))}
        </p>
      </button>
      <div class="flex items-center justify-between px-1.5 pb-1.5 pt-1">
        <span class="text-[9.5px] font-bold text-ink-400">${E(fmtDate(a.creado_en))}</span>
        <button data-action="borrar-archivo" data-id="${a.id}" aria-label="Eliminar archivo"
          class="grid h-6 w-6 place-items-center rounded-md bg-ink-100 text-ink-500 active:scale-90">
          ${icon('trash', 'h-3 w-3')}
        </button>
      </div>
    </div>`;

  async function tabHistorial(p) {
    const [notas, archivos] = await Promise.all([
      API.notasDePaciente(p.id),
      API.archivosDePaciente(p.id)
    ]);
    const fotos = notas.flatMap((n) => (n.adjuntos || []).map((a) => ({ ...a, nota_id: n.id })));

    return `
      <button data-action="nueva-nota" data-id="${p.id}"
        class="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 text-[14px] font-bold text-white shadow-card active:scale-[.98]">
        ${icon('plus', 'h-4.5 w-4.5')} Nueva nota de evolución
      </button>

      <!-- Archivos del expediente: estudios, informes y consentimientos -->
      <div>
        ${sectionTitle(`Archivos del expediente${archivos.length ? ` (${archivos.length})` : ''}`)}

        <label class="flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed border-ink-300 bg-white/70 p-3.5 active:scale-[.99]">
          <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700">
            ${icon('upload', 'h-5 w-5')}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-[13px] font-extrabold text-ink-800">Subir imagen o PDF</span>
            <span class="block text-[11.5px] leading-snug text-ink-500">
              Radiografías, resonancias, informes de otro especialista, consentimientos. Hasta 20 MB.
            </span>
          </span>
          <input id="f-exp-archivo" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
                 multiple class="sr-only" />
        </label>

        <p id="exp-progreso" class="mt-2 hidden items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-[12px] font-bold text-brand-800"></p>

        ${archivos.length ? `
          <div class="scroll-x no-scrollbar mt-2.5 flex gap-2">
            ${archivos.map(tarjetaArchivo).join('')}
          </div>`
          : `<p class="mt-2 px-1 text-[11.5px] leading-snug text-ink-400">
               Todavía no hay archivos. Lo que subas aquí queda en el expediente completo,
               no dentro de una sesión concreta.
             </p>`}
      </div>

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

    const [v, extra] = await Promise.all([
      API.valoracionDePaciente(p.id),
      API.opcionesValoracion()
    ]);

    const activas = new Set(v && v.secciones_activas && v.secciones_activas.length
      ? v.secciones_activas
      : ['general', 'dolor', 'diagnostico']);
    const datos = (v && v.datos) || {};

    /**
     * Opciones de una lista: las del catálogo MÁS las que añadió el fisio.
     *
     * Se concatenan en vez de sustituirse. Así una actualización del catálogo
     * no borra lo añadido en la clínica, y lo añadido tampoco esconde una
     * opción nueva que llegue con el código.
     */
    const opcionesDe = (sec, c) => {
      const base = Array.isArray(c.options) ? c.options : [];
      const propias = (extra[`${sec.key}.${c.key}`] || []).map((o) => o.valor);
      return base.concat(propias.filter((o) => !base.includes(o)));
    };

    /** Botón para ampliar la lista, solo en los tipos que son una lista. */
    const botonAnadir = (sec, c) =>
      Store.CAMPOS_AMPLIABLES.includes(c.type)
        ? `<button type="button" data-anadir-opcion="${sec.key}.${c.key}" data-label="${E(c.label)}"
             class="rounded-full border border-dashed border-brand-300 bg-brand-50/60 px-3 py-1.5 text-[12px] font-bold text-brand-700 active:scale-95">
             + Otra
           </button>`
        : '';

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
          return `<div>${label}
            <div class="flex items-center gap-1.5">
              <select class="field" data-f="${name}">
                <option value="">— Selecciona —</option>
                ${opcionesDe(sec, c).map((o) => `<option ${val === o ? 'selected' : ''}>${E(o)}</option>`).join('')}
              </select>
              ${botonAnadir(sec, c)}
            </div>
          </div>`;

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
            ${opcionesDe(sec, c).map((o) => `
              <label class="cursor-pointer">
                <input type="checkbox" class="peer sr-only" data-f="${name}" data-multi="1" value="${E(o)}" ${set.has(o) ? 'checked' : ''} />
                <span class="inline-block rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-ink-600
                  peer-checked:border-brand-500 peer-checked:bg-brand-50 peer-checked:text-brand-800">${E(o)}</span>
              </label>`).join('')}
            ${botonAnadir(sec, c)}
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
              ${opcionesDe(sec, c).map((t) => {
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
              ${botonAnadir(sec, c)}
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
      <!-- pb-48: deja sitio a la barra de guardar, que crece si aparecen el
           aviso «sin guardar» y el resultado del guardado -->
      <div class="space-y-3.5 px-4 pb-48 pt-4 anim-fade-up">
        <div class="rounded-2xl bg-brand-50 px-4 py-3">
          <p class="text-[11px] font-extrabold uppercase tracking-wider text-brand-700">Valoración inicial</p>
          <p class="text-[15px] font-extrabold text-brand-900">${E(p.nombre)}</p>
          <p class="mt-1 text-[11.5px] font-medium leading-snug text-brand-700">
            Activa únicamente las secciones que apliquen a la dolencia. Las obligatorias siempre se guardan.
          </p>
        </div>
        ${secciones}
      </div>

      ${barraGuardar('guardar-valoracion', `data-id="${p.id}" data-vid="${v ? v.id : ''}"`, 'Guardar valoración')}`;

    const onMount = (root) => {
      marcarLimpio();
      vigilarCambios(root);
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

      /* --- Ampliar una lista ---------------------------------------------
         La opción se guarda para toda la clínica, no solo para este paciente:
         un antecedente o un test que hizo falta una vez casi siempre vuelve a
         hacer falta. Queda disponible en la siguiente valoración sin tener
         que volver a escribirlo.

         Se recarga la pantalla al terminar porque la lista se pinta de una
         sola pieza; el aviso de cambios sin guardar protege lo capturado. */
      /**
       * Mete la opción recién creada en la lista que ya está en pantalla.
       *
       * Se hace por DOM y NO recargando la vista: el fisio puede llevar media
       * valoración capturada y un `App.render()` la borraría entera. Añadir
       * una opción no puede costar el trabajo de los últimos diez minutos.
       */
      const inyectarOpcion = (boton, ruta, valor) => {
        const contenedor = boton.parentElement;
        const select = contenedor.querySelector(`select[data-f="${ruta}"]`);

        if (select) {
          const op = document.createElement('option');
          op.textContent = valor;
          op.selected = true;                 // se acaba de escribir: se elige
          select.appendChild(op);
          return;
        }

        // `tests` se distingue de `checks` porque sus filas llevan radios.
        const esTest = !!contenedor.querySelector('input[data-test]');

        if (esTest) {
          const fila = document.createElement('div');
          fila.className = 'flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2 anim-fade';
          const op = (v2, txt, cls) => `
            <label class="cursor-pointer">
              <input type="radio" class="peer sr-only" name="${E(ruta + '::' + valor)}" data-f="${ruta}" data-row="${E(valor)}" data-test="1" value="${v2}" ${v2 === 'NE' ? 'checked' : ''} />
              <span class="inline-block rounded-lg px-2.5 py-1 text-[11px] font-bold text-ink-500 ${cls}">${txt}</span>
            </label>`;
          fila.innerHTML =
            `<span class="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink-700">${E(valor)}</span>` +
            op('Pos', 'Positivo', 'peer-checked:bg-rose-100 peer-checked:text-rose-700') +
            op('Neg', 'Negativo', 'peer-checked:bg-emerald-100 peer-checked:text-emerald-700') +
            op('NE', 'N/E', 'peer-checked:bg-ink-200 peer-checked:text-ink-700');
          contenedor.insertBefore(fila, boton);
          return;
        }

        // checks
        const etiqueta = document.createElement('label');
        etiqueta.className = 'cursor-pointer anim-fade';
        etiqueta.innerHTML =
          `<input type="checkbox" class="peer sr-only" data-f="${ruta}" data-multi="1" value="${E(valor)}" checked />
           <span class="inline-block rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-ink-600
             peer-checked:border-brand-500 peer-checked:bg-brand-50 peer-checked:text-brand-800">${E(valor)}</span>`;
        contenedor.insertBefore(etiqueta, boton);
      };

      root.querySelectorAll('[data-anadir-opcion]').forEach((b) => b.addEventListener('click', () => {
        const ruta = b.dataset.anadirOpcion;
        const [seccion, campoKey] = ruta.split('.');

        openSheet({
          title: 'Añadir opción',
          subtitle: b.dataset.label,
          body: `
            <div class="space-y-3">
              <input id="f-nueva-opcion" class="field" placeholder="Escribe la opción nueva" maxlength="80" />
              <p class="text-[11.5px] font-medium leading-snug text-ink-500">
                Se añade a esta lista para <strong>todas las valoraciones</strong>, no solo
                la de este paciente. El catálogo que viene con el sistema no se toca.
              </p>
            </div>`,
          footer: `<button id="btn-nueva-opcion" class="w-full rounded-xl bg-brand-600 py-3.5 text-[14px] font-extrabold text-white active:scale-[.98]">
                     Añadir a la lista</button>`,
          onMount: (sheet) => {
            const campoTexto = sheet.querySelector('#f-nueva-opcion');
            campoTexto.focus();

            const guardar = async () => {
              const valor = campoTexto.value.trim();
              if (!valor) return toast('Escribe el texto de la opción', 'warn');

              const boton = sheet.querySelector('#btn-nueva-opcion');
              boton.disabled = true;
              boton.textContent = 'Añadiendo…';
              try {
                const r = await API.agregarOpcionValoracion(seccion, campoKey, valor);
                closeSheet();
                if (r.ya) {
                  toast(`«${valor}» ya estaba en la lista`, 'warn');
                } else {
                  inyectarOpcion(b, ruta, valor);
                  toast(`«${valor}» añadida y marcada`);
                }
              } catch (err) {
                boton.disabled = false;
                boton.textContent = 'Añadir a la lista';
                toast(err.message || 'No se pudo añadir la opción', 'error', 5000);
              }
            };

            sheet.querySelector('#btn-nueva-opcion').addEventListener('click', guardar);
            campoTexto.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') guardar(); });
          }
        });
      }));
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

    // El catálogo sale de la BASE, no de `Store.CATALOGO_EJERCICIOS`: desde
    // que el fisio puede dar de alta ejercicios propios, leer el catálogo
    // local dejaría los suyos fuera del generador de rutinas, que es justo
    // donde hacen falta.
    const catalogoEj = await API.listarEjercicios();
    // Respaldo al catálogo local: una rutina antigua puede referenciar un
    // ejercicio que ya se desactivó, y sin esto su fila saldría vacía.
    const buscarEj = (id) =>
      catalogoEj.find((e) => e.id === id) ||
      Store.ejercicio(id) ||
      { id, nombre: 'Ejercicio retirado', categoria: '—', image_url: '', descripcion: '', sets: 3, reps: 10, hold: 0 };

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
      <div class="space-y-4 px-4 pb-48 pt-4 anim-fade-up">

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
            <input id="ex-buscar" type="search" data-no-vigilar placeholder="Buscar ejercicio…" class="field !pl-10 !py-2.5" />
          </div>
          <div id="catalogo" class="scroll-x no-scrollbar pb-1">
            ${catalogoEj.map(tarjetaCatalogo).join('')}
          </div>
        </div>

        <!-- Seleccionados -->
        <div>
          ${sectionTitle('Ejercicios de la rutina', `<span id="conteo-sel" class="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-extrabold text-brand-800">0</span>`)}
          <div id="seleccionados" class="space-y-2"></div>
        </div>
      </div>

      ${barraGuardar('guardar-rutina', `data-id="${p.id}" data-rid="${base ? base.id : ''}"`, 'Guardar y activar rutina')}`;

    const onMount = (root) => {
      marcarLimpio();
      vigilarCambios(root);
      const cont = root.querySelector('#seleccionados');
      const conteo = root.querySelector('#conteo-sel');
      const catalogo = root.querySelector('#catalogo');

      const filaSeleccion = (sel, idx) => {
        const ex = buscarEj(sel.ejercicio_id);
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
          const ex = buscarEj(exId);
          seleccion.push({ ejercicio_id: exId, series: ex.sets, reps: ex.reps, hold: ex.hold, frecuencia: 'Diario', nota: '' });
        }
        marcarSucio();
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
        if (quitar) { seleccion.splice(Number(quitar.dataset.quitar), 1); marcarSucio(); return pintar(); }
        const mover = e.target.closest('[data-move]');
        if (mover) {
          const i = Number(mover.dataset.idx), j = i + Number(mover.dataset.move);
          if (j < 0 || j >= seleccion.length) return;
          [seleccion[i], seleccion[j]] = [seleccion[j], seleccion[i]];
          marcarSucio();
          pintar();
        }
      });

      // Filtros del catálogo
      let cat = 'Todas', q = '';
      const filtrar = () => {
        const term = UI.normalize(q);
        const list = catalogoEj.filter((ex) =>
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
      marcarLimpio();   // pintar() disparó eventos: el punto de partida está limpio

      // Estado que leerá el botón de guardar (ya no un global suelto)
      _rutinaEnEdicion = { pacienteId: p.id, rutinaId: base ? base.id : null, items: seleccion };
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
                : `<button data-action="realizar-sorteo" data-id="${s.id}"
                     class="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-violet-600 py-2.5 text-[12.5px] font-bold text-white active:scale-95">
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

          ${p && p.expediente_pendiente ? `
            <label class="flex items-center gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3">
              <input id="f-pendiente" type="checkbox" checked class="h-5 w-5 rounded" />
              <span class="min-w-0 text-[12.5px] font-bold leading-snug text-amber-900">
                El historial clínico sigue pendiente
                <span class="block text-[11px] font-semibold text-amber-700">
                  Desmárcalo cuando ya tengas sus datos completos y su valoración.
                </span>
              </span>
            </label>` : ''}

          ${(() => {
            // El paquete es OPCIONAL: mucha gente paga sesión por sesión. Antes
            // el formulario venía con «Paquete 10 sesiones» y un 10 escritos, y
            // guardar sin mirar le inventaba al paciente un saldo que nadie
            // había comprado —y que luego descuadraba el conteo de sesiones.
            const conPaquete = !!(p && p.paquete_total > 0);
            return `
          <div class="rounded-xl bg-brand-50 p-3">
            <label class="flex items-center gap-2.5">
              <input id="f-paq-on" type="checkbox" ${conPaquete ? 'checked' : ''} class="h-5 w-5 rounded" />
              <span class="text-[12.5px] font-extrabold text-brand-800">
                Tiene un paquete de sesiones contratado
                <span class="block text-[11px] font-semibold text-brand-600">
                  Déjalo apagado si paga sesión por sesión.
                </span>
              </span>
            </label>

            <div id="paq-campos" class="mt-3 ${conPaquete ? '' : 'hidden'}">
              <input id="f-paq-nombre" class="field mb-2"
                value="${E(p && p.paquete_nombre ? p.paquete_nombre : '')}" placeholder="Nombre del paquete" />
              <div class="grid grid-cols-3 gap-2">
                <div><label class="mb-1 block text-[11px] font-bold text-ink-600">Total</label>
                  <input id="f-paq-total" type="number" min="0" class="field" value="${p && p.paquete_total ? p.paquete_total : 10}" /></div>
                <div><label class="mb-1 block text-[11px] font-bold text-ink-600">Usadas</label>
                  <input id="f-paq-usadas" type="number" min="0" class="field" value="${p ? p.paquete_usadas : 0}" /></div>
                <div><label class="mb-1 block text-[11px] font-bold text-ink-600">Vence</label>
                  <input id="f-paq-vence" type="date" class="field" value="${p && p.paquete_vence ? isoDay(p.paquete_vence) : ''}" /></div>
              </div>
            </div>
          </div>`;
          })()}
        </div>`,
      footer: `<button id="btn-guardar-pac" class="w-full rounded-xl bg-brand-600 py-3.5 text-[14px] font-extrabold text-white active:scale-[.98]">
                 ${p ? 'Guardar cambios' : 'Registrar paciente'}</button>`,
      onMount: (root) => {
        const paqOn = root.querySelector('#f-paq-on');
        const paqCampos = root.querySelector('#paq-campos');
        paqOn.addEventListener('change', () => paqCampos.classList.toggle('hidden', !paqOn.checked));

        root.querySelector('#btn-guardar-pac').addEventListener('click', async () => {
          const nombre = val(root, '#f-nombre');
          if (!nombre) return toast('El nombre es obligatorio', 'error');
          const vence = val(root, '#f-paq-vence');
          const pendiente = root.querySelector('#f-pendiente');
          // Sin paquete se guardan ceros de forma explícita: si se dejaran los
          // valores que hubiera en los campos ocultos, apagar el interruptor
          // no borraría nada.
          const conPaquete = paqOn.checked;
          const data = {
            nombre,
            // Quien llena esta ficha entera está completando el expediente;
            // solo sigue pendiente si el propio fisio lo deja marcado.
            expediente_pendiente: pendiente ? pendiente.checked : false,
            edad: Number(val(root, '#f-edad')) || null,
            sexo: val(root, '#f-sexo'),
            telefono: val(root, '#f-tel'),
            email: val(root, '#f-email'),
            diagnostico: val(root, '#f-dx'),
            alergias: val(root, '#f-alergias'),
            paquete_nombre: conPaquete ? val(root, '#f-paq-nombre') : '',
            paquete_total: conPaquete ? (Number(val(root, '#f-paq-total')) || 0) : 0,
            paquete_usadas: conPaquete ? (Number(val(root, '#f-paq-usadas')) || 0) : 0,
            paquete_vence: conPaquete && vence ? new Date(vence + 'T20:00:00').toISOString() : null
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

  /**
   * Alta y reagendado de citas.
   *
   * Tres cosas que antes no hacía y que sí ocurren en el mostrador:
   *
   *   · **Paciente nuevo sin expediente.** Alguien llama para pedir hora y no
   *     está en el sistema. Antes había que salir, crear la ficha completa con
   *     paquete y diagnóstico, y volver. Ahora basta con nombre y teléfono: se
   *     crea el expediente marcado como pendiente y la ficha lo reclama luego.
   *
   *   · **Precio de la sesión.** La tarifa de la clínica es solo el punto de
   *     partida; esta cita concreta puede ir a otro precio (promoción, primera
   *     valoración, paciente de convenio). Se guarda en la cita y es lo que se
   *     propone al cobrar.
   *
   *   · **Huecos ocupados.** Se avisa si el horario pisa otra cita viva. No se
   *     prohíbe —hay clínicas con dos camillas— pero se dice antes de guardar.
   */
  async function sheetCita(pacienteId = null, citaId = null) {
    const [pacs, cita, cfg] = await Promise.all([
      API.listarPacientes(),
      citaId ? API.obtenerCita(citaId) : Promise.resolve(null),
      API.getConfig()
    ]);

    const def = cita ? new Date(cita.inicia_en) : (() => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; })();
    const precioDef = cita && cita.precio !== null && cita.precio !== undefined ? cita.precio : cfg.precio_sesion;

    /* Reagendar no cambia de paciente: el selector de «nuevo» solo aparece al
       crear, y así no se puede crear un expediente por error al mover una hora. */
    const puedeSerNuevo = !cita;
    let modoNuevo = false;
    let conflictos = [];
    let forzado = false;

    openSheet({
      title: cita ? 'Reagendar cita' : 'Agendar cita',
      subtitle: cita ? cita.paciente_nombre : 'El paciente puede ser nuevo o ya estar registrado',
      size: 'tall',
      body: `
        <div class="space-y-3">
          ${puedeSerNuevo ? `
            <div class="flex gap-1 rounded-2xl bg-ink-100 p-1">
              <button type="button" data-modo="registrado"
                class="flex-1 rounded-xl bg-white py-2 text-center text-[12.5px] font-bold text-brand-700 shadow-sm">
                Paciente registrado
              </button>
              <button type="button" data-modo="nuevo"
                class="flex-1 rounded-xl py-2 text-center text-[12.5px] font-bold text-ink-500">
                Paciente nuevo
              </button>
            </div>` : ''}

          <div id="bloque-registrado" ${pacs.length ? '' : 'class="hidden"'}>
            <label class="mb-1 block text-[12px] font-bold text-ink-700">Paciente *</label>
            <select id="f-cita-pac" class="field">
              ${pacs.map((p) => `<option value="${p.id}" ${(cita ? cita.paciente_id : pacienteId) === p.id ? 'selected' : ''}>${E(p.nombre)}</option>`).join('')}
            </select>
          </div>

          <div id="bloque-nuevo" class="hidden space-y-3 rounded-xl bg-brand-50 p-3 ring-1 ring-brand-200">
            <p class="text-[11.5px] font-semibold leading-snug text-brand-900">
              Con el nombre y el teléfono basta para apartar el horario. El historial clínico
              queda pendiente y podrás completarlo cuando venga.
            </p>
            <div>
              <label class="mb-1 block text-[12px] font-bold text-ink-700">Nombre completo *</label>
              <input id="f-cita-nuevo-nombre" class="field" placeholder="Nombre y apellidos" />
            </div>
            <div>
              <label class="mb-1 block text-[12px] font-bold text-ink-700">Teléfono (WhatsApp)</label>
              <input id="f-cita-nuevo-tel" type="tel" inputmode="tel" class="field" placeholder="667 000 0000" />
            </div>
            <div>
              <label class="mb-1 block text-[12px] font-bold text-ink-700">Motivo de consulta</label>
              <input id="f-cita-nuevo-dx" class="field" placeholder="Ej. Dolor lumbar desde hace 2 semanas" />
            </div>
          </div>

          <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Fecha y hora *</label>
            <input id="f-cita-fecha" type="datetime-local" class="field" value="${toLocalInput(def)}" /></div>

          <p id="aviso-conflicto" class="hidden rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-[12px] font-semibold leading-snug text-amber-900"></p>

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

          <div>
            <label class="mb-1 block text-[12px] font-bold text-ink-700">Precio de esta sesión</label>
            <div class="flex items-center gap-2">
              <span class="shrink-0 text-[13px] font-extrabold text-ink-400">$</span>
              <input id="f-cita-precio" type="number" inputmode="decimal" min="0" step="1"
                     class="field" value="${E(String(precioDef ?? ''))}" />
              <button type="button" id="btn-cita-precio-def"
                class="shrink-0 rounded-xl bg-ink-100 px-2.5 py-2 text-[11.5px] font-bold text-ink-600 active:scale-95">
                Tarifa (${E(fmtMoney(cfg.precio_sesion))})
              </button>
            </div>
            <p class="mt-1 px-1 text-[11px] leading-snug text-ink-400">
              Es lo que se propondrá al registrar el cobro. Déjalo vacío para usar la tarifa de la clínica.
            </p>
          </div>

          <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Notas</label>
            <textarea id="f-cita-notas" class="field" placeholder="Opcional">${E(cita ? cita.notas : '')}</textarea></div>

          <label class="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <input id="f-cita-wa" type="checkbox" class="h-5 w-5 rounded" />
            <span class="text-[13px] font-bold text-emerald-800">
              ${cita ? 'Avisar del cambio por WhatsApp' : 'Enviar confirmación por WhatsApp'}
            </span>
          </label>
        </div>`,
      footer: `<button id="btn-guardar-cita" class="w-full rounded-xl bg-brand-600 py-3.5 text-[14px] font-extrabold text-white active:scale-[.98]">
                 ${cita ? 'Guardar cambios' : 'Agendar'}</button>`,
      onMount: (root) => {
        const boton = root.querySelector('#btn-guardar-cita');
        const aviso = root.querySelector('#aviso-conflicto');
        const bloqueReg = root.querySelector('#bloque-registrado');
        const bloqueNuevo = root.querySelector('#bloque-nuevo');

        /* --- Registrado ↔ nuevo --- */
        const pintarModo = () => {
          bloqueReg.classList.toggle('hidden', modoNuevo);
          bloqueNuevo.classList.toggle('hidden', !modoNuevo);
          root.querySelectorAll('[data-modo]').forEach((b) => {
            const on = (b.dataset.modo === 'nuevo') === modoNuevo;
            b.classList.toggle('bg-white', on);
            b.classList.toggle('shadow-sm', on);
            b.classList.toggle('text-brand-700', on);
            b.classList.toggle('text-ink-500', !on);
          });
        };
        root.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => {
          modoNuevo = b.dataset.modo === 'nuevo';
          pintarModo();
        }));

        // Clínica recién estrenada: sin nadie registrado, el único camino
        // posible es el alta exprés, así que se abre ya en ese modo.
        if (puedeSerNuevo && !pacs.length) { modoNuevo = true; pintarModo(); }

        /* --- Precio --- */
        root.querySelector('#btn-cita-precio-def').addEventListener('click', () => {
          root.querySelector('#f-cita-precio').value = String(cfg.precio_sesion ?? '');
        });

        /* --- Aviso de horario ocupado --- */
        const revisarHueco = async () => {
          const fecha = val(root, '#f-cita-fecha');
          if (!fecha) return;
          try {
            conflictos = await API.conflictosDeAgenda({
              inicia_en: new Date(fecha).toISOString(),
              duracion_min: Number(val(root, '#f-cita-dur')) || 45,
              excluirId: cita ? cita.id : null
            });
          } catch { conflictos = []; }         // sin red, no se estorba al usuario

          forzado = false;
          boton.textContent = cita ? 'Guardar cambios' : 'Agendar';
          aviso.classList.toggle('hidden', !conflictos.length);
          if (conflictos.length) {
            aviso.innerHTML = `${icon('alert', 'inline h-3.5 w-3.5 -mt-0.5')} Ese horario ya lo ocupa ` +
              conflictos.map((c) => `<strong>${E(c.paciente_nombre)}</strong> (${E(fmtTime(c.inicia_en))})`).join(', ') +
              '. Puedes agendar igualmente si atiendes en paralelo.';
          }
        };

        let temporizador;
        ['#f-cita-fecha', '#f-cita-dur'].forEach((sel) =>
          root.querySelector(sel).addEventListener('change', () => {
            clearTimeout(temporizador);
            temporizador = setTimeout(revisarHueco, 150);
          }));
        revisarHueco();

        /* --- Guardar --- */
        boton.addEventListener('click', async () => {
          const fecha = val(root, '#f-cita-fecha');
          if (!fecha) return toast('Selecciona fecha y hora', 'error');
          if (modoNuevo && !val(root, '#f-cita-nuevo-nombre')) {
            return toast('Escribe el nombre del paciente nuevo', 'error');
          }
          if (!modoNuevo && !val(root, '#f-cita-pac')) {
            return toast('Elige un paciente o registra uno nuevo', 'error');
          }

          // Primer toque sobre un hueco ocupado: se avisa. El segundo agenda.
          if (conflictos.length && !forzado) {
            forzado = true;
            boton.textContent = 'Agendar de todos modos';
            return toast('Ese horario está ocupado. Toca otra vez para agendar igual.', 'warn', 3500);
          }

          boton.disabled = true;
          const textoOriginal = boton.textContent;
          boton.textContent = 'Guardando…';

          try {
            let paciente = null;

            if (modoNuevo) {
              paciente = await API.crearPacienteExpres({
                nombre: val(root, '#f-cita-nuevo-nombre'),
                telefono: val(root, '#f-cita-nuevo-tel'),
                motivo: val(root, '#f-cita-nuevo-dx')
              });
            }

            const destino = paciente ? paciente.id : val(root, '#f-cita-pac');
            const data = {
              paciente_id: destino,
              inicia_en: new Date(fecha).toISOString(),
              duracion_min: Number(val(root, '#f-cita-dur')),
              motivo: val(root, '#f-cita-motivo'),
              notas: val(root, '#f-cita-notas'),
              precio: val(root, '#f-cita-precio')      // '' ⇒ tarifa de la clínica
            };

            const guardada = cita
              ? await API.actualizarCita(cita.id, data)
              : await API.crearCita(data);

            const avisar = root.querySelector('#f-cita-wa').checked;
            const telefono = paciente
              ? paciente.telefono
              : (pacs.find((x) => x.id === destino) || {}).telefono || '';
            const nombre = paciente
              ? paciente.nombre
              : (pacs.find((x) => x.id === destino) || {}).nombre || '';

            closeSheet();
            toast(cita ? 'Cita actualizada' : (modoNuevo ? 'Paciente y cita registrados' : 'Cita agendada'));
            App.render();

            if (avisar) {
              sheetWhatsApp({
                telefono, nombre,
                titulo: 'Confirmación de cita',
                mensaje: MENSAJES.confirmacion(
                  { ...guardada, paciente_nombre: nombre },
                  cfg.clinica || 'la clínica')
              });
            }
          } catch (err) {
            boton.disabled = false;
            boton.textContent = textoOriginal;
            toast(err.message || 'No se pudo guardar la cita', 'error', 4500);
          }
        });
      }
    });
  }

  /* --- Menú de acciones sobre una cita -------------------------------- */
  async function sheetMenuCita(citaId) {
    // Se pide la cita por su id en vez de buscarla entre las listas pintadas:
    // `proximasCitas` solo trae las 'agendada', así que una cita cancelada o
    // no asistida de fecha futura no aparecía y el menú decía «no encontrada».
    const c = await API.obtenerCita(citaId);
    if (!c) return toast('Cita no encontrada', 'error');

    const viva = c.estado === 'agendada';
    const tieneWhatsApp = !!telWhatsApp(c.paciente && c.paciente.telefono);

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
          ${c.estado !== 'agendada' ? `
            <div class="mb-2 rounded-xl bg-ink-50 px-3 py-2.5">
              <p class="text-[12px] font-bold text-ink-700">
                ${E((ESTADO_CITA[c.estado] || ESTADO_CITA.agendada)[1])}${c.motivo_cancelacion ? `: ${E(c.motivo_cancelacion)}` : ''}
              </p>
              ${c.estado === 'cancelada'
                ? `<p class="mt-0.5 text-[11.5px] text-ink-500">El horario de esta cita está libre en la agenda.</p>` : ''}
            </div>` : ''}

          ${opt('ficha', 'user', 'Abrir ficha del paciente')}
          ${viva ? opt('asistencia', 'check', 'Registrar asistencia', 'text-emerald-700') : ''}
          ${tieneWhatsApp ? opt('whatsapp', 'whatsapp', viva ? 'Recordatorio por WhatsApp' : 'Escribir por WhatsApp', 'text-emerald-700') : ''}
          ${opt('reagendar', 'calendar', viva ? 'Reagendar' : 'Volver a agendar')}
          ${viva ? opt('no-asistio', 'alert', 'Marcar como "no asistió"', 'text-amber-700') : ''}
          ${viva ? opt('cancelar', 'calendarX', 'Cancelar cita y liberar el horario', 'text-rose-600') : ''}
          ${opt('eliminar', 'trash', 'Eliminar del historial', 'text-rose-600')}
        </div>`,
      onMount: (root) => root.querySelectorAll('[data-opt]').forEach((b) => b.addEventListener('click', async () => {
        const a = b.dataset.opt;
        closeSheet();
        if (a === 'ficha') return void (location.hash = `#/t/paciente/${c.paciente_id}`);
        if (a === 'asistencia') return sheetAsistencia(c.paciente_id, c.id);
        if (a === 'whatsapp') return whatsappCita(c.id, viva ? 'recordatorio' : 'seguimiento');
        if (a === 'reagendar') return sheetCita(c.paciente_id, c.id);
        if (a === 'cancelar') return sheetCancelarCita(c.id);
        if (a === 'no-asistio') return sheetMarcarFalta(c.id);
        if (a === 'eliminar') {
          const ok = await confirmSheet({
            title: 'Eliminar cita',
            message: `Se borra del historial la cita de ${c.paciente_nombre} del ${fmtDateTime(c.inicia_en)}. ` +
                     'Si el paciente simplemente no va a venir, es mejor cancelarla: así queda el registro.',
            confirmText: 'Eliminar', tone: 'danger'
          });
          if (ok) { await API.eliminarCita(c.id); toast('Cita eliminada'); App.render(); }
        }
      }))
    });
  }

  /* --- Cancelar una cita ----------------------------------------------- */

  /* Motivos frecuentes en recepción. Se rellenan con un toque porque cancelar
     suele hacerse con el paciente al teléfono, sin tiempo de escribir. */
  const MOTIVOS_CANCELACION = [
    'El paciente no puede asistir', 'Reagenda para otro día', 'Enfermedad',
    'Se ausenta el fisioterapeuta', 'Motivo personal'
  ];

  /**
   * Cancelación con motivo. No borra nada: cambia el estatus en Supabase, deja
   * el porqué y suelta el horario —la agenda solo considera ocupadas las citas
   * en estado 'agendada'—. De paso ofrece avisar al paciente por WhatsApp, que
   * es lo que de verdad cierra el trámite.
   */
  async function sheetCancelarCita(citaId) {
    const c = await API.obtenerCita(citaId);
    if (!c) return toast('Cita no encontrada', 'error');
    const tieneWhatsApp = !!telWhatsApp(c.paciente && c.paciente.telefono);

    openSheet({
      title: 'Cancelar cita',
      subtitle: `${c.paciente_nombre} · ${fmtDateTime(c.inicia_en)}`,
      body: `
        <div class="space-y-3">
          <div class="rounded-xl bg-rose-50 p-3 ring-1 ring-rose-200">
            <p class="text-[12px] font-semibold leading-snug text-rose-900">
              La cita queda marcada como <strong>cancelada</strong> y su horario vuelve a estar
              disponible para agendar a otra persona. El registro se conserva en el historial
              del paciente.
            </p>
          </div>

          <div>
            <label class="mb-1.5 block text-[12px] font-bold text-ink-700">¿Quién cancela?</label>
            <div class="grid grid-cols-3 gap-1.5">
              ${['Paciente', 'Clínica', 'Otro'].map((q, i) => `
                <button type="button" data-quien="${E(q)}"
                  class="rounded-xl border py-2.5 text-[12.5px] font-bold active:scale-95
                    ${i === 0 ? 'border-rose-400 bg-rose-50 text-rose-700' : 'border-ink-200 bg-white text-ink-600'}">
                  ${E(q)}
                </button>`).join('')}
            </div>
          </div>

          <div>
            <label class="mb-1.5 block text-[12px] font-bold text-ink-700">
              Motivo <span class="text-rose-600">*</span>
            </label>
            <div class="mb-2 flex flex-wrap gap-1.5">
              ${MOTIVOS_CANCELACION.map((m) => `
                <button type="button" data-motivo="${E(m)}"
                  class="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-ink-600 active:scale-95">
                  ${E(m)}
                </button>`).join('')}
            </div>
            <input id="f-can-motivo" class="field" placeholder="Toca uno de arriba o escríbelo con tus palabras" />
            <p class="mt-1 text-[11px] font-medium text-ink-400">
              Queda en el historial del paciente. Dentro de tres meses es lo único que explica el hueco.
            </p>
          </div>

          ${tieneWhatsApp ? `
            <label class="flex items-center gap-2.5 rounded-xl border border-ink-200 p-3">
              <input id="f-can-avisar" type="checkbox" checked class="h-5 w-5 rounded" />
              <span class="text-[13px] font-bold text-ink-700">Avisar al paciente por WhatsApp</span>
            </label>` : `
            <p class="rounded-xl bg-ink-50 px-3 py-2.5 text-[11.5px] font-semibold text-ink-500">
              Este paciente no tiene un teléfono utilizable, así que habrá que avisarle por otra vía.
            </p>`}
        </div>`,
      footer: `
        <div class="flex gap-2">
          <button data-sheet-close class="flex-1 rounded-xl bg-ink-100 py-3.5 text-[14px] font-bold text-ink-700 active:scale-[.98]">
            Volver
          </button>
          <button id="btn-cancelar-cita" class="flex-1 rounded-xl bg-rose-600 py-3.5 text-[14px] font-extrabold text-white active:scale-[.98]">
            Cancelar cita
          </button>
        </div>`,
      onMount: (root) => {
        const campo = root.querySelector('#f-can-motivo');
        let quien = 'Paciente';

        const marcar = (grupo, elegido, clases) =>
          root.querySelectorAll(grupo).forEach((o) => {
            const on = o === elegido;
            clases.forEach((c2) => o.classList.toggle(c2, on));
            o.classList.toggle('border-ink-200', !on);
          });

        root.querySelectorAll('[data-quien]').forEach((b) => b.addEventListener('click', () => {
          quien = b.dataset.quien;
          marcar('[data-quien]', b, ['border-rose-400', 'bg-rose-50', 'text-rose-700']);
        }));

        root.querySelectorAll('[data-motivo]').forEach((b) => b.addEventListener('click', () => {
          campo.value = b.dataset.motivo;
          campo.classList.remove('ring-2', 'ring-rose-400');
          marcar('[data-motivo]', b, ['border-rose-400', 'bg-rose-50', 'text-rose-700']);
        }));

        root.querySelector('#btn-cancelar-cita').addEventListener('click', async (e) => {
          const boton = e.currentTarget;
          const avisar = !!(root.querySelector('#f-can-avisar') || {}).checked;

          // Se comprueba aquí además de en la API para no gastar un viaje al
          // servidor y para poder señalar el campo que falta.
          if (!campo.value.trim()) {
            campo.classList.add('ring-2', 'ring-rose-400');
            campo.focus();
            return toast('Escribe el motivo de la cancelación', 'warn');
          }

          boton.disabled = true;
          boton.textContent = 'Cancelando…';
          try {
            await API.cancelarCita(c.id, { motivo: campo.value.trim(), quien });
            closeSheet();
            toast('Cita cancelada · horario liberado', 'warn');
            App.render();
            if (avisar) whatsappCita(c.id, 'cancelacion');
          } catch (err) {
            boton.disabled = false;
            boton.textContent = 'Cancelar cita';
            toast(err.message || 'No se pudo cancelar la cita', 'error', 4000);
          }
        });
      }
    });
  }

  /* --- Marcar falta ----------------------------------------------------
     Una falta no es una cancelación y por eso tiene su propio diálogo: en
     una cancelación alguien avisó y el hueco pudo reasignarse; en una falta
     el horario se perdió sin remedio. La distinción es la que hace que el
     porcentaje de cumplimiento del paciente signifique algo.
     -------------------------------------------------------------------- */
  const MOTIVOS_FALTA = ['No avisó', 'Avisó tarde', 'Se enfermó', 'Problema de transporte', 'Olvidó la cita'];

  async function sheetMarcarFalta(citaId) {
    const c = await API.obtenerCita(citaId);
    if (!c) return toast('Cita no encontrada', 'error');

    openSheet({
      title: 'Marcar falta',
      subtitle: `${c.paciente_nombre} · ${fmtDateTime(c.inicia_en)}`,
      body: `
        <div class="space-y-3">
          <div class="rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
            <p class="text-[12px] font-semibold leading-snug text-amber-900">
              Queda registrada como <strong>no asistió</strong> y cuenta en su historial de
              asistencia. El horario se libera igual, pero a diferencia de una cancelación
              esta sí baja su porcentaje de cumplimiento.
            </p>
          </div>

          <div>
            <label class="mb-1.5 block text-[12px] font-bold text-ink-700">Motivo <span class="text-ink-400">(opcional)</span></label>
            <div class="mb-2 flex flex-wrap gap-1.5">
              ${MOTIVOS_FALTA.map((m) => `
                <button type="button" data-motivo="${E(m)}"
                  class="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-ink-600 active:scale-95">
                  ${E(m)}
                </button>`).join('')}
            </div>
            <input id="f-falta-motivo" class="field" placeholder="O escríbelo con tus palabras" />
          </div>

          <label class="flex items-center gap-2.5 rounded-xl border border-ink-200 p-3">
            <input id="f-falta-just" type="checkbox" class="h-5 w-5 rounded" />
            <span class="text-[13px] font-bold text-ink-700">
              Falta justificada
              <span class="block text-[11px] font-medium text-ink-400">Avisó, aunque fuera tarde, o hubo una urgencia</span>
            </span>
          </label>
        </div>`,
      footer: `
        <div class="flex gap-2">
          <button data-sheet-close class="flex-1 rounded-xl bg-ink-100 py-3.5 text-[14px] font-bold text-ink-700 active:scale-[.98]">
            Volver
          </button>
          <button id="btn-falta" class="flex-1 rounded-xl bg-amber-600 py-3.5 text-[14px] font-extrabold text-white active:scale-[.98]">
            Marcar falta
          </button>
        </div>`,
      onMount: (root) => {
        const campo = root.querySelector('#f-falta-motivo');
        root.querySelectorAll('[data-motivo]').forEach((b) => b.addEventListener('click', () => {
          campo.value = b.dataset.motivo;
          root.querySelectorAll('[data-motivo]').forEach((o) => {
            const on = o === b;
            o.classList.toggle('border-amber-400', on);
            o.classList.toggle('bg-amber-50', on);
            o.classList.toggle('text-amber-700', on);
            o.classList.toggle('border-ink-200', !on);
          });
        }));

        root.querySelector('#btn-falta').addEventListener('click', async (e) => {
          const boton = e.currentTarget;
          boton.disabled = true;
          boton.textContent = 'Guardando…';
          try {
            await API.marcarFalta(c.id, {
              motivo: campo.value.trim(),
              justificada: root.querySelector('#f-falta-just').checked
            });
            closeSheet();
            toast('Falta registrada · horario liberado', 'warn');
            App.render();
          } catch (err) {
            boton.disabled = false;
            boton.textContent = 'Marcar falta';
            toast(err.message || 'No se pudo registrar la falta', 'error', 4000);
          }
        });
      }
    });
  }

  /* --- Registrar asistencia ------------------------------------------- */
  async function sheetAsistencia(pacienteId, citaId = null) {
    const [p, cfg, sorteosActivos, cita] = await Promise.all([
      API.obtenerPaciente(pacienteId), API.getConfig(), API.listarSorteos(),
      citaId ? API.obtenerCita(citaId) : Promise.resolve(null)
    ]);
    if (!p) return toast('Paciente no encontrado', 'error');
    const vigentes = sorteosActivos.filter((s) => s.vigente);

    /* El precio que se propone sale, por este orden, de lo pactado en la cita
       y de la tarifa de la clínica. Así una sesión agendada con descuento se
       cobra con su descuento sin que nadie tenga que acordarse. */
    const precioPactado = cita && cita.precio !== null && cita.precio !== undefined ? Number(cita.precio) : null;
    const montoDef = precioPactado !== null ? precioPactado : cfg.precio_sesion;

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

          <div id="bloque-cobro" class="space-y-2">
            <div class="grid grid-cols-2 gap-3">
              <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Monto</label>
                <input id="f-asi-monto" type="number" inputmode="decimal" min="0" step="1" class="field" value="${E(String(montoDef))}" /></div>
              <div><label class="mb-1 block text-[12px] font-bold text-ink-700">Método</label>
                <select id="f-asi-metodo" class="field">${['Efectivo', 'Transferencia', 'Tarjeta'].map((m) => `<option>${m}</option>`).join('')}</select></div>
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="text-[11px] font-semibold text-ink-400">
                ${precioPactado !== null
                  ? `Precio pactado al agendar: ${E(fmtMoney(precioPactado))}`
                  : `Tarifa de la clínica: ${E(fmtMoney(cfg.precio_sesion))}`}
              </span>
              ${precioPactado !== null && Number(precioPactado) !== Number(cfg.precio_sesion)
                ? `<button type="button" id="btn-asi-tarifa"
                     class="rounded-lg bg-ink-100 px-2 py-1 text-[11px] font-bold text-ink-600 active:scale-95">
                     Usar tarifa ${E(fmtMoney(cfg.precio_sesion))}</button>` : ''}
            </div>
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

        const tarifa = root.querySelector('#btn-asi-tarifa');
        if (tarifa) tarifa.addEventListener('click', () => {
          root.querySelector('#f-asi-monto').value = String(cfg.precio_sesion ?? '');
        });

        root.querySelector('#btn-guardar-asi').addEventListener('click', async (e) => {
          const boton = e.currentTarget;

          /* Un cobro mal capturado no se puede deshacer sin borrar la
             asistencia entera —con sus boletos y su sesión descontada—, así
             que se revisa ANTES de tocar la base. */
          let monto = null;
          if (chk.checked) {
            const bruto = val(root, '#f-asi-monto');
            monto = Number(bruto);
            if (bruto === '' || !Number.isFinite(monto)) return toast('Escribe el monto del cobro', 'error');
            if (monto < 0) return toast('El monto no puede ser negativo', 'error');
            if (monto === 0) {
              return toast('Un cobro de $0 no se registra. Desmarca «Registrar cobro» si la sesión es de cortesía.', 'warn', 4500);
            }
          }

          boton.disabled = true;
          boton.innerHTML = `${icon('refresh', 'h-4.5 w-4.5 animate-spin')} Guardando…`;
          try {
            const r = await API.registrarAsistencia({
              paciente_id: p.id,
              cita_id: citaId,
              fecha: val(root, '#f-asi-fecha') || null,
              monto,
              metodo: val(root, '#f-asi-metodo'),
              nota: val(root, '#f-asi-nota')
            });
            closeSheet();
            toast(r.boletos.length ? `Asistencia registrada · +${r.boletos.length} boleto(s)` : 'Asistencia registrada');
            App.render();
          } catch (err) {
            boton.disabled = false;
            boton.innerHTML = `${icon('check', 'h-4.5 w-4.5')} Confirmar asistencia`;
            toast(err.message || 'No se pudo registrar la asistencia', 'error', 4500);
          }
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

  /* --- Archivos del expediente (imágenes y PDF) ------------------------ */

  /**
   * Sube los archivos elegidos, uno a uno y con parte de avance.
   *
   * En serie a propósito: son ficheros grandes desde el móvil de la clínica y
   * lanzarlos en paralelo satura la subida y hace que fallen varios a la vez.
   * Un archivo rechazado (formato o tamaño) no cancela los demás; al final se
   * dice exactamente cuál falló y por qué.
   */
  async function subirArchivosExpediente(pacienteId, input) {
    const elegidos = [...input.files];
    input.value = '';                     // permite volver a elegir el mismo
    if (!elegidos.length) return;

    const cartel = document.getElementById('exp-progreso');
    const pintar = (html, tono = 'brand') => {
      if (!cartel) return;
      cartel.className = 'mt-2 flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-bold ' +
        (tono === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-brand-50 text-brand-800');
      cartel.innerHTML = html;
    };

    let subidos = 0;
    const fallos = [];

    for (let i = 0; i < elegidos.length; i++) {
      const file = elegidos[i];
      pintar(`${icon('refresh', 'h-3.5 w-3.5 animate-spin')} Subiendo ${i + 1} de ${elegidos.length}: ${E(file.name)}`);
      try {
        await API.subirArchivo(pacienteId, file, {
          titulo: file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Archivo',
          categoria: file.type === 'application/pdf' ? 'Informe' : 'Estudio'
        });
        subidos++;
      } catch (e) {
        fallos.push(e.message || `No se pudo subir ${file.name}`);
      }
    }

    if (fallos.length) {
      pintar(`${icon('alert', 'h-3.5 w-3.5')} ${E(fallos[0])}`, 'error');
      toast(fallos[0], 'error', 5000);
    }
    if (subidos) {
      toast(`${subidos} archivo${subidos === 1 ? '' : 's'} añadido${subidos === 1 ? '' : 's'} al expediente`);
      // Se repinta para que el archivo aparezca ya con su enlace firmado.
      if (!fallos.length) App.render();
    }
  }

  /**
   * Abre un archivo del expediente. El enlace se pide en este momento porque
   * los del listado caducan: si la pestaña llevaba una hora abierta, el que se
   * pintó al renderizar ya no serviría.
   */
  async function verArchivo(id) {
    const a = await API.enlaceDeArchivo(id);
    if (!a || !a.url) return toast('No se pudo abrir el archivo. Puede que ya no esté en el almacenamiento.', 'error', 4500);

    // El PDF lo pinta el visor del navegador, que siempre lo hará mejor que
    // un <iframe> dentro de un panel de 480 px.
    if (a.mime === 'application/pdf') {
      window.open(a.url, '_blank', 'noopener,noreferrer');
      return;
    }

    openSheet({
      title: a.titulo || 'Archivo',
      subtitle: 'Archivo del expediente',
      body: `<img src="${E(a.url)}" alt="${E(a.titulo || '')}" class="w-full rounded-xl object-contain" />`,
      footer: `<a href="${E(a.url)}" target="_blank" rel="noopener noreferrer"
        class="flex w-full items-center justify-center gap-2 rounded-xl bg-ink-100 py-3 text-[13.5px] font-bold text-ink-700">
        ${icon('download', 'h-4 w-4')} Abrir en tamaño completo</a>`
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

  /**
   * Lista de participantes con la opción de sacar a alguien de la rifa.
   *
   * Excluir no es «borrarle los boletos»: los boletos los emite un trigger con
   * cada asistencia y la sincronización los repondría al siguiente guardado
   * del sorteo. Por eso `API.excluirDeSorteo` registra la exclusión en el
   * servidor —y es reversible desde aquí mismo—.
   */
  async function sheetParticipantes(sorteoId) {
    const [s, list, excluidos] = await Promise.all([
      API.obtenerSorteo(sorteoId),
      API.participantesDeSorteo(sorteoId),
      API.excluidosDeSorteo(sorteoId)
    ]);

    // Con el ganador ya elegido, quitar gente no cambiaría nada: el boleto
    // premiado está echado. Se muestra en modo consulta.
    const editable = !s.ganador_paciente_id;

    openSheet({
      title: 'Participantes',
      subtitle: `${s.titulo} · ${s.total_boletos} boletos`,
      size: 'tall',
      body: `
        ${list.length ? `
          <div class="space-y-2">
            ${list.map((r, i) => `
              <details class="group rounded-xl border border-ink-200 bg-white">
                <summary class="flex cursor-pointer list-none items-center gap-3 p-2.5">
                  <span class="w-5 shrink-0 text-center text-[12px] font-extrabold text-ink-400">${i + 1}</span>
                  ${avatar(r.nombre, 'h-9 w-9 text-[11px]')}
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-[13px] font-bold text-ink-800">${E(r.nombre)}</p>
                    <p class="truncate text-[10.5px] font-medium text-ink-400">
                      ${r.total} participación${r.total === 1 ? '' : 'es'}${r.total_anulados ? ` · ${r.total_anulados} anulada${r.total_anulados === 1 ? '' : 's'}` : ''}
                    </p>
                  </div>
                  <span class="shrink-0 rounded-full bg-violet-100 px-2.5 py-1 text-[12px] font-extrabold text-violet-800">${r.total}</span>
                  ${editable ? `
                    <button data-quitar="${r.paciente_id}" data-nombre="${E(r.nombre)}" data-boletos="${r.total}"
                      aria-label="Quitar del sorteo"
                      class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-rose-50 text-rose-600 ring-1 ring-rose-200 active:scale-90">
                      ${icon('ban', 'h-4 w-4')}
                    </button>` : ''}
                  <span class="shrink-0 text-ink-300 transition-transform group-open:rotate-180">${icon('chevronD', 'h-4 w-4')}</span>
                </summary>

                <!-- Un boleto por fila: quitar UNA participación (la asistencia
                     que se registró por error) no es lo mismo que sacar a la
                     persona de la rifa, y hasta ahora solo se podía lo segundo. -->
                <div class="space-y-1 border-t border-ink-100 px-2.5 py-2">
                  ${r.boletos.map((b) => `
                    <div class="flex items-center gap-2 rounded-lg ${b.anulado ? 'bg-ink-50' : 'bg-white'} px-2 py-1.5">
                      <span class="font-mono text-[11.5px] font-bold ${b.anulado ? 'text-ink-400 line-through' : 'text-ink-700'}">${E(b.codigo)}</span>
                      <span class="min-w-0 flex-1 truncate text-[10.5px] font-medium text-ink-400">
                        ${b.anulado ? `Anulada${b.motivo ? ` · ${E(b.motivo)}` : ''}` : E(fmtDate(b.creado_en))}
                      </span>
                      ${editable ? (b.anulado
                        ? `<button data-restaurar="${b.id}" class="shrink-0 rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-brand-700 ring-1 ring-ink-200 active:scale-95">Devolver</button>`
                        : `<button data-anular="${b.id}" data-codigo="${E(b.codigo)}" data-nombre="${E(r.nombre)}"
                             class="shrink-0 rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-600 ring-1 ring-rose-200 active:scale-95">Anular</button>`) : ''}
                    </div>`).join('')}
                </div>
              </details>`).join('')}
          </div>`
          : emptyState('ticket', 'Aún no hay boletos', 'Los boletos se emiten al registrar asistencias dentro del periodo.')}

        ${excluidos.length ? `
          <div class="mt-4">
            ${sectionTitle(`Fuera del sorteo (${excluidos.length})`)}
            <div class="space-y-2">
              ${excluidos.map((x) => `
                <div class="flex items-center gap-3 rounded-xl border border-ink-200 bg-ink-50 p-2.5">
                  ${avatar(x.nombre, 'h-9 w-9 text-[11px]')}
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-[13px] font-bold text-ink-600">${E(x.nombre)}</p>
                    <p class="truncate text-[10.5px] font-medium text-ink-400">
                      ${E(x.motivo || 'Excluido por el fisioterapeuta')} · ${E(fmtDate(x.creado_en))}
                    </p>
                  </div>
                  <button data-readmitir="${x.paciente_id}" data-nombre="${E(x.nombre)}"
                    class="shrink-0 rounded-xl bg-white px-2.5 py-1.5 text-[11.5px] font-bold text-brand-700 ring-1 ring-ink-200 active:scale-95">
                    Readmitir
                  </button>
                </div>`).join('')}
            </div>
            <p class="mt-2 px-1 text-[11px] leading-snug text-ink-400">
              Al readmitir se le devuelven los boletos de todas sus asistencias dentro del periodo.
            </p>
          </div>` : ''}

        ${!editable ? `
          <p class="mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-[11.5px] font-semibold leading-snug text-amber-900 ring-1 ring-amber-200">
            Este sorteo ya tiene ganador, así que la lista queda como quedó. Quitar participantes
            ahora no cambiaría el resultado.
          </p>` : ''}`,
      onMount: (root) => {
        /* --- Anular UNA participación --------------------------------------
           No se borra el boleto: nace de una asistencia que sigue existiendo y
           la sincronización lo repondría al siguiente guardado del sorteo. Se
           marca como anulado, y así la marca sobrevive. */
        root.querySelectorAll('[data-anular]').forEach((b) => b.addEventListener('click', async (e) => {
          e.preventDefault();               // no cerrar el <details>
          const { anular, codigo, nombre } = b.dataset;
          b.disabled = true;
          b.textContent = '…';
          try {
            await API.anularBoleto(anular, { motivo: 'Anulada desde el panel' });
            toast(`Boleto ${codigo} de ${nombre} anulado`);
            closeSheet();
            App.render();
            sheetParticipantes(sorteoId);
          } catch (err) {
            b.disabled = false;
            b.textContent = 'Anular';
            toast(err.message || 'No se pudo anular la participación', 'error', 5000);
          }
        }));

        root.querySelectorAll('[data-restaurar]').forEach((b) => b.addEventListener('click', async (e) => {
          e.preventDefault();
          b.disabled = true;
          b.textContent = '…';
          try {
            await API.restaurarBoleto(b.dataset.restaurar);
            toast('Participación devuelta');
            closeSheet();
            App.render();
            sheetParticipantes(sorteoId);
          } catch (err) {
            b.disabled = false;
            b.textContent = 'Devolver';
            toast(err.message || 'No se pudo devolver la participación', 'error', 4500);
          }
        }));

        root.querySelectorAll('[data-quitar]').forEach((b) => b.addEventListener('click', async (e) => {
          e.preventDefault();               // el botón vive dentro de un <summary>
          const { quitar, nombre, boletos } = b.dataset;
          closeSheet();                       // confirmSheet reemplaza el panel

          const ok = await confirmSheet({
            title: `Quitar a ${nombre}`,
            message: `Se retiran sus ${boletos} boleto(s) de «${s.titulo}» y no se le emitirán más ` +
                     'mientras siga fuera. Sus asistencias y su expediente no se tocan, y puedes ' +
                     'readmitirlo cuando quieras.',
            confirmText: 'Quitar del sorteo',
            tone: 'danger'
          });

          if (ok) {
            try {
              const r = await API.excluirDeSorteo(sorteoId, quitar, { motivo: 'Excluido desde el panel' });
              toast(`${nombre} fuera del sorteo · ${r.boletos_eliminados} boleto(s) retirados`);
              if (!r.permanente) {
                toast('Aviso: tu base no tiene la tabla `sorteo_excluidos`, así que volverá a entrar ' +
                      'al guardar el sorteo. Ejecuta supabase/schema.sql.', 'warn', 6000);
              }
              App.render();
            } catch (e) {
              toast(e.message || 'No se pudo quitar del sorteo', 'error', 4500);
            }
          }
          sheetParticipantes(sorteoId);       // se vuelve a la lista, salga como salga
        }));

        root.querySelectorAll('[data-readmitir]').forEach((b) => b.addEventListener('click', async () => {
          const { readmitir, nombre } = b.dataset;
          b.disabled = true;
          b.textContent = 'Readmitiendo…';
          try {
            const r = await API.readmitirEnSorteo(sorteoId, readmitir);
            closeSheet();
            toast(`${nombre} vuelve al sorteo · ${r.creados} boleto(s) repuestos`);
            App.render();
            sheetParticipantes(sorteoId);
          } catch (e) {
            b.disabled = false;
            b.textContent = 'Readmitir';
            toast(e.message || 'No se pudo readmitir', 'error', 4500);
          }
        }));
      }
    });
  }

  /* --- Animación de sorteo -------------------------------------------- */
  async function ejecutarSorteo(sorteoId) {
    const s = await API.obtenerSorteo(sorteoId);

    // Sin boletos no hay entre quién sortear: se explica en vez de fallar.
    if (!s.total_boletos) {
      return openSheet({
        title: 'Todavía no hay boletos',
        subtitle: s.titulo,
        body: `
          <div class="space-y-3">
            ${emptyState('ticket', 'Nadie participa aún',
              'Los boletos se emiten solos al registrar asistencias dentro del periodo del sorteo.')}
            <div class="rounded-xl bg-violet-50 p-3 ring-1 ring-violet-200">
              <p class="text-[11px] font-extrabold uppercase tracking-wide text-violet-700">Cómo generar boletos</p>
              <ol class="mt-1.5 space-y-1 text-[12.5px] leading-snug text-violet-900">
                <li>1 · Abre la ficha de un paciente.</li>
                <li>2 · Toca <strong>Asistencia</strong> y confirma.</li>
                <li>3 · Se emite 1 boleto por cada asistencia registrada.</li>
              </ol>
              <p class="mt-2 text-[11.5px] font-semibold text-violet-700">
                Periodo: ${E(fmtDate(s.inicia_en))} – ${E(fmtDate(s.termina_en))}
              </p>
            </div>
          </div>`,
        footer: `<button data-sheet-close class="w-full rounded-xl bg-ink-100 py-3 text-[13.5px] font-bold text-ink-700">Entendido</button>`
      });
    }

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

  /* --- Solicitudes de cita (autorregistro) ------------------------------ */
  const ESTADO_SOLICITUD = {
    nueva:      ['brand', 'Nueva'],
    contactada: ['amber', 'Contactada'],
    agendada:   ['green', 'Convertida'],
    descartada: ['ink', 'Descartada']
  };

  async function sheetSolicitudes() {
    const list = await API.listarSolicitudes();
    const pendientes = list.filter((s) => s.estado === 'nueva' || s.estado === 'contactada');
    const cerradas = list.filter((s) => s.estado === 'agendada' || s.estado === 'descartada');

    const tarjeta = (s) => {
      const [tono, etiqueta] = ESTADO_SOLICITUD[s.estado] || ESTADO_SOLICITUD.nueva;
      const abierta = s.estado === 'nueva' || s.estado === 'contactada';
      return `
        <article class="rounded-2xl border ${s.estado === 'nueva' ? 'border-brand-200 bg-brand-50/40' : 'border-ink-200 bg-white'} p-3">
          <div class="flex items-start gap-3">
            ${avatar(s.nombre, 'h-10 w-10 text-[12px]')}
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <p class="truncate text-[13.5px] font-extrabold text-ink-900">${E(s.nombre)}</p>
                ${badge(etiqueta, tono)}
              </div>
              <p class="truncate text-[11.5px] text-ink-500">${E(s.email || '—')}</p>
              ${s.telefono ? `<a href="tel:${E(s.telefono.replace(/\s/g, ''))}"
                class="mt-0.5 inline-flex items-center gap-1 text-[12px] font-bold text-brand-700">
                ${icon('phone', 'h-3.5 w-3.5')} ${E(s.telefono)}</a>` : ''}
            </div>
            <span class="shrink-0 text-[10.5px] font-bold text-ink-400">${E(relDay(s.creado_en))}</span>
          </div>

          ${s.motivo ? `<p class="mt-2 rounded-lg bg-ink-50 px-2.5 py-1.5 text-[12px] leading-snug text-ink-700">${E(s.motivo)}</p>` : ''}
          ${s.preferencia ? `<p class="mt-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-500">
            ${icon('clock', 'h-3.5 w-3.5')} Prefiere: ${E(s.preferencia)}</p>` : ''}

          ${abierta ? `
            <div class="mt-2.5 flex flex-wrap gap-1.5">
              <button data-sol-convertir="${s.id}"
                class="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2 text-[12px] font-bold text-white active:scale-95">
                ${icon('users', 'h-3.5 w-3.5')} Crear expediente
              </button>
              ${telWhatsApp(s.telefono) ? `<button data-sol-wa="${s.id}"
                class="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-[12px] font-bold text-white active:scale-95">
                ${icon('whatsapp', 'h-3.5 w-3.5')} WhatsApp</button>` : ''}
              ${s.estado === 'nueva' ? `<button data-sol-estado="${s.id}" data-valor="contactada"
                class="rounded-xl bg-amber-100 px-3 py-2 text-[12px] font-bold text-amber-800 active:scale-95">Contactada</button>` : ''}
              <button data-sol-estado="${s.id}" data-valor="descartada"
                class="rounded-xl bg-ink-100 px-3 py-2 text-[12px] font-bold text-ink-600 active:scale-95">Descartar</button>
            </div>` : ''}

          ${s.estado === 'agendada' && s.paciente_id ? `
            <a href="#/t/paciente/${s.paciente_id}" data-cerrar-sheet
              class="mt-2.5 flex items-center justify-center gap-1.5 rounded-xl bg-ink-100 py-2 text-[12px] font-bold text-ink-700">
              ${icon('user', 'h-3.5 w-3.5')} Abrir expediente
            </a>` : ''}
        </article>`;
    };

    openSheet({
      title: 'Solicitudes de cita',
      subtitle: `${pendientes.length} pendiente${pendientes.length === 1 ? '' : 's'} · ${list.length} en total`,
      size: 'tall',
      body: `
        <div class="mb-3 rounded-xl bg-brand-50 p-3 ring-1 ring-brand-200">
          <p class="text-[11px] font-extrabold uppercase tracking-wide text-brand-700">Autorregistro</p>
          <p class="mt-1 text-[12px] font-semibold leading-snug text-brand-900">
            Personas que crearon su cuenta desde la app y piden su primera cita.
            «Crear expediente» reutiliza el que ya exista con ese correo en vez de duplicarlo.
          </p>
        </div>

        ${pendientes.length ? `<div class="space-y-2">${pendientes.map(tarjeta).join('')}</div>`
          : emptyState('bell', 'Sin solicitudes pendientes', 'Aquí aparecerán los registros nuevos que pidan cita.')}

        ${cerradas.length ? `
          <div class="mt-4">
            ${sectionTitle('Atendidas')}
            <div class="space-y-2 opacity-75">${cerradas.map(tarjeta).join('')}</div>
          </div>` : ''}`,
      onMount: (root) => {
        root.querySelectorAll('[data-cerrar-sheet]').forEach((a) =>
          a.addEventListener('click', () => closeSheet()));

        root.querySelectorAll('[data-sol-wa]').forEach((b) => b.addEventListener('click', async () => {
          const s = list.find((x) => x.id === b.dataset.solWa);
          if (!s) return;
          const cfg = await API.getConfig();
          // Contactar por WhatsApp ES el trámite de «contactada»: se anota
          // solo para que la solicitud no siga marcada como nueva.
          if (s.estado === 'nueva') await API.actualizarSolicitud(s.id, { estado: 'contactada' });
          sheetWhatsApp({
            telefono: s.telefono,
            nombre: s.nombre,
            titulo: 'Responder solicitud',
            mensaje: MENSAJES.solicitud(s, cfg.clinica || 'la clínica'),
            alEnviar: () => App.render()
          });
        }));

        root.querySelectorAll('[data-sol-estado]').forEach((b) => b.addEventListener('click', async () => {
          await API.actualizarSolicitud(b.dataset.solEstado, { estado: b.dataset.valor });
          toast('Solicitud actualizada');
          closeSheet();
          sheetSolicitudes();
        }));

        root.querySelectorAll('[data-sol-convertir]').forEach((b) => b.addEventListener('click', async () => {
          b.disabled = true;
          b.innerHTML = `${icon('refresh', 'h-3.5 w-3.5 animate-spin')} Creando…`;
          try {
            const pacienteId = await API.convertirSolicitud(b.dataset.solConvertir);
            closeSheet();
            toast('Expediente listo');
            location.hash = `#/t/paciente/${pacienteId}`;
          } catch (e) {
            b.disabled = false;
            b.innerHTML = `${icon('users', 'h-3.5 w-3.5')} Crear expediente`;
            toast(e.message || 'No se pudo crear el expediente', 'error', 4000);
          }
        }));
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
     PERSONALIZACIÓN DE LA CLÍNICA

     Todo lo que hay que cambiar para poner la aplicación a nombre de otra
     clínica. Vive en la tabla `configuracion`, no en el código, así que el
     mismo despliegue sirve para cualquier cliente.

     El logo no se sube hasta pulsar «Guardar»: hasta entonces solo hay una
     vista previa local, igual que en el resto de formularios de la app.
     ====================================================================== */
  const LOGO_POR_DEFECTO = './assets/logo-clidanfi.jpeg';

  async function sheetClinica() {
    const cfg = await API.getConfig({ refrescar: true });

    let logoNuevo = null;   // dataURL comprimido, pendiente de subir
    let quitar = false;     // el fisio pidió volver al logo por defecto

    const tieneLogo = () => !!(cfg.logo_url || cfg.logo_ruta);
    const previa = () => (quitar ? LOGO_POR_DEFECTO : (logoNuevo || cfg.logo_url || LOGO_POR_DEFECTO));

    openSheet({
      title: 'Personalizar clínica',
      subtitle: 'Se aplica en todos los dispositivos',
      body: `
        <div class="space-y-4">

          <div class="flex flex-col items-center gap-3 rounded-2xl border border-ink-200 bg-ink-50 p-4">
            <img id="cli-logo-previa" src="${E(previa())}" alt="Vista previa del logo"
                 class="h-24 w-24 rounded-2xl border border-ink-200 bg-white object-contain" />

            <label class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-300 bg-white py-3.5 active:scale-[.99]">
              ${icon('image', 'h-5 w-5 text-ink-400')}
              <span class="text-[12.5px] font-bold text-ink-600">Elegir imagen del logo</span>
              <input id="f-cli-logo" type="file" accept="image/*" class="sr-only" />
            </label>

            <button id="btn-cli-quitar" type="button"
              class="${tieneLogo() ? '' : 'hidden '}text-[12px] font-bold text-rose-600 active:opacity-70">
              Quitar logo y usar el de por defecto
            </button>

            <p class="text-center text-[11px] leading-snug text-ink-400">
              Se guarda cuadrada y comprimida. Se ve en la cabecera, en la pantalla
              de acceso, en el fondo de escritorio y en el icono de la pestaña.
            </p>
          </div>

          <div><label for="f-cli-nombre" class="mb-1 block text-[12px] font-bold text-ink-700">Nombre de la clínica *</label>
            <input id="f-cli-nombre" class="field" value="${E(cfg.clinica)}" placeholder="Ej. Clínica Danfi" /></div>

          <div><label for="f-cli-lema" class="mb-1 block text-[12px] font-bold text-ink-700">Lema</label>
            <input id="f-cli-lema" class="field" value="${E(cfg.lema)}" placeholder="Ej. Fisioterapia y rehabilitación" /></div>

          <div><label for="f-cli-precio" class="mb-1 block text-[12px] font-bold text-ink-700">Precio de sesión</label>
            <input id="f-cli-precio" type="number" inputmode="decimal" min="0" step="1"
                   class="field" value="${E(String(cfg.precio_sesion))}" />
            <p class="mt-1 px-1 text-[11px] text-ink-400">Se propone como monto al registrar una asistencia.</p></div>
        </div>`,
      footer: `<button id="btn-guardar-clinica"
        class="w-full rounded-xl bg-brand-600 py-3.5 text-[14px] font-extrabold text-white active:scale-[.98] disabled:opacity-60">
        Guardar cambios</button>`,
      onMount: (root) => {
        const img = root.querySelector('#cli-logo-previa');
        const btnQuitar = root.querySelector('#btn-cli-quitar');
        const repintar = () => {
          img.src = previa();
          btnQuitar.classList.toggle('hidden', !(tieneLogo() || logoNuevo) || quitar);
        };

        root.querySelector('#f-cli-logo').addEventListener('change', async (e) => {
          const file = e.target.files[0];
          e.target.value = '';
          if (!file) return;
          try {
            // Cuadro pequeño: el logo se pinta como mucho a 96 px.
            logoNuevo = await readImageCompressed(file, 512, 0.85);
            quitar = false;
            repintar();
          } catch (err) {
            toast('No se pudo procesar la imagen', 'error');
          }
        });

        btnQuitar.addEventListener('click', () => { quitar = true; logoNuevo = null; repintar(); });

        root.querySelector('#btn-guardar-clinica').addEventListener('click', async (e) => {
          const boton = e.currentTarget;
          const clinica = val(root, '#f-cli-nombre');
          if (!clinica) return toast('El nombre de la clínica es obligatorio', 'error');

          /* El precio de sesión es la tarifa que luego propone cada cobro.
             Antes se guardaba con `Number(...) || 0`, así que un campo vacío o
             mal escrito se convertía en «gratis» sin decir nada y todas las
             asistencias posteriores salían a 0. */
          const precioBruto = val(root, '#f-cli-precio');
          const precio = Number(precioBruto);
          if (precioBruto === '' || !Number.isFinite(precio)) {
            return toast('Escribe el precio de sesión (usa 0 si no quieres proponer ninguno)', 'error', 4000);
          }
          if (precio < 0) return toast('El precio de sesión no puede ser negativo', 'error');

          boton.disabled = true;
          boton.textContent = 'Guardando…';
          try {
            // El logo primero: `setConfig` no toca las columnas que no recibe,
            // así que el orden no pisa la URL recién subida.
            if (logoNuevo) await API.subirLogo(logoNuevo);
            else if (quitar && tieneLogo()) await API.quitarLogo();

            const nueva = await API.setConfig({
              clinica,
              lema: val(root, '#f-cli-lema'),
              precio_sesion: precio
            });

            closeSheet();
            await App.aplicarMarca(nueva);
            toast('Configuración guardada');
            App.render();
          } catch (err) {
            console.error('[CLIDANFI] Error al guardar la configuración:', err);
            toast(err.message || 'No se pudo guardar', 'error', 4000);
            boton.disabled = false;
            boton.textContent = 'Guardar cambios';
          }
        });
      }
    });
  }

  /* ======================================================================
     EXPORT
     ====================================================================== */
  /* ======================================================================
     CATÁLOGO DE EJERCICIOS  ·  alta, edición y foto

     El catálogo que viene con el sistema es un punto de partida, no un techo:
     cada clínica trabaja con su material y sus variantes. Y la foto real vale
     bastante más que una miniatura genérica cuando el paciente intenta
     acordarse del ejercicio en su casa, tres días después.
     ====================================================================== */
  async function sheetCatalogoEjercicios() {
    const list = await API.listarEjercicios({ incluirInactivos: true });
    const porCategoria = {};
    list.forEach((ex) => (porCategoria[ex.categoria] = porCategoria[ex.categoria] || []).push(ex));

    openSheet({
      title: 'Catálogo de ejercicios',
      subtitle: `${list.filter((e) => e.activo).length} activos · ${list.filter((e) => e.propio).length} propios`,
      size: 'tall',
      body: `
        <button id="btn-nuevo-ej"
          class="mb-3 flex w-full items-center gap-3 rounded-xl border border-dashed border-brand-300 bg-brand-50/60 p-3 text-left active:scale-[.99]">
          <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-600 text-white">${icon('plus', 'h-4 w-4')}</span>
          <span class="text-[13.5px] font-extrabold text-brand-800">Nuevo ejercicio</span>
        </button>

        ${Object.keys(porCategoria).sort().map((cat) => `
          <div class="mb-3">
            ${sectionTitle(cat)}
            <div class="space-y-1.5">
              ${porCategoria[cat].map((ex) => `
                <button data-editar-ej="${E(ex.id)}"
                  class="flex w-full items-center gap-2.5 rounded-xl border border-ink-200 bg-white p-2 text-left active:bg-ink-50 ${ex.activo ? '' : 'opacity-55'}">
                  <img src="${E(ex.image_url || placeholderImage(ex.nombre, ex.categoria))}" alt=""
                       class="h-11 w-14 shrink-0 rounded-lg object-cover" loading="lazy" />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-[12.5px] font-bold text-ink-800">${E(ex.nombre)}</span>
                    <span class="block truncate text-[10.5px] font-medium text-ink-400">
                      ${ex.sets}×${ex.reps}${ex.hold ? ` · ${ex.hold}s` : ''}${ex.activo ? '' : ' · desactivado'}
                    </span>
                  </span>
                  ${ex.propio ? badge('Propio', 'brand') : ''}
                  <span class="shrink-0 text-ink-300">${icon('chevronR', 'h-4 w-4')}</span>
                </button>`).join('')}
            </div>
          </div>`).join('')}`,
      onMount: (root) => {
        root.querySelector('#btn-nuevo-ej').addEventListener('click', () => sheetEjercicio(null));
        root.querySelectorAll('[data-editar-ej]').forEach((b) => b.addEventListener('click', () =>
          sheetEjercicio(list.find((e) => e.id === b.dataset.editarEj))));
      }
    });
  }

  /** Alta o edición de un ejercicio, con su foto. */
  async function sheetEjercicio(ex) {
    const esNuevo = !ex;
    // `foto` guarda el dataURL nuevo mientras no se guarde: null = no se
    // tocó, '' = se pidió quitarla.
    let foto = null;

    openSheet({
      title: esNuevo ? 'Nuevo ejercicio' : 'Editar ejercicio',
      subtitle: esNuevo ? 'Se añade a tu catálogo' : ex.nombre,
      size: 'tall',
      body: `
        <div class="space-y-3">
          <div>
            <label class="mb-1.5 block text-[12px] font-bold text-ink-700">Foto</label>
            <div class="flex items-center gap-3">
              <img id="ej-foto" src="${E((ex && ex.image_url) || placeholderImage(ex ? ex.nombre : 'Nuevo', ex ? ex.categoria : 'Movilidad'))}"
                   alt="" class="h-20 w-24 shrink-0 rounded-xl border border-ink-200 object-cover" />
              <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                <label class="cursor-pointer rounded-xl bg-brand-600 px-3 py-2.5 text-center text-[12.5px] font-extrabold text-white active:scale-95">
                  ${ex && ex.image_url ? 'Cambiar foto' : 'Subir foto'}
                  <input id="ej-file" type="file" accept="image/*" class="sr-only" />
                </label>
                ${ex && ex.image_url ? `
                  <button id="ej-quitar-foto" class="rounded-xl bg-ink-100 px-3 py-2 text-[12px] font-bold text-ink-600 active:scale-95">
                    Quitar foto
                  </button>` : ''}
                <p class="text-[10.5px] leading-snug text-ink-400">
                  Se reduce a 900 px antes de subirse para que abra rápido en el móvil del paciente.
                </p>
              </div>
            </div>
          </div>

          <div>
            <label class="mb-1 block text-[12px] font-bold text-ink-700">Nombre *</label>
            <input id="ej-nombre" class="field" value="${E(ex ? ex.nombre : '')}" placeholder="Ej. Puente de glúteo a una pierna" />
          </div>

          <div>
            <label class="mb-1 block text-[12px] font-bold text-ink-700">Categoría *</label>
            <select id="ej-cat" class="field">
              ${Store.CATEGORIAS_EJERCICIO.map((c) => `<option ${ex && ex.categoria === c ? 'selected' : ''}>${E(c)}</option>`).join('')}
            </select>
          </div>

          <div>
            <label class="mb-1 block text-[12px] font-bold text-ink-700">Descripción</label>
            <textarea id="ej-desc" class="field" placeholder="Cómo se ejecuta, en una o dos frases.">${E(ex ? ex.descripcion : '')}</textarea>
          </div>

          <div>
            <label class="mb-1 block text-[12px] font-bold text-ink-700">Indicación clave</label>
            <input id="ej-cue" class="field" value="${E(ex ? ex.cue : '')}" placeholder="Ej. No arquees la lumbar." />
          </div>

          <div class="grid grid-cols-3 gap-2">
            <div><label class="mb-1 block text-[11px] font-bold text-ink-600">Series</label>
              <input id="ej-sets" type="number" min="0" class="field" value="${ex ? ex.sets : 3}" /></div>
            <div><label class="mb-1 block text-[11px] font-bold text-ink-600">Reps</label>
              <input id="ej-reps" type="number" min="0" class="field" value="${ex ? ex.reps : 10}" /></div>
            <div><label class="mb-1 block text-[11px] font-bold text-ink-600">Hold (s)</label>
              <input id="ej-hold" type="number" min="0" class="field" value="${ex ? ex.hold : 0}" /></div>
          </div>

          ${!esNuevo ? `
            <label class="flex items-center gap-2.5 rounded-xl border border-ink-200 p-3">
              <input id="ej-activo" type="checkbox" ${ex.activo ? 'checked' : ''} class="h-5 w-5 rounded" />
              <span class="text-[13px] font-bold text-ink-700">
                Disponible en el generador de rutinas
                <span class="block text-[11px] font-medium text-ink-400">
                  Apágalo para retirarlo sin romper las rutinas que ya lo usan.
                </span>
              </span>
            </label>
            <button id="ej-borrar" class="w-full rounded-xl bg-rose-50 py-3 text-[13px] font-bold text-rose-600 active:scale-[.98]">
              Eliminar del catálogo
            </button>` : ''}
        </div>`,
      footer: `<button id="ej-guardar" class="w-full rounded-xl bg-brand-600 py-3.5 text-[14px] font-extrabold text-white active:scale-[.98]">
                 ${esNuevo ? 'Añadir al catálogo' : 'Guardar cambios'}</button>`,
      onMount: (root) => {
        const img = root.querySelector('#ej-foto');

        root.querySelector('#ej-file').addEventListener('change', async (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          try {
            // Se comprime en el navegador, igual que las evidencias: una foto
            // de 8 MB del móvil tarda en abrirse justo cuando el paciente la
            // necesita, en mitad de su rutina.
            foto = await readImageCompressed(file, 900, 0.72);
            img.src = foto;
          } catch (err) {
            toast('No se pudo leer la imagen', 'error');
          }
        });

        const quitar = root.querySelector('#ej-quitar-foto');
        if (quitar) quitar.addEventListener('click', () => {
          foto = '';
          img.src = placeholderImage(val(root, '#ej-nombre') || 'Ejercicio', val(root, '#ej-cat'));
          toast('La foto se quitará al guardar', 'warn');
        });

        const borrar = root.querySelector('#ej-borrar');
        if (borrar) borrar.addEventListener('click', async () => {
          closeSheet();
          const ok = await confirmSheet({
            title: `Eliminar «${ex.nombre}»`,
            message: 'Si alguna rutina lo usa se desactivará en vez de borrarse, para no dejar ' +
                     'huecos en las rutinas ya entregadas.',
            confirmText: 'Eliminar',
            tone: 'danger'
          });
          if (!ok) return sheetCatalogoEjercicios();
          try {
            const r = await API.eliminarEjercicio(ex.id);
            toast(r.borrado
              ? 'Ejercicio eliminado'
              : `Se usa en ${r.rutinas} rutina(s): se desactivó en vez de borrarse`, r.borrado ? 'success' : 'warn', 5000);
          } catch (e2) {
            toast(e2.message || 'No se pudo eliminar', 'error', 4500);
          }
          sheetCatalogoEjercicios();
        });

        root.querySelector('#ej-guardar').addEventListener('click', async (e) => {
          const boton = e.currentTarget;
          const nombre = val(root, '#ej-nombre');
          if (!nombre) return toast('El ejercicio necesita un nombre', 'error');

          boton.disabled = true;
          boton.textContent = 'Guardando…';
          try {
            await API.guardarEjercicio({
              id: esNuevo ? null : ex.id,
              nombre,
              categoria: val(root, '#ej-cat'),
              descripcion: val(root, '#ej-desc'),
              cue: val(root, '#ej-cue'),
              sets: Number(val(root, '#ej-sets')) || 0,
              reps: Number(val(root, '#ej-reps')) || 0,
              hold: Number(val(root, '#ej-hold')) || 0,
              activo: esNuevo ? true : root.querySelector('#ej-activo').checked,
              foto
            });
            closeSheet();
            toast(esNuevo ? 'Ejercicio añadido al catálogo' : 'Ejercicio actualizado');
            sheetCatalogoEjercicios();
          } catch (err) {
            boton.disabled = false;
            boton.textContent = esNuevo ? 'Añadir al catálogo' : 'Guardar cambios';
            toast(err.message || 'No se pudo guardar el ejercicio', 'error', 5000);
          }
        });
      }
    });
  }

  global.VistaFisio = {
    dashboard, agenda, pacientes, paciente, valoracion, rutinaEditor, sorteos,
    sheetCatalogoEjercicios, sheetEjercicio, sheetMarcarFalta,
    leerValoracion, rutinaEnEdicion, hayCambiosSinGuardar, marcarLimpio,
    sheetPaciente, sheetCita, sheetMenuCita, sheetCancelarCita, sheetAsistencia,
    sheetNota, sheetFoto, verArchivo, subirArchivosExpediente,
    sheetSorteo, sheetParticipantes, ejecutarSorteo, sheetPromos, sheetPromoForm,
    sheetSolicitudes, sheetClinica,
    sheetWhatsApp, whatsappCita, whatsappPaciente, sheetRecordatorios, MENSAJES
  };
})(window);
