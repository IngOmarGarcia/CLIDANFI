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
test('nombre incluye paciente, fecha original y versión única', () => {
  assert.match(nombreRespaldo(version), /^Ana _ Pérez - 2026-09-15T12-00-00-000Z - /);
  assert.ok(nombreRespaldo(version).endsWith(`${version.id}.json`));
});
test('sin autorización no consume la cola', async () => {
  assert.deepEqual(await respaldarValoraciones({}), { omitido: 'Drive pendiente de autorización' });
});
test('sube copia completa y reutiliza archivo en reintento; conserva errores', async () => {
  const original = globalThis.fetch;
  try {
    for (const modo of ['nuevo', 'existente', 'fallo', 'otra-cuenta']) {
      const calls = [];
      globalThis.fetch = async (url, opts = {}) => {
        calls.push({ url: String(url), opts });
        if (String(url).includes('oauth2')) return Response.json({ access_token: 'access' });
        if (String(url).includes('/about')) return Response.json({ user: {
          emailAddress: modo === 'otra-cuenta' ? 'otra@gmail.com' : 'clidanfi@gmail.com'
        } });
        if (String(url).includes('/rpc/')) return Response.json([version]);
        if (String(url).includes('/upload/')) {
          if (modo === 'fallo') return new Response('', { status: 503 });
          assert.ok(opts.body.includes('"dolor": 4'));
          assert.ok(opts.body.includes('clidanfi_version'));
          return Response.json({ id: 'drive-id' });
        }
        if (String(url).includes('googleapis.com/drive/v3/files?')) {
          return Response.json({ files: modo === 'existente' ? [{ id: 'drive-id' }] : [] });
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
