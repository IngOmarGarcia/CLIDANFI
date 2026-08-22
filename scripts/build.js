#!/usr/bin/env node
/* ==========================================================================
   Build de producción → carpeta dist/
     1. genera js/env.js desde las variables de entorno
     2. compila y minifica Tailwind
     3. copia a dist/ solo lo que debe publicarse

   Se usa igual en local (`npm run build`) que en Netlify.
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const DIST = path.join(RAIZ, 'dist');

const log = (m) => console.log(`[CLIDANFI] ${m}`);

/* --- 0 · el cliente y el esquema deben hablar el mismo idioma ------------- */
execFileSync(process.execPath, [path.join(__dirname, 'check-schema.js')], { stdio: 'inherit' });

/* --- 1 · variables de entorno + cliente de Supabase ----------------------- */
execFileSync(process.execPath, [path.join(__dirname, 'generate-env.js')], { stdio: 'inherit' });
execFileSync(process.execPath, [path.join(__dirname, 'vendor.js')], { stdio: 'inherit' });

/* --- 2 · Tailwind --------------------------------------------------------- */
log('compilando Tailwind…');
const tailwindBin = path.join(RAIZ, 'node_modules', '.bin', process.platform === 'win32' ? 'tailwindcss.cmd' : 'tailwindcss');
if (!fs.existsSync(tailwindBin)) {
  console.error('\n[CLIDANFI] Falta tailwindcss. Ejecuta primero:  npm install\n');
  process.exit(1);
}
execFileSync(tailwindBin, ['-i', './css/input.css', '-o', './css/tailwind.css', '--minify'], { cwd: RAIZ, stdio: 'inherit', shell: process.platform === 'win32' });

const cssBytes = fs.statSync(path.join(RAIZ, 'css', 'tailwind.css')).size;
log(`css/tailwind.css → ${(cssBytes / 1024).toFixed(1)} KB`);

/* --- 3 · copia a dist/ ---------------------------------------------------- */
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// Lo que NO se publica: fuentes de build, plantillas y documentación interna
const EXCLUIDOS = new Set(['input.css', 'env.example.js', 'LEER-ME.txt']);

const copiar = (rel) => {
  const origen = path.join(RAIZ, rel);
  if (!fs.existsSync(origen)) return;

  const destino = path.join(DIST, rel);
  const stat = fs.statSync(origen);

  if (stat.isDirectory()) {
    fs.mkdirSync(destino, { recursive: true });
    for (const hijo of fs.readdirSync(origen)) {
      if (EXCLUIDOS.has(hijo)) continue;
      copiar(path.join(rel, hijo));
    }
  } else {
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.copyFileSync(origen, destino);
  }
};

// `sw.js` va en la RAÍZ y no dentro de js/: un service worker solo controla
// su propia carpeta hacia abajo, así que desde /js/ no podría gobernar el
// sitio entero ni atender las notificaciones.
['index.html', 'sw.js', 'css', 'js', 'assets', '_headers', '_redirects', 'robots.txt'].forEach(copiar);

/* --- 4 · verificaciones de salida ----------------------------------------- */
const problemas = [];
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

if (html.includes('cdn.tailwindcss.com')) problemas.push('index.html sigue cargando Tailwind por CDN');
if (!fs.existsSync(path.join(DIST, 'css', 'tailwind.css'))) problemas.push('falta dist/css/tailwind.css');
if (!fs.existsSync(path.join(DIST, 'js', 'env.js'))) problemas.push('falta dist/js/env.js');
if (fs.existsSync(path.join(DIST, 'css', 'input.css'))) problemas.push('input.css no debería publicarse');
// Sin el service worker en la raíz, `navigator.serviceWorker.register('/sw.js')`
// da 404 y las notificaciones no se pueden activar: el interruptor fallaría
// sin que el build hubiera avisado de nada.
if (!fs.existsSync(path.join(DIST, 'sw.js'))) problemas.push('falta dist/sw.js (service worker de notificaciones)');
// Sin `_headers` el sitio se publica en Cloudflare sin CSP ni HSTS, y no hay
// nada visible que lo delate: la aplicación funciona igual de bien sin ellas.
if (!fs.existsSync(path.join(DIST, '_headers'))) problemas.push('falta dist/_headers (cabeceras de seguridad de Cloudflare)');

/* Ningún archivo publicado puede llevar una llave con privilegios.
   Se buscan JWT reales y se decodifica su payload: mencionar la cadena
   "service_role" en un comentario o en un aviso de la interfaz es legítimo,
   llevar la llave incrustada no lo es. */
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

const buscarSecretos = (dir) => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { buscarSecretos(p); continue; }
    if (!/\.(js|html|json|css)$/.test(f.name)) continue;

    for (const token of fs.readFileSync(p, 'utf8').match(JWT) || []) {
      let rol = null;
      try {
        rol = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8')).role;
      } catch { continue; }
      if (rol && rol !== 'anon') {
        problemas.push(`⛔ llave con role="${rol}" incrustada en ${path.relative(DIST, p)}`);
      }
    }
  }
};
buscarSecretos(DIST);

if (problemas.length) {
  console.error('\n[CLIDANFI] Build detenido:\n' + problemas.map((p) => '  · ' + p).join('\n') + '\n');
  process.exit(1);
}

const contar = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((n, f) => n + (f.isDirectory() ? contar(path.join(dir, f.name)) : 1), 0);

log(`dist/ listo · ${contar(DIST)} archivos. Publica esta carpeta.`);
