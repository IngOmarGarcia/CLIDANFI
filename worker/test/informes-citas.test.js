import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { periodosInformes, generarInformeCitas, respaldarInformesCitas } from '../src/informes-citas.js';

test('informes: meses y años cerrados, con límites de Ciudad de México', async () => {
  const periodos = periodosInformes([
    { inicia_en: '2026-01-01T04:08:00Z' }, // 31 de diciembre, 22:08.
    { inicia_en: '2025-12-01T16:00:00Z' }
  ], new Date('2026-01-05T16:00:00Z'));
  assert.equal(periodos.length, 2);
  const mensual = periodos.find(p => p.tipo === 'mensual'), anual = periodos.find(p => p.tipo === 'anual');
  assert.equal(mensual.desde, '2025-12-01');
  assert.equal(mensual.hasta, '2025-12-31');
  assert.equal(mensual.total, 2);
  assert.equal(mensual.filas.at(-1).total, 1);
  assert.ok(!periodos.some(p => p.tipo === 'semanal'));
  assert.equal(anual.desde, '2025-01-01');
  assert.equal(anual.total, 2);
  assert.equal(anual.filas[11].total, 2);
  assert.ok(!periodos.some(p => p.desde === '2026-01-05' || p.desde === '2026-01-01'));
  for (const p of periodos) {
    const pdf = await PDFDocument.load(await generarInformeCitas(p));
    assert.equal(pdf.getPageCount(), 1);
    assert.ok(pdf.getTitle().includes(p.tipo));
  }
});

test('Drive: un PDF por periodo, reintento sin duplicar y corrección en el mismo archivo', async () => {
  let fechas = ['2025-12-31T16:00:00Z', '2025-12-01T16:00:00Z'];
  const archivos = new Map(), subidas = [];
  const db = { select: async (tabla, query) => {
    assert.equal(tabla, 'citas');
    assert.ok(query.includes('select=inicia_en&estado=eq.completada'));
    assert.ok(!query.includes('paciente'));
    return fechas.map(inicia_en => ({ inicia_en }));
  } };
  const red = { usadas: 0, fetch: async (url, options = {}) => {
    red.usadas++;
    const u = new URL(url), q = u.searchParams.get('q') || '';
    if (q.includes('clidanfi_informes')) return Response.json({ files: [{ id: 'reportes-generales' }] });
    if (q.includes('clidanfi_informe')) return Response.json({ files: [...archivos.values()] });
    if (url.includes('/upload/')) {
      const multipart = await options.body.text();
      const metadata = JSON.parse(multipart.split('\r\n\r\n')[1].split('\r\n')[0]);
      assert.ok(multipart.includes('%PDF-'));
      assert.ok(!multipart.includes('paciente_nombre') && !multipart.includes('paciente_id'));
      assert.ok(metadata.name.startsWith('Informe '));
      const previo = archivos.get(metadata.appProperties.clidanfi_informe);
      if (previo) {
        assert.equal(options.method, 'PATCH');
        assert.ok(u.pathname.endsWith('/' + previo.id));
      } else assert.deepEqual(metadata.parents, ['reportes-generales']);
      const archivo = { id: previo?.id || `reporte-${archivos.size}`, appProperties: metadata.appProperties };
      archivos.set(metadata.appProperties.clidanfi_informe, archivo);
      subidas.push(options.method);
      return Response.json({ id: archivo.id });
    }
    throw Error('Petición inesperada');
  } };
  const ahora = new Date('2026-01-05T16:00:00Z');
  assert.deepEqual(await respaldarInformesCitas(db, {}, {}, red, ahora), { guardados: 2, actualizados: 0 });
  red.usadas = 0;
  assert.deepEqual(await respaldarInformesCitas(db, {}, {}, red, ahora), { guardados: 0, actualizados: 0 });
  assert.equal(subidas.length, 2);
  fechas = ['2025-12-15T16:00:00Z', '2025-12-01T16:00:00Z'];
  red.usadas = 0;
  assert.deepEqual(await respaldarInformesCitas(db, {}, {}, red, ahora), { guardados: 0, actualizados: 1 });
  assert.deepEqual(subidas, ['POST', 'POST', 'PATCH']);
  assert.equal(archivos.size, 2);
  fechas = [];
  red.usadas = 0;
  assert.deepEqual(await respaldarInformesCitas(db, {}, {}, red, ahora), { guardados: 0, actualizados: 2 });
  red.usadas = 0;
  assert.deepEqual(await respaldarInformesCitas(db, {}, {}, red, ahora), { guardados: 0, actualizados: 0 });
});

test('mes bisiesto: febrero se cierra a medianoche de la clínica, no de UTC', () => {
  const citas = [{ inicia_en: '2024-02-29T20:00:00Z' }];
  assert.equal(periodosInformes(citas, new Date('2024-03-01T05:59:00Z')).length, 0);
  const p = periodosInformes(citas, new Date('2024-03-01T06:00:00Z'))[0];
  assert.equal(p.tipo, 'mensual');
  assert.equal(p.hasta, '2024-02-29');
  assert.equal(p.total, 1);
});

test('no publica datos parciales cuando no alcanza el presupuesto de consultas', async () => {
  const red = { usadas: 21, fetch: async () => { throw Error('No debe subir'); } };
  const db = { select: async () => { red.usadas++; return Array.from({ length: 1000 }, () => ({ inicia_en: '2025-12-31T16:00:00Z' })); } };
  assert.deepEqual(await respaldarInformesCitas(db, {}, {}, red), { diferidos: true });
});
