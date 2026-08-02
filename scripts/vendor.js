#!/usr/bin/env node
/* ==========================================================================
   Copia el cliente UMD de Supabase a js/vendor/supabase.js

   ¿Por qué no usar el CDN? Porque la CSP del sitio (netlify.toml) restringe
   script-src a 'self'. Servir la librería desde nuestro propio dominio
   mantiene la política estricta y elimina una dependencia externa en runtime.

   Se ejecuta solo tras `npm install` y dentro de `npm run build`.
   Si @supabase/supabase-js no está instalado, avisa y continúa: la app
   funciona igual en modo demostración.
   ========================================================================== */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const DESTINO_DIR = path.join(RAIZ, 'js', 'vendor');
const DESTINO = path.join(DESTINO_DIR, 'supabase.js');

const CANDIDATOS = [
  'node_modules/@supabase/supabase-js/dist/umd/supabase.js',
  'node_modules/@supabase/supabase-js/dist/umd/supabase.min.js'
].map((p) => path.join(RAIZ, p));

const origen = CANDIDATOS.find((p) => fs.existsSync(p));

if (!origen) {
  console.warn('[CLIDANFI] @supabase/supabase-js no encontrado. La app arrancará en modo demostración.');
  console.warn('           Instálalo con:  npm install');
  fs.mkdirSync(DESTINO_DIR, { recursive: true });
  fs.writeFileSync(DESTINO, '/* Cliente de Supabase no instalado — modo demostración. */\n', 'utf8');
  process.exit(0);
}

fs.mkdirSync(DESTINO_DIR, { recursive: true });
fs.copyFileSync(origen, DESTINO);
console.log(`[CLIDANFI] js/vendor/supabase.js ← ${path.relative(RAIZ, origen)} (${(fs.statSync(DESTINO).size / 1024).toFixed(0)} KB)`);
