/* ==========================================================================
   CLIDANFI · sw.js  ·  Service Worker

   Su único trabajo es recibir las notificaciones que manda el Worker de
   Cloudflare y abrir la pantalla correcta cuando el fisio las toca.

   NO cachea nada. Es deliberado: un service worker que sirve archivos
   guardados es la forma más rápida de que el fisio siga viendo la versión de
   la semana pasada después de un despliegue, y aquí eso significaría trabajar
   sobre una agenda desactualizada. El caché lo gobiernan las cabeceras de
   Cloudflare, que es donde se puede corregir sin esperar a que caduque nada.

   Vive en la RAÍZ del sitio a propósito: un service worker solo controla su
   propia carpeta hacia abajo, y desde `/js/` no podría gobernar `/`.
   ========================================================================== */

// Un service worker nuevo se queda «esperando» hasta que se cierran todas las
// pestañas. Para avisos eso es inaceptable: el fisio actualizaría y seguiría
// con el de antes. Estas dos líneas hacen que el nuevo tome el control ya.
self.addEventListener('install', (e) => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

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
