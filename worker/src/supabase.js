/* ==========================================================================
   CLIDANFI · supabase.js  ·  acceso a la base desde el Worker

   El Worker entra con la SERVICE_ROLE key, que se salta RLS. Es la única
   forma de que un cron pueda leer la agenda a las 18:00, cuando no hay
   ninguna sesión abierta que autorice la consulta.

   Eso obliga a una disciplina: aquí NO se atiende a nadie de fuera. El
   Worker no expone un endpoint que devuelva datos de pacientes; solo lee lo
   que necesita para armar el aviso y escribe la bitácora de envíos. La
   service_role key nunca sale de las variables secretas del Worker y jamás
   viaja al navegador.
   ========================================================================== */

/**
 * Cliente REST mínimo sobre PostgREST.
 *
 * No se usa `@supabase/supabase-js` a propósito: arrastra dependencias que
 * inflan el bundle del Worker y aquí solo hacen falta cuatro consultas.
 */
export function crearCliente(env) {
  const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const clave = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!base || !clave) {
    throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en las variables del Worker.');
  }

  const pedir = async (ruta, opciones = {}) => {
    const res = await fetch(`${base}/rest/v1/${ruta}`, {
      ...opciones,
      headers: {
        apikey: clave,
        Authorization: `Bearer ${clave}`,
        'Content-Type': 'application/json',
        ...(opciones.headers || {})
      }
    });

    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      throw new Error(`Supabase ${res.status} en ${ruta}: ${detalle.slice(0, 300)}`);
    }
    if (res.status === 204) return null;
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  };

  return {
    /** GET con filtros ya escritos en formato PostgREST. */
    select: (tabla, query) => pedir(`${tabla}?${query}`),

    /** INSERT que no falla si la fila ya existía (idempotencia del cron). */
    insertarSiFalta: (tabla, fila) =>
      pedir(tabla, {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify(fila)
      }),

    update: (tabla, query, patch) =>
      pedir(`${tabla}?${query}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(patch)
      }),

    borrar: (tabla, query) =>
      pedir(`${tabla}?${query}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
  };
}

/* --------------------------------------------------------------------------
   Consultas concretas
   -------------------------------------------------------------------------- */

/** Citas vivas dentro de una ventana de tiempo, con teléfono del paciente. */
export const citasEntre = (db, desdeISO, hastaISO) =>
  db.select('citas',
    `select=id,inicia_en,duracion_min,motivo,estado,pacientes(id,nombre,telefono)` +
    `&estado=eq.agendada` +
    `&inicia_en=gte.${encodeURIComponent(desdeISO)}` +
    `&inicia_en=lte.${encodeURIComponent(hastaISO)}` +
    `&order=inicia_en.asc`);

/** Suscripciones push de los fisioterapeutas. */
export const suscripcionesDeFisios = async (db) => {
  const perfiles = await db.select('perfiles', 'select=id&rol=eq.fisio');
  if (!perfiles || !perfiles.length) return [];

  const ids = perfiles.map((p) => p.id).join(',');
  return (await db.select('push_suscripciones',
    `select=id,endpoint,p256dh,auth,usuario_id&usuario_id=in.(${ids})`)) || [];
};

/**
 * Marca un aviso como enviado y dice si ya lo estaba.
 *
 * La garantía de «una sola vez» es la clave primaria (tipo, cita_id), no
 * este código: el cron de los 40 minutos corre cada 5, así que la misma cita
 * entra en varias pasadas y dos de ellas podrían solaparse. Con
 * `resolution=ignore-duplicates` la segunda no devuelve fila, y eso es lo
 * que se interpreta como «ya se mandó».
 */
export const apuntarAviso = async (db, tipo, citaId, detalle = '') => {
  const filas = await db.insertarSiFalta('avisos_enviados',
    { tipo, cita_id: citaId, detalle: String(detalle).slice(0, 200) });
  return { nuevo: Array.isArray(filas) && filas.length > 0 };
};

/** Suscripción que ya no existe: se borra para no reintentarla eternamente. */
export const bajaSuscripcion = (db, id) => db.borrar('push_suscripciones', `id=eq.${id}`);

/** Sello de último envío correcto, para que el fisio vea qué aparato responde. */
export const marcarEnvioOk = (db, id) =>
  db.update('push_suscripciones', `id=eq.${id}`, { ultimo_ok: new Date().toISOString(), fallos: 0 });

/** Un fallo que no es caducidad: se cuenta, pero no se da de baja todavía. */
export const contarFallo = async (db, id, fallosPrevios) =>
  db.update('push_suscripciones', `id=eq.${id}`, { fallos: (fallosPrevios || 0) + 1 });
