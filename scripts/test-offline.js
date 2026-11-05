const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { IDBFactory } = require('fake-indexeddb');
const { webcrypto } = require('node:crypto');

const source = fs.readFileSync('js/offline.js', 'utf8');
const recent = new Date().toISOString();
const old = new Date(Date.now() - 40 * 86400000).toISOString();
const account = id => ({ user: { id, email: `${id}@test.invalid` }, perfil: { id, nombre: id, rol: 'fisio' } });
const database = new IDBFactory();
const lockJobs = new Map();
const locks = { request(name, fn) {
  const job = (lockJobs.get(name) || Promise.resolve()).catch(()=>{}).then(fn);
  lockJobs.set(name,job.catch(()=>{})); return job;
} };
const server = { pacientes: [], notas: [], archivos: [], valoraciones: [] };
let failAfterInsert = false, downloads = 0;
function sb() {
  return {
    from(table) {
      let action = 'select', row, filters = [];
      const q = {
        select() { return q; }, eq(k,v) { filters.push(r => r[k] === v); return q; },
        insert(value) { action = 'insert'; row = structuredClone(value); return q; },
        update(value) { action = 'update'; row = value; return q; },
        maybeSingle() { return execute(); }, single() { return execute(); }
      };
      async function execute() {
        const rows = server[table] || [];
        if (action === 'insert') {
          if (rows.some(r => r.id === row.id)) return { error: { message: 'Duplicate' } };
          rows.push(row);
          if (failAfterInsert) { failAfterInsert = false; throw new Error('Failed to fetch'); }
          return { data: structuredClone(row) };
        }
        const match = rows.find(r => filters.every(fn => fn(r)));
        if (match && action === 'update') Object.assign(match, row);
        return { data: match ? structuredClone(match) : null };
      }
      return q;
    },
    async rpc(_, { nota_id, revision_esperada, cambios }) {
      const r = server.notas.find(n => n.id === nota_id);
      if (!r || r.revision !== revision_esperada) return { error: { message: 'Otro usuario modificó esta nota.' } };
      Object.assign(r, cambios, { revision: r.revision + 1 }); return { data: structuredClone(r) };
    },
    storage: { from() { return {
      async info() { return { data: { size: 1234 } }; },
      async createSignedUrl(path) { return { data: { signedUrl: `https://test.invalid/${path}` } }; },
      async upload() { return { data: {} }; }
    }; } }
  };
}
function app() {
  let listHook = null;
  const events = new EventTarget();
  const api = { sb: sb() };
  const patient = { id: 'patient', nombre: 'Ana', telefono: '123', creado_en: old };
  const files = [
    { id: 'recent', ruta: 'patient/recent.pdf', titulo: 'Reciente', mime: 'application/pdf', creado_en: recent, paciente_id: patient.id, url: 'https://test.invalid/recent' },
    { id: 'old', ruta: 'patient/old.pdf', titulo: 'Antiguo', mime: 'application/pdf', creado_en: old, paciente_id: patient.id, url: null }
  ];
  const appointments = [{ id: 'cita', paciente_id: patient.id, inicia_en: recent, estado: 'agendada' }];
  for (const name of ['listarSolicitudes','listarPromociones','listarSorteos','listarEjercicios','pacientesCumpleanos','asistenciasDePaciente','pagosDePaciente','rutinasDePaciente','historialValoraciones','historialNotas']) api[name] = async () => [];
  for (const name of ['crearPaciente','crearPacienteExpres','crearNota','cambiarFechaNota','guardarValoracion','subirArchivo','crearCita','actualizarCita','eliminarArchivo']) api[name] = async () => { throw new Error('Escritura original inesperada'); };
  api.getConfig = async () => ({ clinica: 'CLIDANFI' });
  api.opcionesValoracion = async () => ({});
  api.listarPacientes = async () => { if (listHook) await listHook(); return [patient]; }; api.obtenerPaciente = async () => patient;
  api.historialCitas = async () => appointments;
  api.citasDeHoy = api.proximasCitas = api.citasDePaciente = async () => appointments;
  api.proximaCitaDePaciente = api.rutinaActiva = async () => null;
  api.valoracionDePaciente = async id => structuredClone(server.valoraciones.filter(v=>v.paciente_id===id).at(-1) || null);
  api.notasDePaciente = async () => structuredClone(server.notas.filter(n=>n.paciente_id === patient.id));
  api.obtenerNota = async id => structuredClone(server.notas.find(n => n.id === id));
  api.archivosDePaciente = async () => files;
  api.enlaceDeArchivo = async id => files.find(f=>f.id === id);
  api.cumplimientoDePaciente = api.resumenDashboard = async () => ({});
  const ctx = { console, indexedDB: database, Blob, URL, Event, crypto: webcrypto,
    navigator: { onLine: true, locks }, UI: { toast() {} }, API: api, setInterval() {},
    fetch: async () => { downloads++; return { ok: true, blob: async () => new Blob(['pdf contents'], { type: 'application/pdf' }) }; },
    addEventListener: events.addEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events) };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(source, ctx);
  ctx.Offline.install(api);
  ctx.setListHook = hook => { listHook = hook; };
  return ctx;
}
const timeout=setTimeout(()=>{throw new Error('La prueba sin conexión quedó bloqueada.');},15000);
(async () => {
  let a = app(); await a.Offline.remember(account('fisio-a')); await a.Offline.prepare();
  let s = await a.Offline.status();
  assert.ok(s.last, s.error); assert.equal(s.files.length, 2); assert.equal(s.files.filter(f=>f.blob).length, 1);
  assert.equal(downloads, 1, 'solo última semana automática');
  await a.Offline.measureFiles();
  assert.equal((await a.Offline.status()).files.find(f=>f.id==='old').expected,1234);
  assert.equal(downloads,1,'consultar tamaños no descarga archivos');
  const lastConnection=await a.Offline.connectionInfo();
  assert.ok(lastConnection);
  a = app(); a.navigator.onLine = false; await a.Offline.remember(await a.Offline.cachedSession());
  assert.equal(await a.Offline.connectionInfo(),lastConnection,'la última conexión persiste al reabrir sin red');
  assert.equal((await a.API.listarPacientes({ q: 'ana' })).length, 1);
  assert.equal((await a.API.listarPacientes({ q: 'otro' })).length, 0);
  assert.equal((await a.API.citasDeHoy()).length, 1);
  assert.equal((await a.API.resumenDashboard()).citas_hoy_pendientes,1);
  assert.ok((await a.API.enlaceDeArchivo('recent')).url.startsWith('blob:'));
  assert.equal((await a.API.enlaceDeArchivo('old')).url, null);
  await assert.rejects(a.API.crearCita({}), /requiere internet/);
  const p = await a.API.crearPaciente({ nombre: 'Nuevo' });
  assert.equal((await a.API.obtenerPaciente(p.id)).nombre, 'Nuevo');
  assert.equal((await a.API.notasDePaciente(p.id)).length, 0);
  await assert.rejects(a.API.crearNota({ paciente_id: p.id, texto: 'nota', signos_vitales: { fc: -1 } }), /inválido/);
  const note = await a.API.crearNota({ paciente_id: p.id, texto: 'nota', eva: 2, signos_vitales: { fc: '80' } });
  assert.equal(a.API.editarNota, undefined);
  await a.API.cambiarFechaNota(note.id, old);
  assert.equal((await a.API.obtenerNota(note.id)).texto, 'nota');
  assert.equal((await a.API.obtenerNota(note.id)).fecha_nota, old);
  const file = new Blob(['pending'], { type: 'application/pdf' });
  const f = await a.API.subirArchivo(p.id, file, { titulo: 'Pendiente' });
  assert.ok((await a.API.enlaceDeArchivo(f.id)).url.startsWith('blob:'));
  const before = (await a.Offline.status()).pending.length;
  await a.Offline.removeFiles('2000-01-01','2100-01-01');
  assert.equal((await a.Offline.status()).fileBytes, 0);
  assert.equal((await a.Offline.status()).pending.length, before);
  a.navigator.onLine = true;
  await a.Offline.prepare();
  assert.equal(server.pacientes.length, 1); assert.equal(server.notas.length, 1); assert.equal(server.archivos.length, 1);
  assert.equal(server.notas[0].texto, 'nota');
  assert.equal(server.notas[0].fecha_nota, old);
  assert.equal((await a.Offline.status()).pending.length, 0);
  assert.equal((await a.Offline.status()).files.find(f=>f.id === 'recent').blob, null, 'respeta limpieza al preparar');
  await a.Offline.download((await a.Offline.status()).files.find(f=>f.id==='old'), true);
  assert.ok((await a.Offline.status()).files.find(f=>f.id==='old').blob);
  a.navigator.onLine = false;
  const lost = await a.API.crearNota({ paciente_id: 'patient', texto: 'respuesta perdida' });
  failAfterInsert = true; a.navigator.onLine = true;
  await a.Offline.sync(); assert.equal((await a.Offline.status()).pending.length, 1);
  await a.Offline.sync(); assert.equal((await a.Offline.status()).pending.length, 0);
  assert.equal(server.notas.filter(n=>n.id === lost.id).length, 1, 'reintento no duplica');
  // Cambiar la fecha de una nota existente no sobrescribe contenido ajeno.
  await a.API.obtenerNota(lost.id);
  a.navigator.onLine = false;
  await a.API.cambiarFechaNota(lost.id, old);
  server.notas.find(n=>n.id===lost.id).revision = 2;
  server.notas.find(n=>n.id===lost.id).texto = 'edición ajena';
  a.navigator.onLine = true;
  await a.Offline.sync();
  assert.equal((await a.Offline.status()).pending.length, 0);
  assert.equal(server.notas.find(n=>n.id===lost.id).texto, 'edición ajena');
  assert.equal(server.notas.find(n=>n.id===lost.id).fecha_nota,old);
  // Una respuesta antigua no debe ocultar el alta que acaba de sincronizarse.
  a.navigator.onLine=false;
  const concurrent=await a.API.crearPaciente({nombre:'Alta durante lectura'});
  let releaseList, listStarted;
  const listGate=new Promise(resolve=>{releaseList=resolve;});
  const started=new Promise(resolve=>{listStarted=resolve;});
  a.setListHook(()=>{listStarted();return listGate;});
  a.navigator.onLine=true;
  const staleList=a.API.listarPacientes();
  await started; await a.Offline.sync(); releaseList();
  assert.ok((await staleList).some(p=>p.id===concurrent.id));
  a.setListHook(null); a.navigator.onLine=false;
  assert.equal((await a.API.notasDePaciente(concurrent.id)).length,0);
  assert.equal((await a.API.archivosDePaciente(concurrent.id)).length,0);
  assert.equal(await a.API.valoracionDePaciente(concurrent.id),null);
  const valuation=await a.API.guardarValoracion(concurrent.id,{secciones_activas:['historia'],datos:{historia:{motivo:'Primera valoración'}}});
  a.navigator.onLine=true;await a.Offline.sync();
  await a.API.valoracionDePaciente(concurrent.id);
  a.navigator.onLine=false;
  await a.API.guardarValoracion(concurrent.id,{id:valuation.id,secciones_activas:['historia'],datos:{historia:{motivo:'Mi cambio local'}}});
  const remoteValuation=server.valoraciones.find(v=>v.id===valuation.id);
  remoteValuation.actualizado_en=new Date(Date.now()+1000).toISOString();
  remoteValuation.datos={historia:{motivo:'Cambio de otro dispositivo'}};
  a.navigator.onLine=true;await a.Offline.sync();
  const conflict=(await a.Offline.status()).pending.find(q=>q.table==='valoraciones');
  assert.match(conflict.error,/Conflicto de valoración/);
  await a.Offline.keepAsNew(conflict.key);
  assert.equal((await a.Offline.status()).pending.length,0);
  assert.equal(server.valoraciones.find(v=>v.id===valuation.id).datos.historia.motivo,'Cambio de otro dispositivo');
  assert.equal(server.valoraciones.filter(v=>v.datos.historia.motivo==='Mi cambio local').length,1);
  // Un cambio de rol no expone las copias del antiguo rol.
  await a.Offline.remember({ ...account('fisio-a'), perfil: { id:'fisio-a', rol:'paciente', nombre:'Paciente' } });
  assert.equal((await a.Offline.status()).files.length,0);
  await a.Offline.remember(account('fisio-b'));
  assert.equal((await a.Offline.status()).files.length, 0);
  a.navigator.onLine = false;
  await assert.rejects(a.API.obtenerPaciente('patient'), /todavía no/);
  await a.Offline.remember(null); assert.equal(await a.Offline.cachedSession(), null);
  const bannerContext={UI:{},window:{addEventListener(){}},document:{addEventListener(){}}};
  vm.createContext(bannerContext);
  vm.runInContext(fs.readFileSync('js/offline-profile.js','utf8').replace('global.OfflineProfile = { show };','global.OfflineProfile = { show, connectionDate };'),bannerContext);
  const format=bannerContext.window.OfflineProfile.connectionDate;
  const wednesday=new Date(2026,10,4,18,0);
  assert.equal(format(new Date(2026,10,4,17,5),wednesday),'Hoy - 17:05');
  assert.equal(format(new Date(2026,10,3,17,5),wednesday),'Ayer - 17:05');
  assert.equal(format(new Date(2026,10,2,17,5),wednesday),'lunes - 17:05');
  assert.equal(format(new Date(2026,10,1,17,5),new Date(2026,10,2,18,0)),'Ayer - 17:05');
  assert.equal(format(new Date(2026,9,31,17,5),new Date(2026,10,1,18,0)),'Ayer - 17:05');
  assert.equal(format(new Date(2026,10,1,9,0),wednesday),'01/11/2026 - 09:00');
  assert.equal(format(null,wednesday),'sin registro');
  console.log('Offline: reinicio, agenda, búsqueda, semana automática, limpieza local, cola protegida, adjuntos, sincronización idempotente y aislamiento por usuario correctos.');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(()=>clearTimeout(timeout));
