const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const eventos = {}, consulta = { matches: false, addEventListener(_, f) { this.change = f; } };
const barra = clave => ({ nodeType: 1, dataset: { motionKey: clave }, isConnected: true,
  matches: selector => selector === '[data-motion-key]', querySelectorAll: () => [],
  fill: { addEventListener(_, f) { this.fin = f; }, removeEventListener() {} },
  querySelector() { return this.fill; } });
const original = barra('agenda:2026-10'), observadas = [];
let interseccion, mutacion;
const doc = { body: { nodeType: 1, matches: () => false, querySelectorAll: () => [original] },
  documentElement: { dataset: {} }, addEventListener: (nombre, fn) => { eventos[nombre] = fn; } };
const ventana = { matchMedia: () => consulta,
  IntersectionObserver: class { constructor(cb) { interseccion = cb; } observe(el) { observadas.push(el); } unobserve() {} },
  getComputedStyle: () => ({ transform: 'matrix(1, 0, 0, 1, -10, 0)', boxShadow: 'none' }) };
vm.runInNewContext(fs.readFileSync('js/motion-ui.js', 'utf8'), { window: ventana, document: doc,
  MutationObserver: class { constructor(cb) { mutacion = cb; } observe() {} } });
const ver = (el, visible) => interseccion([{ target: el, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 }]);
assert.equal(original.dataset.motionState, 'pending', 'espera a que el usuario llegue a la gráfica');
ver(original, false);
assert.equal(original.dataset.motionState, 'pending');
ver(original, true);
assert.equal(original.dataset.motionState, 'entering');
original.fill.fin({ animationName: 'meter-charge' });
assert.equal(original.dataset.motionState, 'ready');
ver(original, false); ver(original, true);
assert.equal(original.dataset.motionState, 'ready', 'subir y bajar no repite la carga');
const reabierta = barra('agenda:2026-10');
mutacion([{ addedNodes: [reabierta] }]); ver(reabierta, true);
assert.equal(reabierta.dataset.motionState, 'ready', 'reabrir el mismo periodo conserva el estado');
const nueva = barra('agenda:2026-11');
mutacion([{ addedNodes: [nueva] }]);
assert.equal(nueva.dataset.motionState, 'pending', 'otro periodo puede tener su propia introducción');
consulta.matches = true; consulta.change();
assert.equal(nueva.dataset.motionState, 'ready', 'respeta reducir movimiento');
let pulsaciones = 0;
const boton = { matches: () => false, animate: frames => { pulsaciones++; assert.ok(frames[0].transform.includes('matrix(1, 0, 0, 1, -10, 0)')); return { cancel() {} }; } };
const target = { closest: () => boton };
eventos.pointerdown({ type: 'pointerdown', button: 0, target });
assert.equal(pulsaciones, 0);
consulta.matches = false;
eventos.pointerdown({ type: 'pointerdown', button: 0, target });
assert.equal(pulsaciones, 1, 'botones tienen presión sin perder su posición');
eventos.keydown({ type: 'keydown', repeat: true, key: 'Enter', target });
assert.equal(pulsaciones, 1);
console.log('Movimiento: primera entrada, scroll sin repetición, periodo nuevo, presión y movimiento reducido correctos.');
