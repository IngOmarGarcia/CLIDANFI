/* ==========================================================================
   CLIDANFI · ui.js
   Utilidades transversales: formato, iconos SVG, toasts, sheets (modales
   inferiores), confirmaciones y helpers de imagen.
   No conoce nada del dominio: es 100% reutilizable.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------- Escape */
  const escapeHtml = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* --------------------------------------------------------------- Fechas  */
  const DIAS   = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const DIAS_S = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const MESES  = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const MESES_S= ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  // Siempre devuelve una copia: addDays/startOfDay mutan el objeto que reciben
  // y si no clonáramos aquí, `addDays(ini, 7)` corrompería `ini`.
  const toDate = (v) => (v instanceof Date ? new Date(v.getTime()) : new Date(v));
  const startOfDay = (v) => { const d = toDate(v); d.setHours(0, 0, 0, 0); return d; };
  const addDays = (v, n) => { const d = toDate(v); d.setDate(d.getDate() + n); return d; };
  const isoDay = (v) => { const d = startOfDay(v); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const sameDay = (a, b) => isoDay(a) === isoDay(b);

  /** Lunes de la semana de `v` (semana ISO: lunes → domingo). */
  const startOfWeek = (v) => {
    const d = startOfDay(v);
    const dow = (d.getDay() + 6) % 7; // 0 = lunes
    return addDays(d, -dow);
  };

  const fmtTime = (v) =>
    toDate(v).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\s?([ap])\.?\s?m\.?/i, (m, p) => ' ' + p.toLowerCase() + '.m.');

  const fmtDate = (v) => { const d = toDate(v); return `${d.getDate()} ${MESES_S[d.getMonth()]} ${d.getFullYear()}`; };
  const fmtDateLong = (v) => { const d = toDate(v); return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`; };
  const fmtDateTime = (v) => `${fmtDate(v)} · ${fmtTime(v)}`;

  /** "Hoy", "Mañana", "Ayer", "hace 3 días", o la fecha. */
  const relDay = (v) => {
    if (!v) return 'Sin registro';
    const diff = Math.round((startOfDay(v) - startOfDay(new Date())) / 86400000);
    if (diff === 0) return 'Hoy';
    if (diff === 1) return 'Mañana';
    if (diff === -1) return 'Ayer';
    if (diff > 1 && diff < 7) return DIAS[toDate(v).getDay()].replace(/^./, (c) => c.toUpperCase());
    if (diff < -1 && diff > -30) return `hace ${Math.abs(diff)} días`;
    return fmtDate(v);
  };

  /** Valor para <input type="datetime-local"> respetando la zona local. */
  const toLocalInput = (v) => {
    const d = toDate(v);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  /* --------------------------------------------------------------- Números */
  const fmtMoney = (n) =>
    new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(Number(n) || 0);

  const fmtMoneyShort = (n) => {
    const v = Number(n) || 0;
    return v >= 1000 ? `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `$${v}`;
  };

  /* ---------------------------------------------------------------- Texto  */
  const normalize = (s) =>
    String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const initials = (name) =>
    String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();

  const uid = (prefix = 'id') =>
    `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  /* ------------------------------------------------------------ Teléfonos */

  /* Lada por defecto: México. La app se vende a clínicas mexicanas, y quien
     captura un teléfono escribe los 10 dígitos de siempre, sin país. */
  const LADA_POR_DEFECTO = '52';

  /**
   * Deja un teléfono en el formato que exige wa.me: solo dígitos, con país y
   * sin el «+».
   *
   * Acepta lo que la gente escribe de verdad: «667 123 4567», «(667)1234567»,
   * «+52 667 123 4567», «04491234567». Devuelve '' si no hay nada aprovechable,
   * y quien llama debe tratar ese '' como «este paciente no tiene WhatsApp»
   * en vez de generar un enlace roto.
   */
  const telWhatsApp = (tel, lada = LADA_POR_DEFECTO) => {
    // Los ceros de cabecera son prefijos de marcación (00 internacional, 044 y
    // 045 de la vieja numeración móvil), nunca parte del número.
    const d = String(tel ?? '').replace(/\D+/g, '').replace(/^0+/, '');
    if (!d) return '';
    const conPais = d.length === 10 ? lada + d : d;   // 10 dígitos = nacional
    return conPais.length >= 10 && conPais.length <= 15 ? conPais : '';  // E.164
  };

  /**
   * Enlace de WhatsApp con el mensaje ya escrito. Abre la aplicación en el
   * móvil y WhatsApp Web en el escritorio, sin API de pago ni servidor.
   * Devuelve '' si el teléfono no sirve.
   */
  const waLink = (tel, mensaje = '') => {
    const n = telWhatsApp(tel);
    if (!n) return '';
    return `https://wa.me/${n}${mensaje ? `?text=${encodeURIComponent(mensaje)}` : ''}`;
  };

  /** Tamaño de archivo legible: 940 KB, 2.4 MB. */
  const fmtBytes = (n) => {
    const b = Number(n) || 0;
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${Math.round(b / 1024)} KB`;
    return `${(b / 1048576).toFixed(1)} MB`;
  };

  /** Código de boleto legible: ABC-1234 */
  const ticketCode = () => {
    const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const l = Array.from({ length: 3 }, () => L[Math.floor(Math.random() * L.length)]).join('');
    return `${l}-${Math.floor(1000 + Math.random() * 9000)}`;
  };

  /* --------------------------------------------------------------- Iconos  */
  const ICONS = {
    home:        'M3 10.5 12 3l9 7.5M5.5 9.2V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.2',
    calendar:    'M8 2v4M16 2v4M3.5 9.5h17M5 4.5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1z',
    users:       'M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20M9 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM22 20v-1.5a4 4 0 0 0-3-3.87M16 3.6a4 4 0 0 1 0 7.75',
    user:        'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    gift:        'M20 12v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8M3 8h18v4H3zM12 21V8M12 8H8.2a2.6 2.6 0 0 1 0-5.2C11 2.8 12 8 12 8zM12 8h3.8a2.6 2.6 0 0 0 0-5.2C13 2.8 12 8 12 8z',
    dumbbell:    'M2 12h2M20 12h2M6.5 8v8M17.5 8v8M9.5 5.5v13M14.5 5.5v13M9.5 12h5',
    search:      'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
    plus:        'M12 5v14M5 12h14',
    minus:       'M5 12h14',
    chevronR:    'm9 18 6-6-6-6',
    chevronL:    'm15 18-6-6 6-6',
    chevronD:    'm6 9 6 6 6-6',
    arrowLeft:   'M19 12H5M12 19l-7-7 7-7',
    camera:      'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l1.8-2.6h6.4L17 7h3a2 2 0 0 1 2 2zM12 17.5a3.8 3.8 0 1 0 0-7.6 3.8 3.8 0 0 0 0 7.6z',
    check:       'm20 6-11 11-5-5',
    x:           'M18 6 6 18M6 6l12 12',
    edit:        'M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z',
    trash:       'M3 6h18M8 6V4.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1V6m3 0v13.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5V6',
    ticket:      'M3 9.5a2.5 2.5 0 0 1 0 5V19a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-4.5a2.5 2.5 0 0 1 0-5V5a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1zM14 5v14',
    tag:         'M20.6 13.4 12.4 21.6a2 2 0 0 1-2.8 0L2.9 15a2 2 0 0 1-.6-1.5L2.7 4a1 1 0 0 1 1-1l9.5-.4a2 2 0 0 1 1.5.6l6 6a2 2 0 0 1-.1 4.2zM7.8 7.8h.01',
    clock:       'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6.5V12l3.5 2',
    phone:       'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z',
    activity:    'M22 12h-4l-3 8.5L9 3.5 6 12H2',
    clipboard:   'M9 3h6a1 1 0 0 1 1 1v1.5H8V4a1 1 0 0 1 1-1zM8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2',
    sparkles:    'm12 3 1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9zM18.5 14.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z',
    wallet:      'M20 12V8.5H6.2A2.2 2.2 0 0 1 4 6.3V6a2 2 0 0 1 2-2h12.5M4 6v12.5A1.5 1.5 0 0 0 5.5 20H20v-4M17.5 12a2 2 0 0 0 0 4H22v-4z',
    trendingUp:  'm22 7-8.5 8.5-5-5L2 17M16.5 7H22v5.5',
    image:       'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8.5 10.5a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2zM21 15.5 16 10.5 5.5 21',
    save:        'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-7.5H7V21M7.5 3v5h7',
    shuffle:     'M16 3h5v5M3.5 20.5 21 3M21 16v5h-5M15 15l6 6M3.5 3.5 9 9',
    award:       'M12 15.5a6.75 6.75 0 1 0 0-13.5 6.75 6.75 0 0 0 0 13.5zM8.3 14.2 7 22l5-2.8L17 22l-1.3-7.8',
    logout:      'M9 21H5.5A1.5 1.5 0 0 1 4 19.5v-15A1.5 1.5 0 0 1 5.5 3H9M16.5 16.5 21 12l-4.5-4.5M21 12H9',
    bell:        'M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5zM13.7 20a2 2 0 0 1-3.4 0',
    heart:       'M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l8.8 8.7 8.8-8.7a5 5 0 0 0 0-7.1z',
    star:        'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
    play:        'M6 4.5v15l13-7.5z',
    layers:      'm12 2.5 9.5 5-9.5 5-9.5-5zM2.5 12.5 12 17.5l9.5-5M2.5 17 12 22l9.5-5',
    filter:      'M4 5h16l-6.5 7.5V20l-3-2v-5.5z',
    stethoscope: 'M6 3v5a4 4 0 0 0 8 0V3M4.5 3H7M13 3h2.5M10 12v2.5a5 5 0 0 0 10 0V13M20 13a1.6 1.6 0 1 0 0-3.2A1.6 1.6 0 0 0 20 13z',
    info:        'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4.5M12 8h.01',
    alert:       'M12 8.5V13M12 16.5h.01M10.3 3.8 2.5 17.5A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0z',
    copy:        'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
    refresh:     'M20.5 12a8.5 8.5 0 1 1-2.5-6M20.5 4v5h-5',
    eye:         'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    eyeOff:      'M10.6 6.2A9.9 9.9 0 0 1 12 6c6.4 0 10 6 10 6a18.4 18.4 0 0 1-3 3.6M6.2 6.2A18.3 18.3 0 0 0 2 12s3.6 6 10 6a9.8 9.8 0 0 0 4-.8M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2',
    lock:        'M6 10.5h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 10.5V7a4 4 0 0 1 8 0v3.5',
    shield:      'M12 22s8-3.5 8-10V5.5l-8-3-8 3V12c0 6.5 8 10 8 10zM9.2 12l2 2 3.6-4',
    // Globo de conversación con el auricular dentro: la silueta de WhatsApp
    // trazada a línea, para que combine con el resto del juego de iconos.
    whatsapp:    'M20.5 11.6a8.4 8.4 0 0 1-12.4 7.4L3.5 20.5l1.5-4.5A8.4 8.4 0 1 1 20.5 11.6zM9.3 8.1c.15-.35.35-.4.6-.4h.5c.2 0 .4.05.6.45l.6 1.45c.1.25 0 .45-.1.6l-.35.45c-.15.2-.25.35-.1.6a5.6 5.6 0 0 0 2.7 2.35c.25.1.45.05.6-.15l.45-.5c.15-.2.35-.2.55-.1l1.45.7c.25.15.35.25.35.45 0 .7-.55 1.45-.9 1.6-.4.15-.9.25-1.5.15a8.8 8.8 0 0 1-5.95-5.7c-.15-.8-.05-1.55.2-2z',
    userPlus:    'M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 7.5v6M22 10.5h-6',
    file:        'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13.5h6M9 17h4',
    upload:      'M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3M12 3.5v12M7.5 8 12 3.5 16.5 8',
    download:    'M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3M12 15.5v-12M7.5 11 12 15.5 16.5 11',
    ban:         'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM4.9 4.9l14.2 14.2',
    calendarX:   'M8 2v4M16 2v4M3.5 9.5h17M5 4.5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1zM9.8 13.3l4.4 4.4M14.2 13.3l-4.4 4.4'
  };

  /** Devuelve un <svg> inline. `cls` controla tamaño/color con Tailwind. */
  const icon = (name, cls = 'h-5 w-5', strokeWidth = 1.8) => {
    const d = ICONS[name] || ICONS.info;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}"
      stroke-linecap="round" stroke-linejoin="round" class="${cls}" aria-hidden="true"><path d="${d}"/></svg>`;
  };

  /* ------------------------------------------------------- Imágenes SVG    */
  // Tonos derivados del logotipo (rojo #921f23 · crema #ded6ca)
  const PALETTES = {
    Cervical:  ['#fbe3e4', '#921f23'], Hombro:   ['#efe9df', '#5b5852'],
    Lumbar:    ['#f6cbcd', '#7a1d21'], Cadera:   ['#ded6ca', '#43413c'],
    Rodilla:   ['#f8f4ed', '#78756f'], Tobillo:  ['#f6d3cf', '#8f2a20'],
    Core:      ['#eda3a7', '#661d20'], Movilidad:['#e4e2dd', '#5b5852']
  };

  /**
   * Miniatura SVG (data-URI) para ejercicios sin foto real.
   * Cuando subas fotos reales a Supabase Storage, `image_url` gana.
   */
  const placeholderImage = (label, category) => {
    const [bg, fg] = PALETTES[category] || ['#e4e2dd', '#5b5852'];
    const txt = escapeHtml(String(label || '').slice(0, 22));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220" viewBox="0 0 320 220">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="#ffffff"/>
      </linearGradient></defs>
      <rect width="320" height="220" fill="url(#g)"/>
      <g stroke="${fg}" stroke-width="7" stroke-linecap="round" fill="none" opacity=".65">
        <circle cx="160" cy="72" r="19"/><path d="M160 91v46M160 137l-24 40M160 137l24 40M133 108h54"/>
      </g>
      <text x="160" y="207" text-anchor="middle" font-family="Inter,system-ui,sans-serif"
            font-size="15" font-weight="700" fill="${fg}" opacity=".85">${txt}</text>
    </svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  };

  /**
   * Lee un <input type="file"> y devuelve un dataURL comprimido.
   * Evita reventar localStorage y simula lo que subirías a Supabase Storage.
   */
  const readImageCompressed = (file, maxSide = 900, quality = 0.72) =>
    new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) return reject(new Error('Archivo no válido'));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Imagen corrupta'));
        img.onload = () => {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });

  /* ---------------------------------------------------------------- Toasts */
  const TONES = {
    success: ['bg-brand-700', 'check'],
    error:   ['bg-rose-600', 'alert'],
    info:    ['bg-ink-800', 'info'],
    warn:    ['bg-amber-600', 'alert']
  };

  const toast = (message, tone = 'success', ms = 2600) => {
    const root = document.getElementById('toast-root');
    if (!root) return;
    const [bg, ico] = TONES[tone] || TONES.info;
    const el = document.createElement('div');
    el.className = `anim-fade-up pointer-events-auto flex w-full max-w-[420px] items-center gap-2.5 rounded-2xl ${bg} px-4 py-3 text-white shadow-lift`;
    el.setAttribute('role', 'status');
    el.innerHTML = `${icon(ico, 'h-5 w-5 shrink-0')}<p class="text-[13px] font-semibold leading-snug">${escapeHtml(message)}</p>`;
    root.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(-8px)';
      setTimeout(() => el.remove(), 260);
    }, ms);
  };

  /* --------------------------------------------------- Sheet (modal móvil) */
  let sheetCleanup = null;

  /**
   * Panel inferior deslizante. `body` es HTML; `onMount(el)` recibe el nodo
   * del contenido para enganchar listeners específicos.
   */
  const openSheet = ({ title, subtitle = '', body = '', footer = '', size = 'auto', onMount, onClose }) => {
    closeSheet();
    const root = document.getElementById('sheet-root');
    const heights = { auto: 'max-h-[88dvh]', tall: 'h-[92dvh]', mid: 'h-[70dvh]' };

    const wrap = document.createElement('div');
    wrap.className = 'fixed inset-0 z-50';
    wrap.innerHTML = `
      <div data-sheet-backdrop class="anim-fade absolute inset-0 bg-ink-900/45 backdrop-blur-[2px]"></div>
      <div class="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[480px]">
        <section role="dialog" aria-modal="true" aria-label="${escapeHtml(title || 'Panel')}"
          class="anim-sheet flex ${heights[size] || heights.auto} flex-col overflow-hidden rounded-t-[1.75rem] bg-white shadow-lift">
          <header class="shrink-0 border-b border-ink-100 px-4 pb-3 pt-2">
            <div class="mx-auto mb-2.5 h-1.5 w-10 rounded-full bg-ink-200"></div>
            <div class="flex items-start gap-3">
              <div class="min-w-0 flex-1">
                <h2 class="truncate text-[16px] font-extrabold tracking-tight text-ink-900">${escapeHtml(title || '')}</h2>
                ${subtitle ? `<p class="mt-0.5 truncate text-[12px] font-medium text-ink-500">${escapeHtml(subtitle)}</p>` : ''}
              </div>
              <button data-sheet-close aria-label="Cerrar"
                class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-100 text-ink-600 active:scale-95">
                ${icon('x', 'h-4 w-4')}
              </button>
            </div>
          </header>
          <div data-sheet-body class="flex-1 overflow-y-auto overscroll-contain px-4 py-4">${body}</div>
          ${footer ? `<footer class="shrink-0 border-t border-ink-100 bg-white px-4 py-3 nav-safe">${footer}</footer>` : ''}
        </section>
      </div>`;

    root.appendChild(wrap);
    document.body.style.overflow = 'hidden';

    const close = () => { closeSheet(); onClose && onClose(); };
    wrap.querySelector('[data-sheet-backdrop]').addEventListener('click', close);
    wrap.querySelectorAll('[data-sheet-close]').forEach((b) => b.addEventListener('click', close));

    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);

    sheetCleanup = () => { document.removeEventListener('keydown', onKey); wrap.remove(); document.body.style.overflow = ''; };
    onMount && onMount(wrap);
    return wrap;
  };

  const closeSheet = () => { if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; } };

  /** Confirmación con promesa. */
  const confirmSheet = ({ title, message, confirmText = 'Confirmar', tone = 'brand' }) =>
    new Promise((resolve) => {
      const color = tone === 'danger' ? 'bg-rose-600' : 'bg-brand-700';
      openSheet({
        title,
        body: `<p class="text-[14px] leading-relaxed text-ink-600">${escapeHtml(message)}</p>`,
        footer: `<div class="flex gap-2">
            <button data-confirm="0" class="flex-1 rounded-xl bg-ink-100 py-3 text-[14px] font-bold text-ink-700 active:scale-[.98]">Cancelar</button>
            <button data-confirm="1" class="flex-1 rounded-xl ${color} py-3 text-[14px] font-bold text-white active:scale-[.98]">${escapeHtml(confirmText)}</button>
          </div>`,
        onMount: (el) => el.querySelectorAll('[data-confirm]').forEach((b) =>
          b.addEventListener('click', () => { const v = b.dataset.confirm === '1'; closeSheet(); resolve(v); })),
        onClose: () => resolve(false)
      });
    });

  /* ------------------------------------------------- Guardado explícito ---- */

  /**
   * Ejecuta un guardado mostrando su estado en el propio botón y en un aviso
   * bajo él. Nada se persiste hasta que el usuario pulsa: no hay autoguardado.
   *
   * - Bloquea el botón mientras dura la petición (evita el doble envío).
   * - Éxito → botón verde + mensaje, y `alTerminar()` si se pasó.
   * - Error → botón restaurado + motivo real del servidor, SIN salir de la
   *   pantalla, para que no se pierda lo capturado.
   *
   * @param {HTMLElement} boton
   * @param {() => Promise<any>} tarea
   */
  const guardarConEstado = async (boton, tarea, { textoOk = 'Guardado', alTerminar = null } = {}) => {
    if (!boton || boton.dataset.guardando === '1') return;

    const htmlOriginal = boton.innerHTML;
    const claseOriginal = boton.className;
    const aviso = document.getElementById('aviso-guardado');

    const pintarAviso = (tipo, texto) => {
      if (!aviso) return;
      const estilos = {
        ok:    'border-emerald-200 bg-emerald-50 text-emerald-800',
        error: 'border-rose-200 bg-rose-50 text-rose-800'
      };
      aviso.className = `mt-2 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[12.5px] font-semibold leading-snug ${estilos[tipo]}`;
      aviso.innerHTML = `${icon(tipo === 'ok' ? 'check' : 'alert', 'h-4 w-4 shrink-0')}<span>${escapeHtml(texto)}</span>`;
      aviso.classList.remove('hidden');
    };

    boton.dataset.guardando = '1';
    boton.disabled = true;
    boton.className = claseOriginal + ' opacity-70';
    boton.innerHTML = `${icon('refresh', 'h-4.5 w-4.5 animate-spin')} Guardando…`;
    if (aviso) aviso.classList.add('hidden');

    try {
      const resultado = await tarea();
      boton.className = claseOriginal.replace(/bg-\w+-\d+/, 'bg-emerald-600');
      boton.innerHTML = `${icon('check', 'h-4.5 w-4.5')} ${escapeHtml(textoOk)}`;
      pintarAviso('ok', `${textoOk} correctamente.`);
      toast(textoOk);
      if (alTerminar) setTimeout(() => alTerminar(resultado), 600);
      return resultado;
    } catch (e) {
      console.error('[CLIDANFI] Error al guardar:', e);
      boton.className = claseOriginal;
      boton.innerHTML = htmlOriginal;
      pintarAviso('error', e.message || 'No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.');
      toast('No se pudo guardar', 'error', 4000);
      throw e;
    } finally {
      boton.dataset.guardando = '0';
      boton.disabled = false;
    }
  };

  /** Contenedor donde `guardarConEstado` escribe el resultado. */
  const avisoGuardado = () => `<p id="aviso-guardado" role="status" aria-live="polite" class="hidden"></p>`;

  /* -------------------------------------------------- Bloques reutilizables */
  const avatar = (name, cls = 'h-11 w-11 text-[13px]') => `
    <div class="grid ${cls} shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-100 to-brand-200 font-extrabold text-brand-800 ring-1 ring-white">
      ${escapeHtml(initials(name))}
    </div>`;

  const badge = (text, tone = 'ink') => {
    const tones = {
      ink:    'bg-ink-100 text-ink-600',
      brand:  'bg-brand-100 text-brand-800',
      green:  'bg-emerald-100 text-emerald-800',
      amber:  'bg-amber-100 text-amber-800',
      rose:   'bg-rose-100 text-rose-700',
      blue:   'bg-blue-100 text-blue-800',
      violet: 'bg-violet-100 text-violet-800'
    };
    return `<span class="inline-flex items-center gap-1 rounded-full ${tones[tone] || tones.ink} px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide">${escapeHtml(text)}</span>`;
  };

  const emptyState = (iconName, title, hint = '') => `
    <div class="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-ink-200 bg-white/60 px-6 py-10 text-center">
      <div class="grid h-12 w-12 place-items-center rounded-full bg-ink-100 text-ink-400">${icon(iconName, 'h-6 w-6')}</div>
      <p class="text-[14px] font-bold text-ink-700">${escapeHtml(title)}</p>
      ${hint ? `<p class="max-w-[260px] text-[12.5px] leading-relaxed text-ink-500">${escapeHtml(hint)}</p>` : ''}
    </div>`;

  const sectionTitle = (text, actionHtml = '') => `
    <div class="mb-2.5 flex items-end justify-between gap-3 px-1">
      <h2 class="text-[13px] font-extrabold uppercase tracking-wider text-ink-500">${escapeHtml(text)}</h2>
      ${actionHtml}
    </div>`;

  /* ------------------------------------------------------------- Exports   */
  global.UI = {
    escapeHtml, normalize, initials, uid, ticketCode,
    telWhatsApp, waLink, fmtBytes,
    toDate, startOfDay, startOfWeek, addDays, isoDay, sameDay, toLocalInput,
    fmtTime, fmtDate, fmtDateLong, fmtDateTime, relDay, fmtMoney, fmtMoneyShort,
    icon, ICONS, placeholderImage, readImageCompressed,
    toast, openSheet, closeSheet, confirmSheet,
    guardarConEstado, avisoGuardado,
    avatar, badge, emptyState, sectionTitle,
    DIAS, DIAS_S, MESES, MESES_S
  };
})(window);
