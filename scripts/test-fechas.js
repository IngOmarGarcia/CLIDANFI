const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const codigo = fs.readFileSync('js/ui.js', 'utf8');
for (const zona of ['America/Mexico_City', 'America/Mazatlan', 'UTC']) {
  process.env.TZ = zona;
  const context = { window: {}, Date, Intl };
  vm.createContext(context);
  vm.runInContext(codigo, context);
  const ui = context.window.UI;
  const hoy = ui.isoDay(new Date());
  assert.equal(ui.isoDay(hoy), hoy, zona);
  assert.equal(ui.relDay(hoy), 'Hoy', zona);
  assert.equal(ui.relDay(ui.isoDay(ui.addDays(hoy, -1))), 'Ayer', zona);
  assert.equal(ui.relDay(ui.isoDay(ui.addDays(hoy, 1))), 'Mañana', zona);
  assert.equal(ui.fmtDate('2026-10-23'), '23 Oct 2026', zona);
  assert.equal(ui.isoDay('2026-01-01'), '2026-01-01', zona);
  const cita = new Date('2026-10-23T09:00:00');
  const original = cita.getTime();
  assert.equal(ui.isoDay(cita.toISOString()), '2026-10-23', zona);
  assert.equal(ui.toLocalInput(cita.toISOString()), '2026-10-23T09:00', zona);
  ui.addDays(cita, -1);
  assert.equal(cita.getTime(), original, 'El recordatorio no debe mutar la cita');
  const desde = new Date('2026-10-23T00:00:00').toISOString();
  const hasta = new Date('2026-10-23T23:59:59.999').toISOString();
  assert(cita.toISOString() >= desde && cita.toISOString() <= hasta);
  console.log(`Fechas correctas: ${zona}`);
}

// Cita nocturna: en UTC ya es el día siguiente, pero el encabezado de la
// agenda debe conservar el día local al convertir timestamp → YYYY-MM-DD.
process.env.TZ = 'America/Mexico_City';
const DateReal = Date;
class RelojCita extends DateReal {
  constructor(...args) { super(...(args.length ? args : ['2026-10-28T04:08:00Z'])); }
  static now() { return new DateReal('2026-10-28T04:08:00Z').getTime(); }
}
const nocturno = { window: {}, Date: RelojCita, Intl };
vm.createContext(nocturno);
vm.runInContext(codigo, nocturno);
const ui = nocturno.window.UI;
const guardada = new RelojCita('2026-10-27T22:08').toISOString();
assert.equal(guardada, '2026-10-28T04:08:00.000Z');
const diaAgenda = ui.isoDay(guardada);
assert.equal(diaAgenda, '2026-10-27');
assert.equal(ui.relDay(diaAgenda), 'Hoy');
assert.equal(ui.fmtDate(diaAgenda), '27 Oct 2026');
assert.equal(ui.toLocalInput(guardada), '2026-10-27T22:08');
console.log('Cita a las 10:08 p. m.: conserva fecha local y encabezado Hoy.');
