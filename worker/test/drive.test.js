import { test } from 'node:test';
import assert from 'node:assert/strict';
import { respaldarValoraciones, nombreRespaldo } from '../src/drive.js';
import { conCarpetas } from './drive-mock.js';

const version = {
  id: '11111111-1111-4111-8111-111111111111', bloqueo: 'lease',
  paciente_id: 'paciente',
  paciente_nombre: 'Ana / Pérez', creado_en: '2026-10-09T12:00:00Z',
  contenido: { creado_en: '2026-09-15T12:00:00Z', datos: { dolor: 4 } }
};
const env = {
  GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REFRESH_TOKEN: 'refresh',
  SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server'
};
test('nombre legible con fecha local del guardado y tipo, sin UUID', () => {
  assert.equal(nombreRespaldo(version), 'HC Ana _ Pérez - 09-10-26 06-00-00.pdf');
  assert.equal(nombreRespaldo({ ...version, actualizado: true }), 'HC Ana _ Pérez - Actualizado - 09-10-26 06-00-00.pdf');
  assert.equal(nombreRespaldo({ ...version, origen: 'notas', numero: 2 }), 'Evol. Ana _ Pérez - Actualizado - 09-10-26 06-00-00.pdf');
  assert.ok(!nombreRespaldo(version).includes(version.id));
  assert.notEqual(nombreRespaldo(version), nombreRespaldo({ ...version, creado_en: '2026-10-09T12:01:00Z' }));
});
test('sin autorización no consume la cola', async () => {
  assert.deepEqual(await respaldarValoraciones({}), { omitido: 'Drive pendiente de autorización' });
});

test('acorta documentos y fotos existentes conservando sus identificadores privados', async () => {
  const original = globalThis.fetch;
  const doc = { ...version, origen: 'notas', numero: 2, contenido: {
    ...version.contenido, adjuntos: [{ ruta: 'paciente/foto.jpg', titulo: 'Movilidad' }] } };
  const cambios = [];
  try {
    globalThis.fetch = async (url, opts = {}) => {
      url = String(url);
      if (url.includes('oauth2')) return Response.json({ access_token: 'access' });
      if (url.includes('/about')) return Response.json({ user: { emailAddress: 'clidanfi@gmail.com' } });
      if (url.includes('/rpc/')) return Response.json([]);
      if (url.includes('/rest/v1/documentos_versiones?')) {
        if (opts.method === 'DELETE') return new Response(null, { status: 204 });
        return Response.json(url.includes('origen=eq.citas') ? [] : [doc]);
      }
      if (url.includes('/drive/v3/files?')) return Response.json({ files: ['pdf', 'adjunto-0'].map(clave => ({
        id: clave, mimeType: clave === 'pdf' ? 'application/pdf' : 'image/jpeg',
        appProperties: { clidanfi_documento: `${version.id}:${clave}`, clidanfi_lote: version.id, clidanfi_nombre: '3' }
      })) });
      assert.equal(opts.method, 'PATCH');
      assert.ok(!url.includes('/upload/'));
      const body = JSON.parse(opts.body);
      cambios.push(body);
      assert.equal(body.appProperties.clidanfi_lote, version.id);
      assert.equal(body.appProperties.clidanfi_nombre, '4');
      return Response.json({ id: url.includes('/pdf?') ? 'pdf' : 'adjunto-0' });
    };
    globalThis.fetch = conCarpetas(globalThis.fetch);
    const result = await respaldarValoraciones(env);
    assert.equal(result.renombrados, 2);
    assert.equal(result.conversionesFallidas, 0);
    assert.equal(cambios[0].name, 'Evol. Ana _ Pérez - Actualizado - 09-10-26 06-00-00.pdf');
    assert.equal(cambios[1].name, 'Evid. Ana _ Pérez - Movilidad - Actualizado - 09-10-26 06-00-00.jpg');
  } finally { globalThis.fetch = original; }
});
test('sube copia completa y reutiliza archivo en reintento; conserva errores', async () => {
  const original = globalThis.fetch;
  try {
    for (const modo of ['nuevo', 'existente', 'fallo', 'otra-cuenta', 'convertir-json', 'renombrar-pdf', 'renombrar-edicion']) {
      const calls = [];
      globalThis.fetch = async (url, opts = {}) => {
        calls.push({ url: String(url), opts });
        if (String(url).includes('oauth2')) return Response.json({ access_token: 'access' });
        if (String(url).includes('/about')) return Response.json({ user: {
          emailAddress: modo === 'otra-cuenta' ? 'otra@gmail.com' : 'clidanfi@gmail.com'
        } });
        if (String(url).includes('/rest/v1/documentos_versiones?')) {
          return opts.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json([]);
        }
        if (String(url).includes('/rpc/reclamar_respaldos_documento')) return Response.json([]);
        if (String(url).includes('/rpc/')) return Response.json(['convertir-json', 'renombrar-pdf', 'renombrar-edicion'].includes(modo) ? [] : [version]);
        if (String(url).includes('/rest/v1/valoraciones_versiones?') && !opts.method) {
          return Response.json(modo === 'renombrar-edicion' && String(url).includes('select=id')
            ? [{ id: 'version-inicial' }] : [version]);
        }
        if (String(url).includes('/upload/')) {
          if (modo === 'fallo') return new Response('', { status: 503 });
          const multipart = await opts.body.text();
          const metadata = JSON.parse(multipart.split('\r\n\r\n')[1].split('\r\n')[0]);
          if (opts.method === 'POST') {
            assert.deepEqual(metadata.parents, ['carpeta-paciente']);
            assert.equal(metadata.appProperties.clidanfi_paciente, version.paciente_id);
          }
          assert.ok(multipart.includes('%PDF-'));
          assert.ok(multipart.includes('application/pdf'));
          assert.ok(multipart.includes('clidanfi_version'));
          if (modo === 'convertir-json') {
            assert.equal(opts.method, 'PATCH');
            assert.ok(String(url).includes('/drive-id?'));
          }
          return Response.json({ id: 'drive-id' });
        }
        if (String(url).includes('googleapis.com/drive/v3/files?')) {
          if (new URL(url).searchParams.get('q').includes("key='clidanfi_nombre'")) return Response.json({
            files: ['convertir-json', 'renombrar-pdf', 'renombrar-edicion'].includes(modo) ? [{ id: 'drive-id',
              mimeType: modo === 'convertir-json' ? 'application/json' : 'application/pdf',
              appProperties: { clidanfi_version: version.id } }] : []
          });
          return Response.json({ files: modo === 'existente' ? [{ id: 'drive-id', mimeType: 'application/pdf' }] : [] });
        }
        if (opts.method === 'PATCH' && String(url).includes('googleapis.com/drive/v3/files/')) {
          const patch = JSON.parse(opts.body);
          assert.equal(patch.name, nombreRespaldo({ ...version, actualizado: modo === 'renombrar-edicion' }));
          assert.equal(patch.appProperties.clidanfi_version, version.id);
          assert.equal(patch.appProperties.clidanfi_nombre, '4');
          return Response.json({ id: 'drive-id' });
        }
        if (opts.method === 'PATCH') return new Response(null, { status: 204 });
        throw new Error('Petición inesperada');
      };
      globalThis.fetch = conCarpetas(globalThis.fetch);
      if (modo === 'otra-cuenta') {
        await assert.rejects(() => respaldarValoraciones(env), /clidanfi@gmail.com/);
        assert.ok(!calls.some(c => c.url.includes('/rpc/')));
        continue;
      }
      const result = await respaldarValoraciones(env);
      assert.equal(result.fallidos, modo === 'fallo' ? 1 : 0);
      if (modo === 'convertir-json') {
        assert.equal(result.convertidos, 1);
        assert.equal(result.conversionesFallidas, 0);
        continue;
      }
      if (['renombrar-pdf', 'renombrar-edicion'].includes(modo)) {
        assert.equal(result.renombrados, 1);
        assert.ok(!calls.some(c => c.url.includes('/upload/')));
        continue;
      }
      const patch = calls.find(c => c.opts.method === 'PATCH');
      assert.ok(patch.url.includes('bloqueo=eq.lease'));
      const payload = JSON.parse(patch.opts.body);
      if (modo === 'fallo') {
        assert.match(payload.ultimo_error, /503/);
        assert.ok(!payload.drive_archivo_id);
      } else assert.equal(payload.drive_archivo_id, 'drive-id');
      if (modo === 'existente') assert.ok(!calls.some(c => c.url.includes('/upload/')));
    }
  } finally { globalThis.fetch = original; }
});
