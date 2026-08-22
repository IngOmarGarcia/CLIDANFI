#!/usr/bin/env node
/* ==========================================================================
   Genera js/env.js a partir de las variables de entorno.
   Se ejecuta en el build de Cloudflare Pages y también en local
   (`npm run env`, y de paso en `npm run build` y `npm run dev`).

   Variables que lee (acepta el prefijo VITE_/PUBLIC_ por comodidad):
     SUPABASE_URL · SUPABASE_ANON_KEY · VAPID_PUBLIC_KEY

   En local salen de un archivo `.env` en la raíz (ver `.env.example`); en
   Cloudflare Pages, de Settings → Environment variables. Ni `.env` ni el
   `js/env.js` generado se suben a git.

   Si faltan, escribe valores vacíos: la aplicación arranca y muestra la
   pantalla de configuración diciendo qué falta, en vez de romperse con un
   error que no explica nada.
   ========================================================================== */
require('dotenv').config();

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

// Clave pública VAPID de las notificaciones push. Es PÚBLICA por definición
// —el navegador la necesita para suscribirse— y no da acceso a nada: la que
// firma los envíos es la privada, que vive solo como secreto del Worker.
// Si falta, la aplicación funciona igual y el interruptor de notificaciones
// se muestra apagado con el motivo.
const vapid = leer('VAPID_PUBLIC_KEY', 'VITE_VAPID_PUBLIC_KEY', 'PUBLIC_VAPID_PUBLIC_KEY');

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

// La pública VAPID es un punto P-256 sin comprimir: 65 bytes que en base64url
// son 87 caracteres y empiezan por 'B' (el 0x04 inicial). Vale la pena
// comprobarlo aquí: una clave mal copiada no falla al desplegar, falla meses
// después cuando una notificación no llega y nadie sabe por qué.
if (vapid && !/^B[A-Za-z0-9_-]{85,86}$/.test(vapid)) {
  errores.push(`VAPID_PUBLIC_KEY no parece una clave pública P-256 (${vapid.length} caracteres, se esperan 87). ` +
               'Genérala con `npm run vapid` dentro de worker/.');
}

if (errores.length) {
  console.error('\n[CLIDANFI] Error de configuración:\n' + errores.map((e) => '  · ' + e).join('\n') + '\n');
  process.exit(1);
}

const contenido = `/* ARCHIVO GENERADO por scripts/generate-env.js — no editar a mano. */
window.CLIDANFI_ENV = {
  SUPABASE_URL: ${JSON.stringify(url)},
  SUPABASE_ANON_KEY: ${JSON.stringify(key)},
  VAPID_PUBLIC_KEY: ${JSON.stringify(vapid)}
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
