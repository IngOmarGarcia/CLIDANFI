#!/usr/bin/env node
/* ==========================================================================
   CLIDANFI · generar-vapid.js

   Genera el par de claves VAPID que identifica a la clínica ante los
   servicios push (Google, Mozilla, Apple). Se hace UNA vez:

     · La PÚBLICA va al navegador (variable del sitio en Cloudflare Pages) y
       se usa al suscribirse.
     · La PRIVADA va como secreto del Worker y firma cada envío.

   Si se regeneran, TODAS las suscripciones existentes dejan de valer: cada
   navegador quedó atado a la clave pública con la que se suscribió, y habría
   que volver a activar las notificaciones en cada aparato.

   Uso:  node scripts/generar-vapid.js
   ========================================================================== */
import { webcrypto } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

(async () => {
  const par = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);

  // La pública viaja como punto sin comprimir de 65 bytes (empieza por 0x04),
  // que es el formato que espera `applicationServerKey` en el navegador.
  const publica = b64url(await webcrypto.subtle.exportKey('raw', par.publicKey));

  // La privada es solo el escalar `d` del JWK: 32 bytes.
  const jwk = await webcrypto.subtle.exportKey('jwk', par.privateKey);
  const privada = jwk.d;

  console.log(`
─────────────────────────────────────────────────────────────────────
  CLAVES VAPID · guárdalas antes de cerrar esta ventana
─────────────────────────────────────────────────────────────────────

  PÚBLICA  (va al navegador; puede verse, no es secreta)

    ${publica}

  PRIVADA  (secreta: solo el Worker)

    ${privada}

─────────────────────────────────────────────────────────────────────
  Dónde ponerlas
─────────────────────────────────────────────────────────────────────

  1 · Worker
      cd worker
      npx wrangler secret put VAPID_PRIVATE_KEY     ← pega la PRIVADA
      y escribe la PÚBLICA en VAPID_PUBLIC_KEY, dentro de wrangler.toml

  2 · Sitio (Cloudflare Pages → Settings → Environment variables)
      VAPID_PUBLIC_KEY = la PÚBLICA
      El build la inyecta en dist/js/env.js con el resto de variables.

  La pública tiene que ser LA MISMA en los dos sitios. Si no coinciden, el
  navegador se suscribe con una clave y el Worker firma con otra: el envío
  se rechaza con 403 y la notificación no llega nunca.
─────────────────────────────────────────────────────────────────────
`);
})();
