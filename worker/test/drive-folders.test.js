import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carpetaPaciente, ubicarArchivo, organizarRespaldos } from '../src/drive-folders.js';

const paciente = { paciente_id: 'p1', paciente_nombre: "Ana O'Pérez" };
const db = { select: async (_tabla, filtro) => filtro.startsWith('id=') ? [{ nombre: paciente.paciente_nombre }] : [{ id: 'p1' }] };

function redCarpetas({ vinculadas = [], nombres = [], fallo = false } = {}) {
  const peticiones = [];
  const red = { usadas: 0, peticiones, fetch: async (url, options = {}) => {
    red.usadas++;
    const u = new URL(url), q = u.searchParams.get('q') || '';
    peticiones.push({ url: u, options });
    if (fallo) return new Response('', { status: 403 });
    if (q) return Response.json({ files: q.includes('clidanfi_paciente') ? vinculadas : nombres });
    return Response.json({ id: options.method === 'POST' ? 'nueva' : u.pathname.split('/').pop() });
  } };
  return red;
}

test('reutiliza carpeta existente por nombre, la vincula al paciente y conserva sus metadatos', async () => {
  const red = redCarpetas({ nombres: [{ id: 'existente', appProperties: { otra: 'conservar' } }] });
  assert.equal(await carpetaPaciente(paciente, db, {}, {}, red), 'existente');
  assert.equal(red.peticiones.filter(p => p.options.method === 'POST').length, 0);
  const patch = red.peticiones.find(p => p.options.method === 'PATCH');
  assert.deepEqual(JSON.parse(patch.options.body), { appProperties: { otra: 'conservar', clidanfi_paciente: 'p1' } });
  assert.match(red.peticiones[1].url.searchParams.get('q'), /O\\'Pérez/);
  const usadas = red.usadas;
  assert.equal(await carpetaPaciente(paciente, db, {}, {}, red), 'existente');
  assert.equal(red.usadas, usadas, 'reutiliza caché para PDFs y adjuntos del mismo paciente');
});

test('una carpeta vinculada sigue siendo la misma aunque cambie el nombre del paciente', async () => {
  const red = redCarpetas({ vinculadas: [{ id: 'estable' }] });
  assert.equal(await carpetaPaciente({ ...paciente, paciente_nombre: 'Nombre actualizado' }, db, {}, {}, red), 'estable');
  assert.equal(red.peticiones.length, 1);
});

test('crea una carpeta con nombre del paciente dentro de la raíz configurada', async () => {
  const red = redCarpetas();
  assert.equal(await carpetaPaciente(paciente, db, {}, { GOOGLE_DRIVE_FOLDER_ID: 'clinica' }, red), 'nueva');
  const body = JSON.parse(red.peticiones.find(p => p.options.method === 'POST').options.body);
  assert.equal(body.name, paciente.paciente_nombre);
  assert.deepEqual(body.parents, ['clinica']);
  assert.deepEqual(body.appProperties, { clidanfi_paciente: 'p1' });
  assert.equal(body.permissions, undefined);
});

test('nombres repetidos, carpetas de otro paciente o errores de acceso no mezclan expedientes', async () => {
  for (const [red, fuente] of [
    [redCarpetas({ nombres: [{ id: 'a' }, { id: 'b' }] }), db],
    [redCarpetas({ nombres: [{ id: 'a', appProperties: { clidanfi_paciente: 'otro' } }] }), db],
    [redCarpetas({ nombres: [{ id: 'a' }] }), { select: async () => [{ id: 'p1' }, { id: 'p2' }] }],
    [redCarpetas({ fallo: true }), db]
  ]) {
    await assert.rejects(() => carpetaPaciente(paciente, fuente, {}, {}, red));
    assert.ok(!red.peticiones.some(p => p.options.method === 'POST' || p.options.method === 'PATCH'));
  }
});

test('mueve el mismo archivo, conserva propiedades y enlaces y evita repetir movimientos', async () => {
  const red = redCarpetas();
  const archivo = { id: 'pdf-original', parents: ['raiz'], appProperties: { clidanfi_version: 'v1' } };
  await ubicarArchivo(archivo, 'carpeta-p1', paciente, {}, red);
  const cambio = red.peticiones[0];
  assert.ok(cambio.url.pathname.endsWith('/pdf-original'));
  assert.equal(cambio.url.searchParams.get('addParents'), 'carpeta-p1');
  assert.equal(cambio.url.searchParams.get('removeParents'), 'raiz');
  assert.deepEqual(JSON.parse(cambio.options.body).appProperties, {
    clidanfi_version: 'v1', clidanfi_paciente: 'p1', clidanfi_carpeta: '1'
  });
  await ubicarArchivo({ ...archivo, parents: ['carpeta-p1'], appProperties: {
    clidanfi_paciente: 'p1', clidanfi_carpeta: '1'
  } }, 'carpeta-p1', paciente, {}, red);
  assert.equal(red.peticiones.length, 1);
});

test('organiza respaldos antiguos por metadatos sin adivinar pacientes a partir del nombre del archivo', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const movimientos = [];
  const red = { usadas: 0, fetch: async (url, options = {}) => {
    red.usadas++;
    const q = new URL(url).searchParams.get('q') || '';
    if (q.includes("mimeType !=")) return Response.json({ files: [
      { id: 'historia', parents: ['root'], appProperties: { clidanfi_version: id } },
      { id: 'evidencia', parents: ['root'], appProperties: { clidanfi_documento: `${id}:adjunto-0` } }
    ] });
    if (q.includes('clidanfi_paciente')) return Response.json({ files: [{ id: 'carpeta-p1' }] });
    movimientos.push(new URL(url).pathname.split('/').pop());
    return Response.json({ id: movimientos.at(-1) });
  } };
  const fuente = { select: async () => [{ ...paciente, origen: 'notas' }] };
  assert.deepEqual(await organizarRespaldos(fuente, {}, {}, red), { organizados: 2, fallidos: 0 });
  assert.deepEqual(movimientos, ['historia', 'evidencia']);
  assert.ok(red.usadas < 14);
});
