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

['index.html', 'css', 'js', 'assets', '_headers', 'robots.txt'].forEach(copiar);

/* --- 4 · verificaciones de salida ----------------------------------------- */
const problemas = [];
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

if (html.includes('cdn.tailwindcss.com')) problemas.push('index.html sigue cargando Tailwind por CDN');
if (!fs.existsSync(path.join(DIST, 'css', 'tailwind.css'))) problemas.push('falta dist/css/tailwind.css');
if (!fs.existsSync(path.join(DIST, 'js', 'env.js'))) problemas.push('falta dist/js/env.js');
if (fs.existsSync(path.join(DIST, 'css', 'input.css'))) problemas.push('input.css no debería publicarse');

// Ningún archivo publicado puede contener una service_role key
const buscarSecretos = (dir) => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { buscarSecretos(p); continue; }
    if (!/\.(js|html|json|css)$/.test(f.name)) continue;
    if (/service_role/.test(fs.readFileSync(p, 'utf8'))) {
      problemas.push(`⛔ posible service_role key en ${path.relative(DIST, p)}`);
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
