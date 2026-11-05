/* Reproduce la normalización de HTML de Cloudflare usando la rama de producción. */
const { chromium } = require('playwright-core');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve('dist');
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/index.html') { res.writeHead(308, { Location: '/' }); return res.end(); }
  if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); return res.end('<html><body>Arranque disponible</body></html>'); }
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    let body = fs.readFileSync(file);
    if (pathname === '/sw.js') body = body.toString().replace(/const LOCAL_PREVIEW = .*?;/, 'const LOCAL_PREVIEW = false;');
    res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext();
    let page = await context.newPage();
    const url = `http://127.0.0.1:${server.address().port}/`;
    await page.goto(url);
    await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    assert.equal(await page.evaluate(async () => {
      const name = (await caches.keys()).find(k => k.startsWith('clidanfi-shell-'));
      return (await (await caches.open(name)).match('/index.html')).redirected;
    }), true, 'la caché reproduce la redirección real de Cloudflare');
    await page.reload();
    assert.match(await page.textContent('body'), /Arranque disponible/);
    await context.setOffline(true);
    await page.close();
    page = await context.newPage();
    await page.goto(url + '#/t/agenda');
    assert.match(await page.textContent('body'), /Arranque disponible/);
    await page.reload();
    await context.setOffline(false);
    await page.reload();
    assert.match(await page.textContent('body'), /Arranque disponible/);
    await context.close();
    console.log('Cloudflare: caché redirigida, reapertura y recargas con y sin red correctas.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => server.close());
