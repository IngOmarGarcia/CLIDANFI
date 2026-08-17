/* ==========================================================================
   CLIDANFI · webpush.test.js

   El cifrado de Web Push tiene una propiedad desagradable: cuando está mal,
   NO falla. El servicio push acepta el POST, devuelve 201 y la notificación
   simplemente no aparece nunca —porque el navegador no pudo descifrarla y la
   descarta en silencio—. No hay error que leer ni log donde mirar.

   Por eso esta prueba no comprueba que `enviarPush` no reviente: hace de
   navegador. Genera un par de claves como haría Chrome al suscribirse,
   intercepta el envío, y DESCIFRA el cuerpo siguiendo RFC 8291 por el otro
   lado. Si el texto que sale no es el que entró, el aviso no habría llegado.

   Uso:  node --test test/
   ========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert';
import { webcrypto } from 'node:crypto';
import { enviarPush } from '../src/webpush.js';
import { telWhatsApp, waLink } from '../src/index.js';

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const subtle = webcrypto.subtle;
const texto = (s) => new TextEncoder().encode(s);
const unir = (...t) => Buffer.concat(t.map((x) => Buffer.from(x)));

/* --- El navegador se suscribe -------------------------------------------- */
async function simularNavegador() {
  const par = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publica = Buffer.from(await subtle.exportKey('raw', par.publicKey));
  const auth = webcrypto.getRandomValues(new Uint8Array(16));
  return {
    privada: par.privateKey,
    suscripcion: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/FAKE-ENDPOINT',
      p256dh: b64url(publica),
      auth: b64url(auth)
    },
    publicaCruda: publica,
    authCrudo: Buffer.from(auth)
  };
}

/* --- Claves VAPID de la clínica ------------------------------------------ */
async function generarVapid() {
  const par = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publica = b64url(await subtle.exportKey('raw', par.publicKey));
  const jwk = await subtle.exportKey('jwk', par.privateKey);
  return { publica, privada: jwk.d, contacto: 'mailto:fisio@clidanfi.mx', verificar: par.publicKey };
}

/* --- HKDF, igual que en el Worker pero escrito aparte a propósito ---------
   Si se importara el del Worker, un error en la derivación se cancelaría solo
   y la prueba pasaría con el cifrado roto. */
const hmac = async (clave, datos) => {
  const k = await subtle.importKey('raw', clave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Buffer.from(await subtle.sign('HMAC', k, datos));
};
const expandir = async (prk, info, largo) => (await hmac(prk, unir(info, Buffer.from([1])))).slice(0, largo);

/** Descifra un cuerpo aes128gcm como lo haría el navegador suscrito. */
async function descifrarComoNavegador(cuerpo, nav) {
  const buf = Buffer.from(cuerpo);

  // Cabecera: sal(16) | rs(4) | idlen(1) | clave del servidor(65)
  const sal = buf.slice(0, 16);
  const rs = buf.readUInt32BE(16);
  const idlen = buf[20];
  const claveAS = buf.slice(21, 21 + idlen);
  const cifrado = buf.slice(21 + idlen);

  assert.strictEqual(idlen, 65, 'la clave pública del servidor debe ser un punto P-256 sin comprimir');
  assert.strictEqual(rs, 4096, 'el tamaño de registro declarado no es el esperado');

  const claveASImportada = await subtle.importKey(
    'raw', claveAS, { name: 'ECDH', namedCurve: 'P-256' }, false, []);

  const compartido = Buffer.from(
    await subtle.deriveBits({ name: 'ECDH', public: claveASImportada }, nav.privada, 256));

  // RFC 8291 §3.4 · el orden ua||as es normativo
  const prkClave = await hmac(nav.authCrudo, compartido);
  const infoClave = unir(texto('WebPush: info\0'), nav.publicaCruda, claveAS);
  const ikm = await expandir(prkClave, infoClave, 32);

  const prk = await hmac(sal, ikm);
  const cek = await expandir(prk, texto('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await expandir(prk, texto('Content-Encoding: nonce\0'), 12);

  const claveAES = await subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']);
  const plano = Buffer.from(
    await subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, claveAES, cifrado));

  // El último byte es el delimitador de registro (0x02)
  assert.strictEqual(plano[plano.length - 1], 2, 'falta el delimitador de último registro');
  return plano.slice(0, -1).toString('utf8');
}

/* ========================================================================== */

test('el navegador puede descifrar exactamente lo que se le mandó', async () => {
  const nav = await simularNavegador();
  const vapid = await generarVapid();

  const carga = {
    tipo: 'previo_40',
    titulo: 'Laura Ruiz en 40 min',
    cuerpo: '05:30 p. m. · Sesión de rehabilitación',
    acentos: 'áéíóú ñ ¿? — “comillas”'
  };

  let capturado = null;
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async (url, opciones) => {
    capturado = { url, opciones };
    return new Response('', { status: 201 });
  };

  try {
    const r = await enviarPush(nav.suscripcion, carga, vapid);
    assert.strictEqual(r.ok, true, `el envío falló: ${r.detalle}`);
  } finally {
    globalThis.fetch = fetchReal;
  }

  assert.strictEqual(capturado.url, nav.suscripcion.endpoint);
  assert.strictEqual(capturado.opciones.headers['Content-Encoding'], 'aes128gcm');

  const descifrado = await descifrarComoNavegador(capturado.opciones.body, nav);
  assert.deepStrictEqual(JSON.parse(descifrado), carga,
    'el navegador no recuperó el mensaje: la notificación se descartaría en silencio');
});

test('el JWT de VAPID lo puede verificar el servicio push', async () => {
  const nav = await simularNavegador();
  const vapid = await generarVapid();

  let cabeceras = null;
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async (url, opciones) => { cabeceras = opciones.headers; return new Response('', { status: 201 }); };
  try { await enviarPush(nav.suscripcion, { a: 1 }, vapid); } finally { globalThis.fetch = fetchReal; }

  const auth = cabeceras.Authorization;
  assert.match(auth, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/, 'la cabecera Authorization no tiene el formato de VAPID');

  const jwt = auth.match(/t=([^,]+)/)[1];
  const [cab, cuerpo, firma] = jwt.split('.');

  assert.deepStrictEqual(JSON.parse(deB64url(cab).toString()), { typ: 'JWT', alg: 'ES256' });

  const datos = JSON.parse(deB64url(cuerpo).toString());
  // `aud` debe ser el ORIGEN, no el endpoint completo: con el endpoint entero
  // Firefox y FCM rechazan el token con 401.
  assert.strictEqual(datos.aud, 'https://fcm.googleapis.com');
  assert.strictEqual(datos.sub, vapid.contacto);
  assert.ok(datos.exp > Math.floor(Date.now() / 1000), 'el token nace caducado');
  assert.ok(datos.exp <= Math.floor(Date.now() / 1000) + 24 * 60 * 60, 'la norma no admite más de 24 h');

  const valida = await subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, vapid.verificar,
    deB64url(firma), texto(`${cab}.${cuerpo}`));
  assert.ok(valida, 'la firma no valida contra la clave pública anunciada en k=');

  // La `k=` tiene que ser la misma clave con la que se firmó, o el servicio
  // push verifica contra una clave equivocada y responde 403.
  assert.strictEqual(auth.match(/k=(.+)$/)[1], vapid.publica);
});

test('una suscripción caducada se reconoce para poder darla de baja', async () => {
  const nav = await simularNavegador();
  const vapid = await generarVapid();

  const fetchReal = globalThis.fetch;
  for (const estado of [404, 410]) {
    globalThis.fetch = async () => new Response('gone', { status: estado });
    const r = await enviarPush(nav.suscripcion, { a: 1 }, vapid);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.caducada, true, `${estado} debe marcarse como caducada`);
  }

  // Un 500 del servicio push NO es una suscripción muerta: darla de baja
  // desactivaría los avisos del fisio por una caída ajena.
  globalThis.fetch = async () => new Response('boom', { status: 500 });
  const r = await enviarPush(nav.suscripcion, { a: 1 }, vapid);
  assert.strictEqual(r.caducada, false, 'un 500 no debe dar de baja el aparato');

  // Y un fallo de red tampoco tumba la tanda entera.
  globalThis.fetch = async () => { throw new Error('sin red'); };
  const caido = await enviarPush(nav.suscripcion, { a: 1 }, vapid);
  assert.strictEqual(caido.ok, false);
  assert.strictEqual(caido.caducada, false);

  globalThis.fetch = fetchReal;
});

test('el teléfono del Worker se normaliza igual que en la interfaz', async () => {

  // Los mismos casos que `scripts/test-funciones.js` le exige a js/ui.js.
  // Están duplicados en dos runtimes y esto es lo que impide que se separen.
  assert.strictEqual(telWhatsApp('667 123 4567'), '526671234567');
  assert.strictEqual(telWhatsApp('+52 667 123 4567'), '526671234567');
  assert.strictEqual(telWhatsApp('(667) 123-4567'), '526671234567');
  assert.strictEqual(telWhatsApp('04491234567'), '524491234567');
  assert.strictEqual(telWhatsApp('449 123 4567'), '524491234567');
  assert.strictEqual(telWhatsApp('123'), '');
  assert.strictEqual(telWhatsApp(''), '');
  assert.strictEqual(telWhatsApp(null), '');

  assert.ok(waLink('667 123 4567', 'Hola Ana').startsWith('https://wa.me/526671234567?text='));
  assert.match(waLink('6671234567', 'Hola Ana'), /Hola%20Ana/);
  assert.strictEqual(waLink('123', 'Hola'), '');
});
