#!/usr/bin/env node
/* ==========================================================================
   CLIDANFI · test-navegacion.js
   La lista de secciones se pinta en dos sitios (barra inferior en móvil y
   barra lateral en escritorio) a partir de la MISMA función. Si se separan,
   una sección nueva aparecería en un sitio y no en el otro sin que nada
   fallara. Estas pruebas atan las dos presentaciones a la misma fuente.

   Uso:  npm run test:navegacion
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const APP_JS = process.argv[2] ? path.resolve(process.argv[2]) : path.join(RAIZ, 'js', 'app.js');

let pasan = 0, fallan = 0;
const check = (cond, msg, extra = '') => {
  if (cond) { pasan++; console.log(`  ✓ ${msg}`); }
  else { fallan++; console.log(`  ✗ ${msg}${extra ? `\n      → ${extra}` : ''}`); }
};

/* app.js es un IIFE que espera un navegador. Se le da el mínimo para que
   evalúe sin tocar el DOM: lo único que se extrae es AppNav.
   `icon` y `escapeHtml` no se inventan como globales sueltos —en app.js son
   constantes internas del IIFE, sacadas por destructuring de `UI`— así que
   el stub los cuelga de `UI`, igual que en el navegador real. `icon` puede
   devolver cadena vacía (las pruebas no miran los iconos); `escapeHtml` sí
   tiene que escapar de verdad, porque la prueba 5 depende de eso. */
function cargarAppNav() {
  const escapeHtml = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ctx = {
    console,
    UI: {
      icon: () => '',
      escapeHtml,
      avatar: () => '',
      toast: () => {},
      openSheet: () => {},
      closeSheet: () => {},
      confirmSheet: () => Promise.resolve(false)
    },
    window: { addEventListener: () => {} },
    document: {
      getElementById: () => null,
      addEventListener: () => {},
      querySelector: () => null
    },
    navigator: {},
    location: { hash: '' },
    setTimeout, clearTimeout
  };
  ctx.window.document = ctx.document;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(APP_JS, 'utf8'), ctx, { filename: 'app.js' });
  return ctx.window.AppNav;
}

const ITEMS = [
  { href: '#/t/dashboard', icono: 'home',     label: 'Inicio' },
  { href: '#/t/agenda',    icono: 'calendar', label: 'Agenda' },
  { href: '#/t/pacientes', icono: 'users',    label: 'Pacientes' }
];

const AppNav = cargarAppNav();

console.log('\n1 · Las dos presentaciones salen de la misma lista');
const inferior = AppNav.navHTML(ITEMS, '#/t/agenda', 'inferior');
const lateral  = AppNav.navHTML(ITEMS, '#/t/agenda', 'lateral');

for (const it of ITEMS) {
  check(inferior.includes(it.href), `la barra inferior incluye ${it.href}`);
  check(lateral.includes(it.href),  `la barra lateral incluye ${it.href}`);
}

console.log('\n2 · La sección activa se marca en las dos');
check((inferior.match(/aria-current="page"/g) || []).length === 1,
  'la barra inferior marca exactamente una activa');
check((lateral.match(/aria-current="page"/g) || []).length === 1,
  'la barra lateral marca exactamente una activa');

console.log('\n3 · La etiqueta de texto viaja en las dos variantes');
// En la lateral el texto va siempre visible; en la inferior, debajo del icono.
check(inferior.includes('Agenda'), 'la barra inferior escribe la etiqueta');
check(lateral.includes('Agenda'),  'la barra lateral escribe la etiqueta');

console.log('\n4 · Una ruta que no está en la lista no marca nada');
const ninguna = AppNav.navHTML(ITEMS, '#/t/paciente/abc', 'lateral');
check(!ninguna.includes('aria-current="page"'),
  'en una ruta profunda no se marca ninguna sección');

console.log('\n5 · El texto de las etiquetas va escapado');
const peligroso = [{ href: '#/x', icono: 'home', label: '<img src=x onerror=1>' }];
check(!AppNav.navHTML(peligroso, '#/x', 'lateral').includes('<img'),
  'una etiqueta con HTML no se inyecta');

console.log('\n' + '─'.repeat(60));
console.log(`${pasan} pasan · ${fallan} fallan`);
process.exit(fallan ? 1 : 0);
