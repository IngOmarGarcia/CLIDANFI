#!/usr/bin/env node
/* ==========================================================================
   Genera js/env.js a partir de las variables de entorno.
   Se ejecuta en el build de Netlify y también en local (`npm run env`).

   Variables que lee (acepta el prefijo VITE_/PUBLIC_ por comodidad):
     SUPABASE_URL        · SUPABASE_ANON_KEY

   Si no están definidas, escribe valores vacíos: la app arranca igual en
   MODO DEMOSTRACIÓN (datos locales) y avisa en la pantalla de acceso.
   ========================================================================== */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const DESTINO = path.join(RAIZ, 'js', 'env.js');

const leer = (...nombres) => {
  for (const n of nombres) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return '';
};

const url = leer('SUPABASE_URL', 'VITE_SUPABASE_URL', 'PUBLIC_SUPABASE_URL');
const key = leer('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'PUBLIC_SUPABASE_ANON_KEY');

/* --- Validaciones que evitan desplegar con credenciales equivocadas ------ */
const errores = [];
if (url && !/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url)) {
  errores.push(`SUPABASE_URL no parece válida: "${url}" (esperado https://xxxx.supabase.co)`);
}
if (key && key.split('.').length !== 3) {
  errores.push('SUPABASE_ANON_KEY no parece un JWT (debe tener tres partes separadas por puntos)');
}
// La service_role key jamás debe llegar al navegador
if (key) {
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString('utf8'));
    if (payload.role && payload.role !== 'anon') {
      errores.push(`⛔ La llave tiene role="${payload.role}". En el frontend SOLO va la anon key.`);
    }
  } catch { /* si no se puede decodificar, la validación anterior ya avisó */ }
}

if (errores.length) {
  console.error('\n[CLIDANFI] Error de configuración:\n' + errores.map((e) => '  · ' + e).join('\n') + '\n');
  process.exit(1);
}

const contenido = `/* ARCHIVO GENERADO por scripts/generate-env.js — no editar a mano. */
window.CLIDANFI_ENV = {
  SUPABASE_URL: ${JSON.stringify(url)},
  SUPABASE_ANON_KEY: ${JSON.stringify(key)}
};
`;

fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
fs.writeFileSync(DESTINO, contenido, 'utf8');

if (url && key) {
  console.log(`[CLIDANFI] js/env.js generado → Supabase ${url}`);
} else {
  console.warn('[CLIDANFI] js/env.js generado SIN credenciales.');
  console.warn('           La aplicación mostrará la pantalla de configuración en vez de arrancar.');
  console.warn('           Define SUPABASE_URL y SUPABASE_ANON_KEY (o edita js/env.js a mano).');
}
