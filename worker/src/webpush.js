/* ==========================================================================
   CLIDANFI · webpush.js  ·  Web Push desde un Worker, sin dependencias

   Manda una notificación a un navegador suscrito. Son dos mecanismos
   independientes que hay que hacer bien los dos:

     1. VAPID (RFC 8292) — identifica a QUIÉN manda. Un JWT firmado con
        ECDSA P-256 que el servicio push del navegador verifica contra la
        clave pública. Sin esto, Chrome y Firefox rechazan el envío.

     2. aes128gcm (RFC 8291 + RFC 8188) — cifra el CONTENIDO de extremo a
        extremo. El servicio push de Google o Mozilla reenvía el mensaje
        pero no puede leerlo: la clave sale de un ECDH contra la clave
        pública del navegador, que solo él tiene.

   Se implementa a mano porque las librerías de npm para esto (`web-push`)
   dependen del `crypto` de Node y no corren en el runtime de Workers. Todo
   lo que hay aquí usa Web Crypto, que sí está disponible.

   El único punto delicado son los formatos binarios: casi todos los fallos
   al integrar Web Push son un byte de más o un base64 con el alfabeto
   equivocado, y el error que devuelve el servidor push nunca lo dice.
   ========================================================================== */

/* --- base64url ------------------------------------------------------------
   Web Push usa SIEMPRE base64url (RFC 4648 §5): `-` y `_` en vez de `+` y
   `/`, y sin relleno. El base64 normal no sirve. */
export const b64urlADatos = (s) => {
  const base = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const relleno = base + '='.repeat((4 - (base.length % 4)) % 4);
  const bin = atob(relleno);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export const datosAB64url = (bytes) => {
  const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const unir = (...trozos) => {
  const total = trozos.reduce((n, t) => n + t.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const t of trozos) { out.set(t, off); off += t.length; }
  return out;
};

const texto = (s) => new TextEncoder().encode(s);

/* --- HKDF (RFC 5869) ------------------------------------------------------
   Se hace en dos pasos explícitos —extract y expand— en vez de usar el HKDF
   de Web Crypto de una pieza, porque RFC 8291 necesita el PRK intermedio
   como clave de la siguiente derivación. */
const hmac = async (clave, datos) => {
  const k = await crypto.subtle.importKey('raw', clave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, datos));
};

/** HKDF-Extract: convierte material bruto en una clave pseudoaleatoria. */
const extraer = (sal, ikm) => hmac(sal, ikm);

/** HKDF-Expand con L ≤ 32, que es lo único que necesita Web Push. */
const expandir = async (prk, info, largo) => {
  const bloque = await hmac(prk, unir(info, new Uint8Array([1])));
  return bloque.slice(0, largo);
};

/* ==========================================================================
   1 · CIFRADO DEL CONTENIDO  (RFC 8291)
   ========================================================================== */

/**
 * Cifra el mensaje para una suscripción concreta.
 *
 * @param {string} p256dh  clave pública del navegador (base64url, 65 bytes)
 * @param {string} auth    secreto de autenticación (base64url, 16 bytes)
 * @param {string} mensaje texto plano (aquí siempre JSON)
 * @returns {Uint8Array}   cuerpo listo para enviar, con su cabecera
 */
async function cifrar(p256dh, auth, mensaje) {
  const claveUA = b64urlADatos(p256dh);      // 65 bytes, punto sin comprimir
  const secretoAuth = b64urlADatos(auth);    // 16 bytes
  const sal = crypto.getRandomValues(new Uint8Array(16));

  // Par efímero del servidor: uno nuevo por mensaje. Reutilizarlo permitiría
  // correlacionar envíos y rompería el forward secrecy.
  const par = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const claveAS = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey));

  const claveUAImportada = await crypto.subtle.importKey(
    'raw', claveUA, { name: 'ECDH', namedCurve: 'P-256' }, false, []);

  // Secreto compartido ECDH: 32 bytes (solo la coordenada X).
  const compartido = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: claveUAImportada }, par.privateKey, 256));

  // Derivación de RFC 8291 §3.4. El orden ua||as en `key_info` es normativo:
  // invertirlo produce una clave válida que el navegador no puede reproducir,
  // y el error solo se ve como una notificación que nunca llega.
  const prkClave = await extraer(secretoAuth, compartido);
  const infoClave = unir(texto('WebPush: info\0'), claveUA, claveAS);
  const ikm = await expandir(prkClave, infoClave, 32);

  // A partir de aquí es aes128gcm genérico (RFC 8188 §2.2).
  const prk = await extraer(sal, ikm);
  const cek = await expandir(prk, texto('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await expandir(prk, texto('Content-Encoding: nonce\0'), 12);

  // 0x02 marca el último registro. Va DENTRO del texto cifrado, no fuera.
  const conDelimitador = unir(texto(mensaje), new Uint8Array([2]));

  const claveAES = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const cifrado = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, claveAES, conDelimitador));

  // Cabecera: sal(16) | tamaño de registro(4, big-endian) | largo de clave(1) | clave(65)
  const cabecera = new Uint8Array(21);
  cabecera.set(sal, 0);
  new DataView(cabecera.buffer).setUint32(16, 4096, false);
  cabecera[20] = claveAS.length;

  return unir(cabecera, claveAS, cifrado);
}

/* ==========================================================================
   2 · IDENTIFICACIÓN DEL EMISOR  (VAPID, RFC 8292)
   ========================================================================== */

/**
 * Firma el JWT que acredita a la clínica ante el servicio push.
 *
 * `aud` es el ORIGEN del endpoint, no el endpoint entero: un JWT emitido
 * para `https://fcm.googleapis.com/fcm/send/abc` es rechazado.
 */
async function cabeceraVapid(endpoint, { publica, privada, contacto }) {
  const aud = new URL(endpoint).origin;

  const cabeceraJwt = { typ: 'JWT', alg: 'ES256' };
  const cuerpo = {
    aud,
    // 12 h. El máximo que admite la norma son 24; más corto limita el daño
    // si el token se filtrara de un log intermedio.
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: contacto
  };

  const sinFirmar = `${datosAB64url(texto(JSON.stringify(cabeceraJwt)))}.${datosAB64url(texto(JSON.stringify(cuerpo)))}`;

  // La privada VAPID es el escalar de 32 bytes en base64url. Web Crypto solo
  // importa ECDSA cruda en formato JWK, así que se arma el JWK a mano
  // completándolo con las coordenadas que salen de la clave pública.
  const pub = b64urlADatos(publica);
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: false,
    d: privada.replace(/=+$/, ''),
    x: datosAB64url(pub.slice(1, 33)),   // se salta el 0x04 inicial
    y: datosAB64url(pub.slice(33, 65))
  };

  const clave = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  // Web Crypto devuelve la firma como r||s crudos (64 bytes), que es
  // exactamente lo que pide JWS. No hay que desenvolver ningún DER.
  const firma = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, clave, texto(sinFirmar)));

  return `vapid t=${sinFirmar}.${datosAB64url(firma)}, k=${publica}`;
}

/* ==========================================================================
   3 · ENVÍO
   ========================================================================== */

/**
 * Manda una notificación a un navegador.
 *
 * No lanza excepción cuando el servicio push rechaza el envío: devuelve el
 * resultado. Un fallo aquí es un aparato que se desinstaló, no un error del
 * programa, y un `throw` cortaría el resto de la tanda.
 *
 * @returns {{ok: boolean, estado: number, caducada: boolean, detalle: string}}
 *   `caducada:true` ⇒ el navegador ya no existe (404/410): hay que borrar la
 *   suscripción de la base, o se reintentará para siempre.
 */
export async function enviarPush(suscripcion, datos, vapid, { ttl = 3600, urgencia = 'high' } = {}) {
  try {
    const cuerpo = await cifrar(suscripcion.p256dh, suscripcion.auth, JSON.stringify(datos));
    const autorizacion = await cabeceraVapid(suscripcion.endpoint, vapid);

    const res = await fetch(suscripcion.endpoint, {
      method: 'POST',
      headers: {
        Authorization: autorizacion,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttl),
        // `high` pide que se entregue aunque el aparato esté ahorrando
        // batería. Para un aviso de 40 minutos antes, llegar tarde es no
        // llegar.
        Urgency: urgencia
      },
      body: cuerpo
    });

    if (res.ok) return { ok: true, estado: res.status, caducada: false, detalle: '' };

    const detalle = (await res.text().catch(() => '')).slice(0, 200);
    return {
      ok: false,
      estado: res.status,
      caducada: res.status === 404 || res.status === 410,
      detalle
    };
  } catch (e) {
    // Un fallo de red o de cifrado. No es «caducada»: reintentar tiene sentido.
    return { ok: false, estado: 0, caducada: false, detalle: String(e && e.message || e) };
  }
}
