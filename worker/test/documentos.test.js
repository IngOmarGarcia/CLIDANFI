import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { prepararDocumento, adjuntosDocumento, tiposDocumento } from '../src/documentos.js';
import { respaldarDocumentos, nombreRespaldo, retirarRespaldosCitas } from '../src/drive.js';
import { generarValoracionPdf } from '../src/valoracion-pdf.js';

const base = { id: '11111111-1111-4111-8111-111111111111', documento_id: 'nota',
  paciente_id: 'paciente', paciente_nombre: 'Omar García', bloqueo: 'lease', numero: 1,
  creado_en: '2026-10-20T02:00:00Z' };
const nota = { ...base, origen: 'notas', contenido: { texto: 'Evolución ficticia', eva: 0,
  adjuntos: [{ ruta: 'paciente/evidencia.jpg', titulo: 'Prueba', url: 'https://no-solicitar.test/secreto' }] } };

test('el respaldo conserva fecha de atención y signos vitales de la nota', async () => {
  const signos = { ta: '120/80', tem: 36.5, fc: 72, fr: 18 };
  const doc = prepararDocumento({ ...nota, contenido: { ...nota.contenido,
    fecha_nota: '2026-09-15T16:30:00Z', signos_vitales: signos } });
  assert.equal(doc.contenido.datos.evolucion.fecha_nota, '2026-09-15T16:30:00Z');
  assert.deepEqual(doc.contenido.datos.evolucion.signos_vitales, signos);
  assert.equal((await PDFDocument.load(await generarValoracionPdf(doc))).getPageCount(), 1);
});

test('las citas se excluyen de las subidas y solo se retiran sus copias', async () => {
  const cambios = [], peticiones = [];
  const db = { borrar: async (...args) => cambios.push(args),
    select: async () => [{ id: 'version-cita', drive_archivo_id: 'pdf-cita' }],
    rpc: async () => [{ ...base, origen: 'citas' }] };
  const red = { fetch: async (url, opts) => {
    peticiones.push({ url, opts });
    assert.equal(opts.method, 'PATCH');
    assert.deepEqual(JSON.parse(opts.body), { trashed: true });
    return Response.json({ id: 'pdf-cita' });
  } };
  assert.deepEqual(await retirarRespaldosCitas(db, {}, red), { retiradas: 1, fallidas: 0, pendientes: 0 });
  assert.deepEqual(await respaldarDocumentos(db, {}, {}, red), { guardados: 0, fallidos: 0 });
  assert.equal(peticiones.length, 1);
  assert.ok(cambios.every(([tabla, filtro]) => tabla === 'documentos_versiones' && filtro.includes('origen=eq.citas')));
  assert.equal(cambios[0][1], 'origen=eq.citas&drive_archivo_id=is.null');
});

test('todos los documentos empiezan por su tipo y conservan el contenido clínico', async () => {
  for (const origen of Object.keys(tiposDocumento).filter(t => t !== 'archivos')) {
    const version = { ...nota, origen, contenido: { ...nota.contenido,
      ejercicios: [{ ejercicio: { nombre: 'Flexión', descripcion: 'Instrucción' }, series: 3, reps: 10 }] } };
    const documento = prepararDocumento(version);
    assert.ok(nombreRespaldo(version).startsWith((origen === 'notas' ? 'Evol.' : tiposDocumento[origen]) + ' Omar García'));
    const pdf = await PDFDocument.load(await generarValoracionPdf(documento));
    assert.equal(pdf.getPageCount(), 1);
    assert.match(pdf.getTitle(), /Omar García/);
  }
  assert.equal(prepararDocumento(nota).contenido.datos.evolucion.eva, 0);
  assert.ok(!JSON.stringify(prepararDocumento(nota)).includes('no-solicitar'));
  assert.equal(nombreRespaldo({ ...nota, numero: 2 }), 'Evol. Omar García - Actualizado - 19-10-26 20-00-00.pdf');
  const archivo = { ...base, origen: 'archivos', contenido: { categoria: 'Estudio', titulo: 'Rodilla', ruta: 'paciente/radiografia.heic' } };
  assert.match(nombreRespaldo(archivo, adjuntosDocumento(archivo)[0]), /^Estudio Omar García - Rodilla .*\.heic$/);
});

test('reintenta solo los adjuntos faltantes, copia bytes originales y no consume URLs externas', async () => {
  const original = globalThis.fetch;
  const archivos = new Map();
  const cambios = [];
  let fallo = true, subidas = 0, descargas = 0;
  const db = { rpc: async () => [nota], update: async (...args) => cambios.push(args) };
  try {
    globalThis.fetch = async (url, options = {}) => {
      url = String(url);
      if (url.includes('/drive/v3/files?') && !url.includes('/upload/')) {
        const q = new URL(url).searchParams.get('q');
        const clave = q.match(/value='([^']+)'/)[1];
        if (q.includes('clidanfi_lote')) return Response.json({ files: [...archivos]
          .filter(([k]) => k.startsWith(clave + ':'))
          .map(([k, id]) => ({ id, appProperties: { clidanfi_documento: k } })) });
        return Response.json({ files: archivos.has(clave) ? [{ id: archivos.get(clave) }] : [] });
      }
      if (url.includes('/storage/v1/')) {
        descargas++;
        assert.ok(url.endsWith('/evidencias/paciente/evidencia.jpg'));
        assert.equal(options.headers.apikey, 'service');
        return fallo ? new Response('', { status: 503 }) : new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } });
      }
      if (url.includes('/upload/')) {
        const body = await options.body.text();
        const metadata = JSON.parse(body.split('\r\n\r\n')[1].split('\r\n')[0]);
        assert.ok(metadata.name.startsWith(metadata.mimeType === 'image/jpeg' ? 'Evid. Omar García' : 'Evol. Omar García'));
        if (metadata.mimeType === 'image/jpeg') assert.ok(body.includes('\u0001\u0002\u0003'));
        else assert.ok(body.includes('%PDF-'));
        const id = `drive-${++subidas}`;
        archivos.set(metadata.appProperties.clidanfi_documento, id);
        return Response.json({ id });
      }
      throw new Error('Solicitud inesperada: ' + url);
    };
    const env = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' };
    assert.deepEqual(await respaldarDocumentos(db, {}, env), { guardados: 0, fallidos: 1 });
    assert.match(cambios[0][2].ultimo_error, /503/);
    assert.equal(cambios[0][2].drive_archivo_id, undefined);
    fallo = false;
    assert.deepEqual(await respaldarDocumentos(db, {}, env), { guardados: 1, fallidos: 0 });
    assert.equal(subidas, 2); // Un PDF y una imagen; el PDF no se vuelve a subir.
    assert.equal(descargas, 2);
    assert.equal(cambios[1][2].drive_archivo_id, 'drive-1');
    assert.match(cambios[1][1], /bloqueo=eq.lease/);
    assert.deepEqual(await respaldarDocumentos(db, {}, env), { guardados: 1, fallidos: 0 });
    assert.equal(subidas, 2);
    assert.equal(descargas, 2);
  } finally { globalThis.fetch = original; }
});

test('un archivo de otro paciente no se solicita ni se marca como respaldado', async () => {
  const original = globalThis.fetch;
  let cambio;
  try {
    globalThis.fetch = async url => {
      assert.ok(String(url).includes('/drive/v3/files?'));
      return Response.json({ files: [] });
    };
    const db = { rpc: async () => [{ ...nota, origen: 'archivos', contenido: { ruta: 'otro/archivo.pdf' } }],
      update: async (tabla, filtro, valores) => { cambio = valores; } };
    assert.deepEqual(await respaldarDocumentos(db, {}, {}), { guardados: 0, fallidos: 1 });
    assert.match(cambio.ultimo_error, /Ruta de adjunto/);
    assert.equal(cambio.drive_archivo_id, undefined);
  } finally { globalThis.fetch = original; }
});

test('respaldos con muchas fotos avanzan entre tandas sin agotar las subpeticiones', async () => {
  const original = globalThis.fetch;
  const archivos = new Map();
  const pendientes = [{ ...nota, contenido: { ...nota.contenido,
    adjuntos: Array.from({ length: 40 }, (_, i) => ({ ruta: `paciente/${i}.jpg`, titulo: `Prueba ${i}` })) } },
    ...Array.from({ length: 9 }, (_, i) => ({ ...base, id: `ficha-${i}`, origen: 'pacientes', contenido: { nombre: 'Prueba' } }))];
  let red, subidas = 0, completadas = 0;
  const db = { rpc: async () => { red.usadas++; return pendientes.filter(v => !v.guardada); },
    update: async (tabla, filtro, valores) => {
      red.usadas++;
      assert.equal(valores.ultimo_error, undefined === valores.drive_archivo_id ? undefined : null);
      if (valores.drive_archivo_id) {
        pendientes.find(v => filtro.startsWith(`id=eq.${v.id}&`)).guardada = true;
        completadas++;
      } else assert.ok(valores.reintentar_en);
    } };
  try {
    globalThis.fetch = async (url, opts = {}) => {
      url = String(url);
      if (url.includes('/upload/')) {
        const body = await opts.body.text();
        const metadata = JSON.parse(body.split('\r\n\r\n')[1].split('\r\n')[0]);
        const id = `drive-${++subidas}`;
        archivos.set(metadata.appProperties.clidanfi_documento, { id, appProperties: metadata.appProperties });
        return Response.json({ id });
      }
      if (url.includes('/drive/v3/files?')) {
        const q = new URL(url).searchParams.get('q');
        const clave = q.match(/value='([^']+)'/)[1];
        return Response.json({ files: q.includes('clidanfi_lote')
          ? [...archivos.values()].filter(a => a.appProperties.clidanfi_lote === clave)
          : archivos.has(clave) ? [archivos.get(clave)] : [] });
      }
      if (url.includes('/storage/v1/')) return new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/jpeg' } });
      throw new Error('Petición inesperada');
    };
    for (let intento = 0; intento < 12 && completadas < 10; intento++) {
      red = { usadas: 0, fetch: (...args) => { red.usadas++; return fetch(...args); } };
      const resultado = await respaldarDocumentos(db, {}, { SUPABASE_URL: 'https://test.supabase.co' }, red);
      assert.equal(resultado.fallidos, 0);
      assert.ok(red.usadas <= 44, `Subpeticiones: ${red.usadas}`);
    }
    assert.equal(completadas, 10);
    assert.equal(subidas, 50); // 40 fotos + 10 PDFs; ningún duplicado entre tandas.
  } finally { globalThis.fetch = original; }
});
