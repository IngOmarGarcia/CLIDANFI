#!/usr/bin/env node
/* ==========================================================================
   CLIDANFI · test-subidas.js
   Prueba de regresión de las subidas de imagen (logo y evidencias).

   Nace de un fallo real en producción: «TypeError: Failed to fetch · Refused
   to connect because it violates the document's Content Security Policy».
   La causa no era Supabase: `subirLogo` leía el dataURL con `fetch('data:…')`,
   y el navegador cuenta eso como CONEXIÓN, así que lo gobierna `connect-src`
   (no `img-src`) y la CSP lo rechazaba antes de salir a la red.

   Aquí `fetch` se sabotea a propósito para imitar ese bloqueo: si el código
   vuelve a depender de él, esta prueba falla igual que fallaba producción.

   Uso:  npm run test:subidas
         node scripts/test-subidas.js dist/js/api.js
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const API_JS = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(RAIZ, 'js', 'api.js');
console.log(`Objetivo: ${path.relative(RAIZ, API_JS) || API_JS}\n`);

let pasan = 0, fallan = 0;
const check = (c, m, extra = '') => {
  if (c) { pasan++; console.log(`  ✓ ${m}`); }
  else { fallan++; console.log(`  ✗ ${m}${extra ? `\n      → ${extra}` : ''}`); }
};

// JPEG mínimo real (SOI + EOI + relleno) codificado en base64
const BYTES = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0xFF, 0xD9]);
const DATA_URL = `data:image/jpeg;base64,${BYTES.toString('base64')}`;

const subidos = [];
let fetchLlamado = false;
const FILA_CFG = { id: 1, clinica: 'CLIDANFI', lema: '', logo_url: '', logo_ruta: '', precio_sesion: 450 };

const SB = {
  from: (tabla) => {
    const b = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'insert', 'update']) b[m] = () => b;
    // `configuracion` se comporta como una tabla de verdad: lo que escribes
    // es lo que luego lees.
    b.upsert = (fila) => { Object.assign(FILA_CFG, fila); return b; };
    const r = () => (tabla === 'perfiles'
      ? { data: { id: 'u1', rol: 'fisio', nombre: 'Fisio' }, error: null }
      : { data: { ...FILA_CFG }, error: null });
    b.single = async () => r();
    b.maybeSingle = async () => r();
    b.then = (res, rej) => Promise.resolve(r()).then(res, rej);
    return b;
  },
  rpc: async () => ({ data: [], error: null }),
  auth: {
    getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'f@x.com' } } } }),
    getUser: async () => ({ data: { user: { id: 'u1', email: 'f@x.com' } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({})
  },
  storage: {
    from: () => ({
      upload: async (ruta, blob, opts) => { subidos.push({ ruta, blob, opts }); return { data: { path: ruta }, error: null }; },
      getPublicUrl: (ruta) => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/marca/${ruta}` } }),
      createSignedUrl: async (ruta) => ({ data: { signedUrl: `https://proj.supabase.co/signed/${ruta}` }, error: null }),
      remove: async () => { const p = Promise.resolve({ data: null, error: null }); p.catch = () => p; return p; }
    })
  }
};

const win = {};
const ctx = {
  window: win, console, SB,
  UI: { startOfWeek: (d) => new Date(d), addDays: (d, n) => new Date(+new Date(d) + n * 864e5),
        isoDay: (d) => new Date(d).toISOString().slice(0, 10), normalize: (s) => String(s || ''), uid: (p) => `${p}-1` },
  // La CSP de producción hacía exactamente esto con `data:`:
  fetch: () => { fetchLlamado = true; return Promise.reject(new TypeError('Failed to fetch')); },
  Blob, atob, btoa, Uint8Array, TextDecoder, decodeURIComponent,
  setTimeout, clearTimeout, Promise, Date, Math, JSON, Number, String, Object, Array, Error, TypeError, RegExp, Set, Buffer
};
ctx.globalThis = ctx;
win.SB = SB; win.UI = ctx.UI;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(API_JS, 'utf8'), ctx, { filename: 'api.js' });
const API = win.API;

(async () => {
  console.log('1 · subirLogo() con la CSP bloqueando fetch()');
  let err = '';
  let cfg = null;
  try { cfg = await API.subirLogo(DATA_URL); } catch (e) { err = e.message; }

  check(!err, 'subirLogo() se completa', err);
  check(!fetchLlamado, 'NO se llamó a fetch() (no depende de connect-src)');
  check(subidos.length === 1, `se subió exactamente 1 archivo (fueron ${subidos.length})`);

  if (subidos.length) {
    const { blob, opts, ruta } = subidos[0];
    const bytes = Buffer.from(await blob.arrayBuffer());
    check(bytes.equals(BYTES), 'los bytes subidos coinciden con el original',
      `esperado ${BYTES.toString('hex')} · recibido ${bytes.toString('hex')}`);
    check(blob.type === 'image/jpeg', `el Blob conserva el tipo MIME (${blob.type})`);
    check(opts.contentType === 'image/jpeg', 'se envía contentType image/jpeg');
    check(/\.jpg$/.test(ruta), `la ruta es un .jpg (${ruta})`);
  }
  check(cfg && /^https:\/\/proj\.supabase\.co\//.test(cfg.logo_url || ''),
    'logo_url apunta al Storage de Supabase',
    `logo_url = ${cfg && cfg.logo_url}`);

  console.log('\n2 · Un dataURL corrupto da un error claro, no «Failed to fetch»');
  let e2 = '';
  try { await API.subirLogo('no-soy-un-data-url'); } catch (e) { e2 = e.message; }
  check(/formato válido/i.test(e2), 'mensaje comprensible', `mensaje: ${JSON.stringify(e2)}`);
  check(!/Failed to fetch/i.test(e2), 'no se disfraza de error de red');

  console.log(`\n${'─'.repeat(60)}\n${pasan} pasan · ${fallan} fallan\n`);
  process.exit(fallan ? 1 : 0);
})();
