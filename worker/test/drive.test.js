import { test } from 'node:test';
import assert from 'node:assert/strict';
import { respaldarValoraciones, nombreRespaldo } from '../src/drive.js';

const version = {
  id: '11111111-1111-4111-8111-111111111111', bloqueo: 'lease',
  paciente_nombre: 'Ana / Pérez', creado_en: '2026-10-09T12:00:00Z',
  contenido: { creado_en: '2026-09-15T12:00:00Z', datos: { dolor: 4 } }
};
const env = {
  GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REFRESH_TOKEN: 'refresh',
  SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server'
};
test('nombre legible con fecha local del guardado y tipo, sin UUID', () => {
  assert.equal(nombreRespaldo(version), 'Ana _ Pérez - 09-10-2026 06-00-00 - Valoración inicial.pdf');
  assert.ok(!nombreRespaldo(version).includes(version.id));
  assert.notEqual(nombreRespaldo(version), nombreRespaldo({ ...version, creado_en: '2026-10-09T12:01:00Z' }));
});
test('sin autorización no consume la cola', async () => {
  assert.deepEqual(await respaldarValoraciones({}), { omitido: 'Drive pendiente de autorización' });
});
test('sube copia completa y reutiliza archivo en reintento; conserva errores', async () => {
  const original = globalThis.fetch;
  try {
    for (const modo of ['nuevo', 'existente', 'fallo', 'otra-cuenta', 'convertir-json', 'renombrar-pdf']) {
      const calls = [];
      globalThis.fetch = async (url, opts = {}) => {
        calls.push({ url: String(url), opts });
        if (String(url).includes('oauth2')) return Response.json({ access_token: 'access' });
        if (String(url).includes('/about')) return Response.json({ user: {
          emailAddress: modo === 'otra-cuenta' ? 'otra@gmail.com' : 'clidanfi@gmail.com'
        } });
        if (String(url).includes('/rpc/')) return Response.json(['convertir-json', 'renombrar-pdf'].includes(modo) ? [] : [version]);
        if (String(url).includes('/rest/v1/valoraciones_versiones?') && !opts.method) return Response.json([version]);
        if (String(url).includes('/upload/')) {
          if (modo === 'fallo') return new Response('', { status: 503 });
          const multipart = await opts.body.text();
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
          if (new URL(url).searchParams.get('q').includes('application/json')) return Response.json({
            files: ['convertir-json', 'renombrar-pdf'].includes(modo) ? [{ id: 'drive-id',
              mimeType: modo === 'renombrar-pdf' ? 'application/pdf' : 'application/json',
              appProperties: { clidanfi_version: version.id } }] : []
          });
          return Response.json({ files: modo === 'existente' ? [{ id: 'drive-id', mimeType: 'application/pdf' }] : [] });
        }
        if (opts.method === 'PATCH' && String(url).includes('googleapis.com/drive/v3/files/')) {
          const patch = JSON.parse(opts.body);
          assert.equal(patch.name, nombreRespaldo(version));
          assert.equal(patch.appProperties.clidanfi_version, version.id);
          assert.equal(patch.appProperties.clidanfi_nombre, '2');
          return Response.json({ id: 'drive-id' });
        }
        if (opts.method === 'PATCH') return new Response(null, { status: 204 });
        throw new Error('Petición inesperada');
      };
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
      if (modo === 'renombrar-pdf') {
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
