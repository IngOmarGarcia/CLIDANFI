/* ==========================================================================
   CLIDANFI · Worker de avisos  ·  Cloudflare Workers + Cron Triggers

   Dos recordatorios, los dos dirigidos AL FISIO:

     · recordatorio_dia  18:00 hora de la clínica. Resumen de las citas de
                         mañana con el mensaje de WhatsApp ya redactado para
                         cada paciente.
     · previo_40         40 minutos antes de cada sesión.

   POR QUÉ NO PUEDE VIVIR EN EL NAVEGADOR
   --------------------------------------
   Un `setTimeout` necesita la pestaña abierta. A las 18:00 la aplicación
   suele estar cerrada, y 40 minutos antes de una sesión el fisio está con
   otro paciente. Un Worker con Cron Trigger corre en la infraestructura de
   Cloudflare sin que haya nadie mirando: es la única pieza del sistema que
   no depende de que alguien tenga CLIDANFI abierto.

   POR QUÉ EL AVISO ES AL FISIO Y NO AL PACIENTE
   ---------------------------------------------
   Mandar WhatsApp de forma automática exige la API de negocio de Meta: es de
   pago, hay que verificar el número de la clínica y las plantillas se
   aprueban una por una. En su lugar, el Worker avisa al fisio con los
   enlaces `wa.me` ya armados y el envío lo confirma una persona con un
   toque. Cuesta cero, funciona desde el primer día, y —esto importa más de
   lo que parece— evita que salga un recordatorio automático a quien acaba de
   cancelar.
   ========================================================================== */

import { enviarPush } from './webpush.js';
import {
  crearCliente, citasEntre, suscripcionesDeFisios,
  apuntarAviso, bajaSuscripcion, marcarEnvioOk
} from './supabase.js';

/* --------------------------------------------------------------------------
   Hora local de la clínica

   Cloudflare dispara los crons en UTC. La clínica razona en su hora local, y
   entre las dos hay un desfase que además cambia con el horario de verano en
   buena parte del mundo. Se resuelve con `Intl`, que conoce las reglas de
   cada zona, en vez de restar horas a mano.
   -------------------------------------------------------------------------- */
const zonaDe = (env) => env.TZ_CLINICA || 'America/Mazatlan';

/** Hora (0-23) que marca el reloj de la clínica en este instante. */
function horaLocal(fecha, zona) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hour: 'numeric', hour12: false
  }).formatToParts(fecha);
  return Number((partes.find((p) => p.type === 'hour') || {}).value);
}

/** Formatea una hora para leerla de un vistazo en la notificación. */
const horaTexto = (iso, zona) =>
  new Intl.DateTimeFormat('es-MX', {
    timeZone: zona, hour: '2-digit', minute: '2-digit', hour12: true
  }).format(new Date(iso));

/**
 * Ventana [desde, hasta] del día siguiente en hora de la clínica, expresada
 * en instantes UTC.
 *
 * No vale con «mañana a las 00:00» del reloj del servidor: en UTC eso puede
 * ser todavía hoy por la tarde en la clínica, y el resumen saldría con las
 * citas equivocadas.
 */
function mananaEnLaClinica(ahora, zona) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const manana = new Date(ahora.getTime() + 24 * 60 * 60 * 1000);
  const dia = fmt.format(manana);                       // YYYY-MM-DD local

  // El desfase de la zona en ese día, para convertir el rango local a UTC.
  const sonda = new Date(`${dia}T12:00:00Z`);
  const local = new Date(sonda.toLocaleString('en-US', { timeZone: zona }));
  const desfaseMin = Math.round((sonda - local) / 60000);

  const desde = new Date(`${dia}T00:00:00Z`).getTime() + desfaseMin * 60000;
  const hasta = new Date(`${dia}T23:59:59Z`).getTime() + desfaseMin * 60000;
  return { dia, desde: new Date(desde).toISOString(), hasta: new Date(hasta).toISOString() };
}

/* --------------------------------------------------------------------------
   Teléfono y enlace de WhatsApp

   ⚠ Espejo de `telWhatsApp` / `waLink` en js/ui.js. Están duplicados porque
   ui.js es un IIFE de navegador y el Worker no puede importarlo. Si cambia
   una regla de normalización, hay que cambiarla en los dos sitios; el test
   `scripts/test-funciones.js` comprueba las dos implementaciones con los
   mismos casos para que no se separen en silencio.
   -------------------------------------------------------------------------- */
export function telWhatsApp(tel, lada = '52') {
  // Los ceros de cabecera son prefijos de marcación (00 internacional, 044 y
  // 045 de la vieja numeración móvil), nunca parte del número.
  const d = String(tel ?? '').replace(/\D+/g, '').replace(/^0+/, '');
  if (!d) return '';
  const conPais = d.length === 10 ? lada + d : d;   // 10 dígitos = nacional
  return conPais.length >= 10 && conPais.length <= 15 ? conPais : '';  // E.164
}

export const waLink = (tel, mensaje = '', lada = '52') => {
  const n = telWhatsApp(tel, lada);
  return n ? `https://wa.me/${n}${mensaje ? `?text=${encodeURIComponent(mensaje)}` : ''}` : '';
};

/* ==========================================================================
   REPARTO DE UNA NOTIFICACIÓN
   ========================================================================== */

/**
 * Manda el mismo aviso a todos los aparatos del fisio.
 *
 * Los envíos van en paralelo porque son independientes y el Worker tiene un
 * presupuesto de tiempo acotado. Un aparato que falla no arrastra a los
 * demás: cada resultado se atiende por separado.
 */
async function repartir(db, suscripciones, carga, vapid) {
  const resultados = await Promise.all(
    suscripciones.map(async (s) => ({ s, r: await enviarPush(s, carga, vapid) })));

  let entregados = 0;
  for (const { s, r } of resultados) {
    if (r.ok) {
      entregados++;
      await marcarEnvioOk(db, s.id).catch(() => {});
    } else if (r.caducada) {
      // 404/410: el navegador se desinstaló o revocó el permiso. Si no se
      // borra, el cron la reintentaría en cada pasada para siempre.
      console.log(`[avisos] Suscripción caducada, se da de baja: ${s.id}`);
      await bajaSuscripcion(db, s.id).catch(() => {});
    } else {
      console.warn(`[avisos] Fallo ${r.estado} en ${s.id}: ${r.detalle}`);
    }
  }
  return entregados;
}

/* ==========================================================================
   1 · RECORDATORIO DE LAS 18:00  ·  las citas de mañana
   ========================================================================== */
async function recordatorioDelDia(env, db, vapid) {
  const zona = zonaDe(env);
  const { dia, desde, hasta } = mananaEnLaClinica(new Date(), zona);

  const citas = await citasEntre(db, desde, hasta);
  if (!citas || !citas.length) {
    return { tipo: 'recordatorio_dia', dia, citas: 0, enviados: 0, nota: 'sin citas mañana' };
  }

  // Solo las que no se hayan avisado ya. Si el cron se dispara dos veces —o
  // se relanza a mano— el fisio no recibe el resumen repetido.
  const nuevas = [];
  for (const c of citas) {
    const { nuevo } = await apuntarAviso(db, 'recordatorio_dia', c.id, dia);
    if (nuevo) nuevas.push(c);
  }
  if (!nuevas.length) {
    return { tipo: 'recordatorio_dia', dia, citas: citas.length, enviados: 0, nota: 'ya se había avisado' };
  }

  const suscripciones = await suscripcionesDeFisios(db);
  if (!suscripciones.length) {
    return { tipo: 'recordatorio_dia', dia, citas: nuevas.length, enviados: 0, nota: 'ningún aparato suscrito' };
  }

  const clinica = env.NOMBRE_CLINICA || 'CLIDANFI';
  const lada = String(env.LADA_PAIS || '52');

  // El mensaje de cada paciente viaja YA REDACTADO dentro de la notificación:
  // así el fisio toca una vez y se abre WhatsApp listo para enviar, sin tener
  // que abrir la aplicación ni buscar al paciente.
  const lista = nuevas.map((c) => {
    const p = c.pacientes || {};
    const hora = horaTexto(c.inicia_en, zona);
    const mensaje =
      `Hola ${p.nombre || ''}, le recordamos su cita de fisioterapia en ${clinica} ` +
      `mañana a las ${hora}. Si necesita reagendar, responda a este mensaje. ¡Le esperamos!`;

    return {
      cita_id: c.id,
      nombre: p.nombre || 'Paciente',
      hora,
      tiene_telefono: !!telWhatsApp(p.telefono, lada),
      wa: waLink(p.telefono, mensaje, lada)
    };
  });

  const sinTelefono = lista.filter((x) => !x.tiene_telefono).length;

  const enviados = await repartir(db, suscripciones, {
    tipo: 'recordatorio_dia',
    titulo: `${nuevas.length} cita${nuevas.length === 1 ? '' : 's'} mañana`,
    cuerpo: sinTelefono
      ? `Toca para mandar los recordatorios. ${sinTelefono} sin teléfono utilizable.`
      : 'Toca para mandar los recordatorios por WhatsApp.',
    url: '/#/t/agenda',
    dia,
    pacientes: lista
  }, vapid);

  return { tipo: 'recordatorio_dia', dia, citas: nuevas.length, enviados, sin_telefono: sinTelefono };
}

/* ==========================================================================
   2 · AVISO 40 MINUTOS ANTES  ·  una sesión concreta
   ========================================================================== */
async function avisoPrevio(env, db, vapid) {
  const zona = zonaDe(env);
  const minutos = Number(env.MINUTOS_ANTES || 40);
  const ahora = Date.now();

  // La ventana es más ancha que el intervalo del cron (5 min) a propósito:
  // con una ventana exacta, un retraso de unos segundos en el disparo dejaría
  // una cita sin aviso para siempre. Que una cita entre en dos pasadas no
  // importa, porque `avisos_enviados` solo deja mandarla una vez.
  const desde = new Date(ahora + (minutos - 5) * 60000).toISOString();
  const hasta = new Date(ahora + (minutos + 5) * 60000).toISOString();

  const citas = await citasEntre(db, desde, hasta);
  if (!citas || !citas.length) return { tipo: 'previo_40', citas: 0, enviados: 0 };

  const suscripciones = await suscripcionesDeFisios(db);
  if (!suscripciones.length) {
    return { tipo: 'previo_40', citas: citas.length, enviados: 0, nota: 'ningún aparato suscrito' };
  }

  let enviados = 0, avisadas = 0;

  for (const c of citas) {
    const { nuevo } = await apuntarAviso(db, 'previo_40', c.id, c.inicia_en);
    if (!nuevo) continue;                      // ya se avisó en una pasada anterior

    const p = c.pacientes || {};
    const faltan = Math.max(1, Math.round((new Date(c.inicia_en).getTime() - ahora) / 60000));

    avisadas++;
    enviados += await repartir(db, suscripciones, {
      tipo: 'previo_40',
      titulo: `${p.nombre || 'Paciente'} en ${faltan} min`,
      cuerpo: `${horaTexto(c.inicia_en, zona)} · ${c.motivo || 'Sesión de rehabilitación'}`,
      url: '/#/t/agenda',
      cita_id: c.id,
      paciente: p.nombre || 'Paciente',
      hora: horaTexto(c.inicia_en, zona)
    }, vapid);
  }

  return { tipo: 'previo_40', citas: avisadas, enviados };
}

/* ==========================================================================
   ENTRADA
   ========================================================================== */

const vapidDe = (env) => {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    throw new Error('Faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY. Genéralas con `npm run vapid`.');
  }
  return {
    publica: env.VAPID_PUBLIC_KEY,
    privada: env.VAPID_PRIVATE_KEY,
    // El servicio push exige un contacto para poder avisar si algo va mal.
    contacto: env.VAPID_CONTACTO || 'mailto:admin@clidanfi.local'
  };
};

/** El cron horario es el del resumen diario; el de 5 minutos, el de los 40 min. */
const CRON_DIARIO = '0 * * * *';

/**
 * @param {string} cron    expresión que disparó la ejecución
 * @param {boolean} forzar salta la comprobación de la hora (disparo manual)
 */
async function ejecutar(cron, env, forzar = false) {
  const db = crearCliente(env);
  const vapid = vapidDe(env);
  const zona = zonaDe(env);

  if (cron !== CRON_DIARIO) return avisoPrevio(env, db, vapid);

  // El resumen se declara CADA HORA y se filtra aquí, en vez de fijar una
  // hora UTC en wrangler.toml. Así el horario de verano no desplaza el aviso
  // —Intl conoce las reglas de la zona— y mover la clínica de huso es cambiar
  // una variable, no reescribir el cron.
  const objetivo = Number(env.HORA_RECORDATORIO || 18);
  const hora = horaLocal(new Date(), zona);
  if (!forzar && hora !== objetivo) {
    return { omitido: `son las ${hora}:00 en ${zona}; el resumen sale a las ${objetivo}:00` };
  }
  return recordatorioDelDia(env, db, vapid);
}

export default {
  /** Disparo automático por Cron Trigger. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      ejecutar(event.cron, env)
        .then((r) => console.log('[avisos]', JSON.stringify(r)))
        .catch((e) => console.error('[avisos] ERROR:', e && e.message)));
  },

  /**
   * HTTP. Existe para dos cosas y ninguna devuelve datos de pacientes:
   *
   *   GET  /salud     comprobar que el Worker vive y tiene sus variables.
   *   POST /disparar  lanzar una tanda a mano para probarla sin esperar al
   *                   cron. Va protegido por `WORKER_SECRET`, porque
   *                   dispararlo repetidamente sería un modo barato de
   *                   incordiar al fisio a notificaciones.
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/salud') {
      return Response.json({
        ok: true,
        zona: zonaDe(env),
        hora_local: horaLocal(new Date(), zonaDe(env)),
        configurado: {
          supabase: !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
          vapid: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)
        }
      });
    }

    if (url.pathname === '/disparar' && request.method === 'POST') {
      const secreto = request.headers.get('x-worker-secret');
      if (!env.WORKER_SECRET || secreto !== env.WORKER_SECRET) {
        return new Response('No autorizado', { status: 401 });
      }
      try {
        // El disparo manual salta la comprobación de la hora: si no, probar
        // el resumen obligaría a esperar a que fueran las 18:00.
        const esDiario = url.searchParams.get('tipo') === 'dia';
        return Response.json(await ejecutar(esDiario ? CRON_DIARIO : '*/5 * * * *', env, esDiario));
      } catch (e) {
        return Response.json({ error: String(e && e.message || e) }, { status: 500 });
      }
    }

    return new Response('CLIDANFI · worker de avisos', { status: 200 });
  }
};
