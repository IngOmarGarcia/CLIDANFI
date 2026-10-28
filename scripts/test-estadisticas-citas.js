const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const c = { window: {}, Date, Intl };
vm.createContext(c);
vm.runInContext(fs.readFileSync('js/estadisticas-citas.js', 'utf8'), c);
const e = c.window.EstadisticasCitas;
const citas = [
  { estado: 'completada', inicia_en: '2026-10-01T15:00:00Z', paciente_id: 'p1', paciente_nombre: 'Ana' },
  { estado: 'completada', inicia_en: '2026-10-03T15:00:00Z', paciente_id: 'p1', paciente_nombre: 'Ana' },
  { estado: 'completada', inicia_en: '2026-10-05T15:00:00Z', paciente_id: 'p2', paciente_nombre: 'Luis' },
  { estado: 'cancelada', inicia_en: '2026-10-01T15:00:00Z', paciente_id: 'p3', paciente_nombre: 'Excluir' },
  { estado: 'no_asistio', inicia_en: '2026-10-01T15:00:00Z', paciente_id: 'p3' },
  { estado: 'agendada', inicia_en: '2026-10-01T15:00:00Z', paciente_id: 'p3' },
  { estado: 'completada', inicia_en: '2026-10-01T04:08:00Z', paciente_id: 'p4', paciente_nombre: 'Septiembre' }
];
const semanas = e.agrupar(citas, 'semana', '2026-10');
assert.equal(semanas[0].total, 2);
assert.equal(semanas[0].desde, '2026-10-01');
assert.equal(semanas[0].hasta, '2026-10-04');
assert.equal(semanas[1].total, 1);
const pacientes = e.pacientes(semanas[0].citas);
assert.equal(pacientes.length, 1);
assert.equal(pacientes[0].nombre, 'Ana');
assert.equal(pacientes[0].total, 2);
assert.equal(e.agrupar(citas, 'mes', '2026-10').find(g => g.clave === '2026-09').total, 1);
assert.equal(e.agrupar(citas, 'ano', '2026-10')[0].total, 4);
console.log('Estadísticas: solo completadas, semanas parciales, pacientes únicos y zona de la clínica.');
