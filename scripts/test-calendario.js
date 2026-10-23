const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const isoDay = v => { const d = new Date(v); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const citas = [
  { inicia_en: '2026-10-01T09:00:00', estado: 'completada', paciente_nombre: 'Uno' },
  { inicia_en: '2026-10-31T09:00:00', estado: 'cancelada', paciente_nombre: 'Dos' },
  { inicia_en: '2026-09-30T09:00:00', estado: 'agendada', paciente_nombre: 'Tres' }
];
let sheetAbierta;
const context = { window: {}, UI: { isoDay, escapeHtml: String, fmtTime: () => '09:00', fmtDate: String, badge: (_, tono) => tono, openSheet: sheet => { sheetAbierta = sheet; }, icon: () => '', emptyState: () => 'Sin citas' }, API: { historialCitas: async () => citas, pacientesCumpleanos: async () => [{ id: 'p1', nombre: 'Cumpleañera', fecha_nacimiento: '2000-10-01' }] }, location: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/calendar-events.js', 'utf8'), context);
context.CalendarioEventos = context.window.CalendarioEventos;
vm.runInContext(fs.readFileSync('js/views-therapist.js', 'utf8'), context);
(async () => {
  const vista = await context.window.VistaFisio.agenda({}, { m: '2026-10', d: '2026-10-02' });
  assert.equal((vista.html.match(/class="agenda-cell /g) || []).length, 42);
  assert(vista.html.includes('agenda-marker-appointment'));
  const escala = { value: 'mes', selectedOptions: [{ text: 'Mes' }], addEventListener(_, cb) { this.change = cb; } };
  const grafica = { innerHTML: '' };
  const elements = { '#agenda-mes': { addEventListener() {} }, '#agenda-agregar': null, '#agenda-escala': escala, '#agenda-grafica': grafica };
  const celda = { dataset: { agendaDia: '2026-10-01' }, classList: { toggle() {} }, addEventListener(_, cb) { this.click = cb; } };
  vista.onMount({ querySelector: id => elements[id], querySelectorAll: () => [celda] });
  celda.click({ preventDefault() {} });
  assert(sheetAbierta.title.includes('octubre'));
  assert(sheetAbierta.body.includes('Uno'));
  assert(sheetAbierta.body.includes('Ver cita y acciones'));
  assert(sheetAbierta.body.includes('Cumpleañera'));
  assert(vista.html.includes('agenda-marker-birthday'));
  assert(grafica.innerHTML.includes('3 citas en el periodo'));
  assert(grafica.innerHTML.includes('octubre 2026'));
  for (const tipo of ['dia', 'semana']) {
    escala.value = tipo; escala.change();
    assert(grafica.innerHTML.includes('2 citas en el periodo'), tipo);
    assert(grafica.innerHTML.includes(tipo === 'dia' ? '01 octubre' : '01–04 octubre'));
  }
  escala.value = 'ano'; escala.change();
  assert(grafica.innerHTML.includes('3 citas en el periodo'));
  const pasado = await context.window.VistaFisio.agenda({}, { m: '2020-01', d: '2020-01-01' });
  assert(!pasado.html.includes('id="agenda-agregar"'));
  const futuro = await context.window.VistaFisio.agenda({}, { m: '2099-01', d: '2099-01-01' });
  assert(futuro.html.includes('id="agenda-agregar"'));
  assert(futuro.html.includes('Año Nuevo'));
  const cumple = await context.window.VistaFisio.agenda({}, { f: 'cumpleanos', m: '2026-10' });
  assert(cumple.html.includes('Cumpleañera'));
  assert(cumple.html.includes('26 años'));
  console.log('Calendario: 42 días, estados, conteos por año/mes/semana/día y fechas futuras correctos.');
})().catch(e => { console.error(e); process.exitCode = 1; });
