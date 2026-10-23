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
