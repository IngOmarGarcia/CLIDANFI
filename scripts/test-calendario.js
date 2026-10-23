const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const isoDay = v => { const d = new Date(v); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const citas = [
  { inicia_en: '2026-10-01T09:00:00', estado: 'completada', paciente_nombre: 'Uno' },
  { inicia_en: '2026-10-31T09:00:00', estado: 'cancelada', paciente_nombre: 'Dos' },
  { inicia_en: '2026-09-30T09:00:00', estado: 'agendada', paciente_nombre: 'Tres' }
];
const context = { window: {}, UI: { isoDay, escapeHtml: String, fmtTime: () => '09:00', fmtDate: String, icon: () => '', emptyState: () => 'Sin citas' }, API: { historialCitas: async () => citas }, location: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/views-therapist.js', 'utf8'), context);
(async () => {
  const vista = await context.window.VistaFisio.agenda({}, { m: '2026-10', d: '2026-10-02' });
  assert.equal((vista.html.match(/class="agenda-cell /g) || []).length, 42);
  assert(vista.html.includes('agenda-cancelada'));
  const escala = { value: 'mes', selectedOptions: [{ text: 'Mes' }], addEventListener(_, cb) { this.change = cb; } };
  const grafica = { innerHTML: '' };
  const elements = { '#agenda-mes': { addEventListener() {} }, '#agenda-agregar': null, '#agenda-escala': escala, '#agenda-grafica': grafica };
  vista.onMount({ querySelector: id => elements[id] });
  assert(grafica.innerHTML.includes('3 citas en el periodo'));
  for (const tipo of ['dia', 'semana']) {
    escala.value = tipo; escala.change();
    assert(grafica.innerHTML.includes('2 citas en el periodo'), tipo);
  }
  escala.value = 'ano'; escala.change();
  assert(grafica.innerHTML.includes('3 citas en el periodo'));
  const pasado = await context.window.VistaFisio.agenda({}, { m: '2020-01', d: '2020-01-01' });
  assert(!pasado.html.includes('id="agenda-agregar"'));
  const futuro = await context.window.VistaFisio.agenda({}, { m: '2099-01', d: '2099-01-01' });
  assert(futuro.html.includes('id="agenda-agregar"'));
  console.log('Calendario: 42 días, estados, conteos por año/mes/semana/día y fechas futuras correctos.');
})().catch(e => { console.error(e); process.exitCode = 1; });
