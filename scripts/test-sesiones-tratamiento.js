const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
for (const zona of ['America/Mexico_City', 'America/Mazatlan', 'UTC']) {
  process.env.TZ = zona;
  const contexto = { window: {}, Date };
  vm.createContext(contexto);
  vm.runInContext(fs.readFileSync('js/store.js', 'utf8'), contexto);
  const contar = (dias, hoy = '2026-10-27T22:08:00') => contexto.window.Store.sesionesTratamiento(
    dias.map(d => ({ asistio_en: d.includes('T') ? d : `${d}T10:00:00` })), new Date(hoy));
  assert.equal(contar([]).numero, 0);
  assert.equal(contar(['2026-10-02', '2026-10-07', '2026-10-12', '2026-10-17', '2026-10-22', '2026-10-27']).numero, 6);
  assert.equal(contar(['2026-10-27', '2026-10-02', '2026-10-07']).numero, 3, 'no depende del orden del historial');
  assert.equal(contar(['2026-09-28']).numero, 1, '29 días conservan el conteo');
  assert.equal(contar(['2026-09-27']).numero, 0, '30 días reinician el conteo');
  assert.equal(contar(['2026-09-27']).reiniciado, true);
  assert.equal(contar(['2026-08-01', '2026-08-10', '2026-10-20', '2026-10-27']).numero, 2);
  assert.equal(contar(['2026-09-27', '2026-10-27']).numero, 1, 'volver después de 30 días inicia en uno');
  assert.equal(contar(['2026-10-27', '2026-10-28', 'inválida']).numero, 1, 'no cuenta fechas futuras o inválidas');
  assert.equal(contar(['2026-09-27T23:59:00'], '2026-10-27T00:01:00').numero, 0, 'usa días civiles');
  console.log(`Conteo de sesiones correcto: ${zona}`);
}

(async () => {
  const contexto = { window: {}, Date, Intl };
  vm.createContext(contexto);
  vm.runInContext(fs.readFileSync('js/estadisticas-citas.js', 'utf8'), contexto);
  contexto.EstadisticasCitas = contexto.window.EstadisticasCitas;
  for (const archivo of ['ui', 'store']) {
    vm.runInContext(fs.readFileSync(`js/${archivo}.js`, 'utf8'), contexto);
    contexto[archivo === 'ui' ? 'UI' : 'Store'] = contexto.window[archivo === 'ui' ? 'UI' : 'Store'];
  }
  const p = { id: 'prueba', nombre: 'Paciente de prueba', paquete_total: 0, paquete_usadas: 0, paquete_restantes: 0 };
  const asistencias = Array.from({ length: 6 }, (_, i) => ({ asistio_en: new Date(Date.now() - i * 86400000).toISOString() }));
  contexto.API = { obtenerPaciente: async () => p, asistenciasDePaciente: async () => asistencias,
    pagosDePaciente: async () => [], citasDePaciente: async () => [
      { estado: 'completada', inicia_en: new Date().toISOString() },
      { estado: 'cancelada', inicia_en: new Date().toISOString() }
    ],
    cumplimientoDePaciente: async () => ({ faltas: 0, canceladas: 0 }) };
  vm.runInContext(fs.readFileSync('js/views-therapist.js', 'utf8'), contexto);
  const ficha = () => contexto.window.VistaFisio.paciente({ id: p.id }, {});
  const primera = await ficha();
  assert(primera.html.includes('Sesión #6'));
  assert(primera.html.includes('Última sesión:') && !primera.html.includes('Última sesión: Sin sesiones'));
  const grafica = { innerHTML: '' };
  const escala = { value: 'mes', addEventListener() {} };
  const periodo = { value: String(new Date().getFullYear()), addEventListener() {} };
  primera.onMount({ querySelector: id => ({ '#paciente-grafica': grafica, '#paciente-escala': escala, '#paciente-periodo': periodo })[id] });
  assert(grafica.innerHTML.includes('1 cita completada'));
  Object.assign(p, { paquete_total: 10, paquete_usadas: 4, paquete_restantes: 6 });
  let vista = await ficha();
  assert(vista.html.includes('6 restantes'));
  assert(!vista.html.includes('Sesión #6'));
  p.paquete_vence = '2000-01-01T12:00:00Z';
  assert((await ficha()).html.includes('Sesión #6'), 'un paquete vencido muestra el conteo');
  Object.assign(p, { paquete_vence: null, paquete_usadas: 10, paquete_restantes: 0 });
  assert((await ficha()).html.includes('Sesión #6'), 'un paquete agotado muestra el conteo');
  console.log('Ficha: conteo sin paquete, vencido o agotado; saldo con paquete activo.');
})().catch(error => { console.error(error); process.exitCode = 1; });
