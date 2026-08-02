/* ==========================================================================
   CLIDANFI · supabase-client.js
   ÚNICO punto donde se crea el cliente de Supabase.

   Se ejecuta antes que cualquier otro script de la aplicación y deja
   disponibles de forma global:

       window.SB              cliente de Supabase ya inicializado
       window.CLIDANFI_LISTO  true si la configuración es correcta
       window.CLIDANFI_FALLO  motivo del problema, si lo hubiera

   No existe modo demostración: si falta configuración, la aplicación
   muestra una pantalla de configuración con instrucciones en vez de
   arrancar con datos falsos.
   ========================================================================== */
(function (global) {
  'use strict';

  global.SB = null;
  global.CLIDANFI_LISTO = false;
  global.CLIDANFI_FALLO = null;

  const fallar = (codigo, mensaje) => {
    global.CLIDANFI_FALLO = { codigo, mensaje };
    console.error('[CLIDANFI] ' + mensaje);
  };

  /* --- 1 · Credenciales globales ---------------------------------------- */
  // Origen único: js/env.js (lo genera scripts/generate-env.js a partir de
  // las variables de entorno de Netlify, o lo escribes tú en local).
  const ENV = global.CLIDANFI_ENV || {};
  const URL = String(ENV.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const KEY = String(ENV.SUPABASE_ANON_KEY || '').trim();

  if (!global.CLIDANFI_ENV) {
    return fallar('sin-env',
      'No se cargó js/env.js. Ejecuta «npm run env» o copia js/env.example.js a js/env.js.');
  }
  if (!URL || !KEY) {
    return fallar('sin-credenciales',
      'Faltan SUPABASE_URL o SUPABASE_ANON_KEY en js/env.js.');
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(URL)) {
    return fallar('url-invalida',
      `SUPABASE_URL no tiene el formato esperado: "${URL}" (debe ser https://xxxx.supabase.co).`);
  }
  if (KEY.split('.').length !== 3) {
    return fallar('key-invalida',
      'SUPABASE_ANON_KEY no parece un JWT válido (debe tener tres partes separadas por puntos).');
  }

  // La service_role key ignora RLS: jamás debe llegar al navegador.
  try {
    const payload = JSON.parse(atob(KEY.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.role && payload.role !== 'anon') {
      return fallar('key-peligrosa',
        `La llave configurada tiene role="${payload.role}". En el navegador SOLO puede ir la anon key.`);
    }
  } catch { /* si no se puede decodificar, las validaciones previas ya avisaron */ }

  /* --- 2 · Librería ------------------------------------------------------ */
  if (!global.supabase || typeof global.supabase.createClient !== 'function') {
    return fallar('sin-libreria',
      'No se cargó js/vendor/supabase.js. Ejecuta «npm install» (o «npm run vendor»).');
  }

  /* --- 3 · Cliente ------------------------------------------------------- */
  try {
    global.SB = global.supabase.createClient(URL, KEY, {
      auth: {
        persistSession: true,       // la sesión sobrevive al recargar
        autoRefreshToken: true,     // renueva el JWT antes de que expire
        detectSessionInUrl: true,   // necesario para el enlace de recuperación
        storageKey: 'clidanfi.auth'
      },
      global: { headers: { 'x-client-info': 'clidanfi-web' } }
    });
    global.CLIDANFI_LISTO = true;
    console.info('[CLIDANFI] Cliente de Supabase inicializado →', URL);
  } catch (e) {
    fallar('error-cliente', 'No se pudo inicializar el cliente de Supabase: ' + e.message);
  }
})(window);
