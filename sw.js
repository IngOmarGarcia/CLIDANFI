/* ==========================================================================
   CLIDANFI · sw.js  ·  Service Worker

   Recibe notificaciones y conserva una versión completa de la aplicación
   para arrancar sin red. La agenda y los expedientes se guardan por cuenta
   en IndexedDB, separados de esta caché pública de recursos.

   Vive en la RAÍZ del sitio a propósito: un service worker solo controla su
   propia carpeta hacia abajo, y desde `/js/` no podría gobernar `/`.
   ========================================================================== */

// Las actualizaciones esperan al cierre de las pestañas para no mezclar
// versiones ni interrumpir la captura de información clínica.
// El build sustituye estos valores por una lista y una versión de contenido.
const SHELL_VERSION = 'offline-dev-1';
const SHELL_FILES = null;
const SHELL_CACHE = `clidanfi-shell-${SHELL_VERSION}`;
const LOCAL_PREVIEW = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(SHELL_CACHE);
  let files = SHELL_FILES;
  if (!files) {
    const response = await fetch('/index.html', { cache: 'reload' });
    if (!response.ok) throw new Error('No se pudo preparar la aplicación.');
    const html = await response.text();
    files = ['/index.html', '/manifest.webmanifest', '/assets/logo-clidanfi.jpeg',
      ...Array.from(html.matchAll(/(?:src|href)="(\.\/(?:js|css)\/[^\"]+)"/g), m => m[1].slice(1))];
  }
  await cache.addAll(files);
  if (LOCAL_PREVIEW) await self.skipWaiting();
  // No forzar la actualización en mitad de una consulta o un formulario.
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('clidanfi-shell-') && key !== SHELL_CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (LOCAL_PREVIEW && (event.request.mode === 'navigate' || /^\/(?:js\/|css\/|assets\/|manifest\.webmanifest$)/.test(url.pathname))) {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request, { cache: 'no-store' });
        if (response.ok) return response;
      } catch { /* sin conexión: conservar el arranque desde la copia preparada */ }
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(event.request.mode === 'navigate' ? '/index.html' : event.request);
      return cached || fetch(event.request);
    })());
    return;
  }
  // Supabase y los archivos clínicos nunca pasan por esta caché compartida.
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => (await (await caches.open(SHELL_CACHE)).match('/index.html')) || fetch(event.request))());
  } else if (/^\/(?:js\/|css\/|assets\/|manifest\.webmanifest$)/.test(url.pathname)) {
    event.respondWith((async () => (await (await caches.open(SHELL_CACHE)).match(event.request)) || fetch(event.request))());
  }
});

/* --------------------------------------------------------------------------
   Llega una notificación
   -------------------------------------------------------------------------- */
self.addEventListener('push', (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch {
    // Un push sin cuerpo legible sigue mereciendo un aviso: es preferible una
    // notificación genérica a que el fisio no se entere de nada.
    datos = { titulo: 'CLIDANFI', cuerpo: 'Tienes un aviso pendiente.' };
  }

  const esResumen = datos.tipo === 'recordatorio_dia';

  const opciones = {
    body: datos.cuerpo || '',
    icon: '/assets/icon-192.png',
    badge: '/assets/badge-72.png',
    // `tag` hace que un aviso del mismo tipo REEMPLACE al anterior en vez de
    // apilarse. Sin esto, dos sesiones seguidas dejarían la pantalla de
    // bloqueo llena de avisos casi idénticos.
    tag: datos.tipo || 'clidanfi',
    renotify: true,
    // El resumen diario no urge y puede esperar a que el fisio mire el
    // teléfono; el de 40 minutos antes, no.
    requireInteraction: !esResumen,
    timestamp: Date.now(),
    data: {
      url: datos.url || '/#/t/agenda',
      tipo: datos.tipo || '',
      pacientes: datos.pacientes || [],
      cita_id: datos.cita_id || null
    },
    actions: esResumen
      ? [{ action: 'agenda', title: 'Ver y enviar' }]
      : [{ action: 'agenda', title: 'Abrir agenda' }]
  };

  event.waitUntil(
    self.registration.showNotification(datos.titulo || 'CLIDANFI', opciones));
});

/* --------------------------------------------------------------------------
   El fisio toca la notificación
   -------------------------------------------------------------------------- */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const info = event.notification.data || {};
  const destino = info.url || '/#/t/agenda';

  event.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    // Si CLIDANFI ya está abierto, se reutiliza esa pestaña en vez de abrir
    // otra: acumular pestañas de la misma aplicación es una molestia y, peor,
    // dejaría formularios a medias en la que se queda atrás.
    for (const cliente of abiertas) {
      if (cliente.url.includes(self.location.origin)) {
        await cliente.focus();
        // La ruta se pasa por mensaje para que el router navegue sin recargar
        // y sin perder lo que hubiera sin guardar.
        cliente.postMessage({ fuente: 'clidanfi-sw', accion: 'navegar', url: destino, datos: info });
        return;
      }
    }
    await self.clients.openWindow(destino);
  })());
});

/* --------------------------------------------------------------------------
   El servicio push rotó la suscripción

   Pasa solo, sin que el usuario haga nada, y si no se atiende el aparato deja
   de recibir en silencio: el navegador cree que sigue suscrito y el servidor
   manda a un endpoint que ya no existe.
   -------------------------------------------------------------------------- */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const anterior = event.oldSubscription || null;
    const nueva = event.newSubscription || await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: anterior ? anterior.options.applicationServerKey : undefined
    }).catch(() => null);

    if (!nueva) return;

    // El service worker no tiene sesión de Supabase, así que no puede escribir
    // en la base por su cuenta. Se avisa a la aplicación, que lo hará en
    // cuanto haya una pestaña abierta con sesión.
    const clientes = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clientes) {
      c.postMessage({
        fuente: 'clidanfi-sw',
        accion: 'resuscribir',
        nueva: nueva.toJSON(),
        anterior: anterior ? anterior.endpoint : null
      });
    }
  })());
});
