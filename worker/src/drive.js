// Respaldo independiente de avisos: no necesita una sesión del navegador.
import { crearCliente } from './supabase.js';
import { generarValoracionPdf } from './valoracion-pdf.js';
import { prepararDocumento, adjuntosDocumento } from './documentos.js';
import { carpetaPaciente, propiedadesPaciente, ubicarArchivo, organizarRespaldos } from './drive-folders.js';
import { respaldarInformesCitas } from './informes-citas.js';

const secretos = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'];
class ContinuarLuego extends Error {}
const comprobarPresupuesto = red => {
  if (red.usadas >= 30) throw new ContinuarLuego('Continuar en la siguiente ejecución');
};
const requerido = async (response, operacion) => {
  if (!response.ok) throw new Error(`${operacion}: HTTP ${response.status}`);
  return response.json();
};

const seguro = s => String(s || '').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 120);
const formatoNombre = '4';
const tiposCortos = { notas: 'Evol.', pacientes: 'Ficha', rutinas: 'Rutina', pagos: 'Recibo' };
export function nombreRespaldo(version, adjunto = null) {
  const nombre = seguro(version.paciente_nombre);
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(version.creado_en || version.contenido.creado_en))
    .map(p => [p.type, p.value]));
  const fecha = `${partes.day}-${partes.month}-${partes.year.slice(-2)} ${partes.hour}-${partes.minute}-${partes.second}`;
  const tipo = adjunto && version.origen === 'notas' ? 'Evid.' : version.origen === 'archivos'
    ? seguro(version.contenido.categoria === 'Consentimiento' ? 'Consent.' : version.contenido.categoria || 'Archivo')
    : tiposCortos[version.origen] || 'HC';
  const titulo = adjunto ? ` - ${seguro(adjunto.titulo)}` : '';
  const extension = adjunto ? (adjunto.ruta?.split('.').pop()?.match(/^[a-z0-9]{1,10}$/i)?.[0] || 'bin') : 'pdf';
  return `${tipo} ${nombre}${titulo}${version.actualizado || version.numero > 1 ? ' - Actualizado' : ''} - ${fecha}.${extension}`;
}

async function identificarEdicion(db, version) {
  const primeras = await db.select('valoraciones_versiones',
    `valoracion_id=eq.${version.valoracion_id || version.contenido.id}&select=id&order=creado_en.asc,id.asc&limit=1`);
  return { ...version, actualizado: !!primeras[0] && primeras[0].id !== version.id };
}

async function subirPdf(version, headers, env, archivoId = null, red = globalThis, carpeta = null) {
  const metadata = {
    name: nombreRespaldo(version), mimeType: 'application/pdf',
    appProperties: { clidanfi_version: version.id, clidanfi_nombre: formatoNombre,
      ...(carpeta ? propiedadesPaciente(version) : {}) },
    ...(!archivoId && carpeta ? { parents: [carpeta] } : {})
  };
  const boundary = `clidanfi_${crypto.randomUUID()}`;
  const bytes = await generarValoracionPdf(version);
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`, bytes,
    `\r\n--${boundary}--`
  ]);
  return requerido(await red.fetch(
    `https://www.googleapis.com/upload/drive/v3/files${archivoId ? '/' + encodeURIComponent(archivoId) : ''}?uploadType=multipart&fields=id`, {
      method: archivoId ? 'PATCH' : 'POST',
      headers: { ...headers, 'Content-Type': `multipart/related; boundary=${boundary}` }, body
    }
  ), archivoId ? 'Convertir respaldo a PDF' : 'Subir respaldo PDF');
}

export async function respaldarValoraciones(env) {
  if (!secretos.every(k => env[k])) return { omitido: 'Drive pendiente de autorización' };
  // Un evento del plan gratuito admite 50 subpeticiones. Reservar margen para
  // confirmar resultados y liberar los reclamos que seguirán en el próximo cron.
  const red = { usadas: 0, fetch: (...args) => { red.usadas++; return fetch(...args); } };
  const token = await requerido(await red.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token'
    })
  }), 'Autorizar Drive');
  const headers = { Authorization: `Bearer ${token.access_token}` };
  // Evita respaldar accidentalmente a la cuenta con la que se creó otro token.
  const cuenta = await requerido(await red.fetch(
    'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { headers }
  ), 'Verificar cuenta Drive');
  if (cuenta.user?.emailAddress?.toLowerCase() !== 'clidanfi@gmail.com') {
    throw new Error('Drive debe estar autorizado por clidanfi@gmail.com');
  }
  const db = crearCliente(env, red.fetch);
  let citas;
  try { citas = await retirarRespaldosCitas(db, headers, red); }
  catch (error) { citas = { error: String(error.message).slice(0, 200) }; }
  // Actualizar nombres anteriores sin cambiar enlaces; convertir JSON si queda alguno.
  const antiguos = await requerido(await red.fetch(
    'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
      q: `trashed = false and (mimeType = 'application/json' or mimeType = 'application/pdf' or appProperties has { key='clidanfi_nombre' and value='3' }) and not appProperties has { key='clidanfi_nombre' and value='${formatoNombre}' }`,
      fields: 'files(id,mimeType,appProperties),nextPageToken', pageSize: '1000'
    }), { headers }
  ), 'Buscar respaldos JSON anteriores');
  let convertidos = 0, conversionesFallidas = 0, renombrados = 0;
  for (const archivo of (antiguos.files || []).filter(a => a.appProperties?.clidanfi_version || a.appProperties?.clidanfi_documento).slice(0, 6)) {
    if (red.usadas >= 22) break;
    if (archivo.appProperties.clidanfi_documento) {
      try {
        const [id, clave] = archivo.appProperties.clidanfi_documento.split(':');
        if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
        const rows = await db.select('documentos_versiones', `id=eq.${id}&limit=1`);
        if (!rows.length) continue;
        if (rows[0].origen === 'citas') continue;
        const adjunto = clave === 'pdf' ? null : adjuntosDocumento(rows[0]).find(a => a.clave === clave);
        if (clave !== 'pdf' && !adjunto) continue;
        await requerido(await red.fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(archivo.id)}?fields=id`, {
          method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: nombreRespaldo(rows[0], adjunto),
            appProperties: { ...archivo.appProperties, clidanfi_nombre: formatoNombre } })
        }), 'Acortar nombre de documento');
        renombrados++;
      } catch { conversionesFallidas++; }
      continue;
    }
    const id = archivo.appProperties.clidanfi_version;
    if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
    try {
      const rows = await db.select('valoraciones_versiones', `id=eq.${id}&limit=1`);
      if (!rows.length) continue;
      const version = await identificarEdicion(db, rows[0]);
      if (archivo.mimeType === 'application/pdf') {
        await requerido(await red.fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(archivo.id)}?fields=id`, {
          method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: nombreRespaldo(version),
            appProperties: { ...archivo.appProperties, clidanfi_version: id, clidanfi_nombre: formatoNombre } })
        }), 'Actualizar nombre de respaldo');
        renombrados++;
      } else {
        await subirPdf(version, headers, env, archivo.id, red);
        convertidos++;
      }
    } catch { conversionesFallidas++; }
  }
  const versiones = await db.rpc('reclamar_respaldos_valoracion');
  let guardados = 0, fallidos = 0;
  for (const version of versiones) {
    const filtro = `id=eq.${version.id}&bloqueo=eq.${version.bloqueo}`;
    try {
      comprobarPresupuesto(red);
      Object.assign(version, await identificarEdicion(db, version));
      // Recupera una subida previa si se perdió la respuesta o falló Supabase.
      const query = new URLSearchParams({
        q: `trashed = false and appProperties has { key='clidanfi_version' and value='${version.id}' }`,
        fields: 'files(id,mimeType,parents,appProperties)', pageSize: '1'
      });
      const existentes = await requerido(await red.fetch(
        `https://www.googleapis.com/drive/v3/files?${query}`, { headers }
      ), 'Buscar respaldo');
      let archivo = existentes.files?.[0];
      const carpeta = await carpetaPaciente(version, db, headers, env, red);
      if (archivo) await ubicarArchivo(archivo, carpeta, version, headers, red);
      if (!archivo || archivo.mimeType !== 'application/pdf') {
        archivo = await subirPdf(version, headers, env, archivo?.id, red, carpeta);
      }
      if (!archivo.id) throw new Error('Drive no devolvió identificador del respaldo');
      await db.update('valoraciones_versiones', filtro, {
        drive_archivo_id: archivo.id, ultimo_error: null, bloqueo: null
      });
      guardados++;
    } catch (error) {
      if (error instanceof ContinuarLuego) {
        await db.update('valoraciones_versiones', filtro, { bloqueo: null, reintentar_en: new Date().toISOString() });
        continue;
      }
      fallidos++;
      await db.update('valoraciones_versiones', filtro, {
        ultimo_error: String(error.message).slice(0, 200), bloqueo: null
      });
    }
  }
  // La cola clínica funciona aunque falte todavía la migración de documentos.
  let documentos;
  try { documentos = red.usadas < 30 ? await respaldarDocumentos(db, headers, env, red) : { diferidos: true }; }
  catch (error) { documentos = { error: String(error.message).slice(0, 200) }; }
  let carpetas;
  try { carpetas = red.usadas < 14 ? await organizarRespaldos(db, headers, env, red) : { diferidos: true }; }
  catch (error) { carpetas = { error: String(error.message).slice(0, 200) }; }
  let informes;
  try { informes = red.usadas < 18 ? await respaldarInformesCitas(db, headers, env, red) : { diferidos: true }; }
  catch (error) { informes = { error: String(error.message).slice(0, 200) }; }
  const restantes = (antiguos.files || []).filter(a => (a.appProperties?.clidanfi_version || a.appProperties?.clidanfi_documento)
    && !red.citasExcluidas?.has(a.id)).length
    - convertidos - renombrados;
  return { guardados, fallidos, convertidos, conversionesFallidas, renombrados,
    renombres_pendientes: antiguos.nextPageToken ? null : restantes, citas, documentos, carpetas, informes };
}

// Solo elimina COPIAS de citas y sus entradas de la cola; nunca la agenda.
// El filtro también cubre instalaciones que aún conservan el trigger antiguo.
export async function retirarRespaldosCitas(db, headers, red = { fetch: (...args) => fetch(...args) }) {
  await db.borrar('documentos_versiones', 'origen=eq.citas&drive_archivo_id=is.null');
  const versiones = await db.select('documentos_versiones',
    'origen=eq.citas&drive_archivo_id=not.is.null&select=id,drive_archivo_id&limit=1000');
  red.citasExcluidas = new Set(versiones.map(v => v.drive_archivo_id));
  let retiradas = 0, fallidas = 0;
  for (const version of versiones.slice(0, 3)) {
    try {
      const response = await red.fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(version.drive_archivo_id)}?fields=id`, {
        method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true })
      });
      if (!response.ok && response.status !== 404 && response.status !== 410) {
        throw new Error(`Retirar copia de cita: HTTP ${response.status}`);
      }
      await db.borrar('documentos_versiones', `id=eq.${version.id}&origen=eq.citas`);
      retiradas++;
    } catch { fallidas++; }
  }
  return { retiradas, fallidas, pendientes: versiones.length - retiradas };
}

async function subirDocumento(version, headers, env, adjunto = null, red = globalThis, cache = new Map(), carpeta) {
  const clave = `${version.id}:${adjunto?.clave || 'pdf'}`;
  if (cache.has(clave)) return cache.get(clave);
  comprobarPresupuesto(red);
  const query = new URLSearchParams({
    q: `trashed = false and appProperties has { key='clidanfi_documento' and value='${clave}' }`,
    fields: 'files(id,parents,appProperties)', pageSize: '1'
  });
  const anteriores = await requerido(await red.fetch(`https://www.googleapis.com/drive/v3/files?${query}`, { headers }), 'Buscar documento');
  if (anteriores.files?.[0]?.id) {
    await ubicarArchivo(anteriores.files[0], carpeta, version, headers, red);
    cache.set(clave, anteriores.files[0].id);
    return anteriores.files[0].id;
  }
  let bytes, mime = 'application/pdf';
  if (adjunto) {
    if (!adjunto.ruta || !adjunto.ruta.startsWith(`${version.paciente_id}/`) || adjunto.ruta.split('/').some(p => p === '..' || p === '.')) {
      throw new Error('Ruta de adjunto no válida');
    }
    const ruta = adjunto.ruta.split('/').map(encodeURIComponent).join('/');
    const response = await red.fetch(`${env.SUPABASE_URL}/storage/v1/object/authenticated/${adjunto.bucket}/${ruta}`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
    });
    if (!response.ok) throw new Error(`Leer adjunto: HTTP ${response.status}`);
    bytes = await response.arrayBuffer();
    mime = response.headers.get('Content-Type') || adjunto.mime || 'application/octet-stream';
  } else bytes = await generarValoracionPdf(prepararDocumento(version));
  const metadata = { name: nombreRespaldo(version, adjunto), mimeType: mime,
    appProperties: { clidanfi_documento: clave, clidanfi_lote: version.id, clidanfi_nombre: formatoNombre,
      ...propiedadesPaciente(version) }, parents: [carpeta] };
  const boundary = `clidanfi_${crypto.randomUUID()}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, bytes, `\r\n--${boundary}--`
  ]);
  const archivo = await requerido(await red.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: { ...headers, 'Content-Type': `multipart/related; boundary=${boundary}` }, body
  }), 'Subir documento');
  if (!archivo.id) throw new Error('Drive no devolvió identificador del documento');
  cache.set(clave, archivo.id);
  return archivo.id;
}

export async function respaldarDocumentos(db, headers, env, red = globalThis) {
  const versiones = await db.rpc('reclamar_respaldos_documento');
  versiones.sort((a, b) => String(a.creado_en).localeCompare(String(b.creado_en)) || a.id.localeCompare(b.id));
  let guardados = 0, fallidos = 0;
  for (const version of versiones) {
    const filtro = `id=eq.${version.id}&bloqueo=eq.${version.bloqueo}`;
    if (version.origen === 'citas') {
      await db.borrar('documentos_versiones', `${filtro}&origen=eq.citas`);
      continue;
    }
    try {
      comprobarPresupuesto(red);
      const carpeta = await carpetaPaciente(version, db, headers, env, red);
      // Recuperar todos los adjuntos de este intento en una consulta. Una nota
      // con muchas fotos debe poder avanzar entre tandas, sin gastar su cupo
      // volviendo a consultar cada foto que ya se subió.
      const cache = new Map();
      let pagina;
      do {
        comprobarPresupuesto(red);
        const query = new URLSearchParams({
          q: `trashed = false and appProperties has { key='clidanfi_lote' and value='${version.id}' }`,
          fields: 'files(id,parents,appProperties),nextPageToken', pageSize: '1000',
          ...(pagina ? { pageToken: pagina } : {})
        });
        const lote = await requerido(await red.fetch(`https://www.googleapis.com/drive/v3/files?${query}`, { headers }), 'Buscar adjuntos respaldados');
        for (const a of lote.files || []) {
          comprobarPresupuesto(red);
          await ubicarArchivo(a, carpeta, version, headers, red);
          cache.set(a.appProperties?.clidanfi_documento, a.id);
        }
        pagina = lote.nextPageToken;
      } while (pagina);
      let id;
      if (version.origen !== 'archivos') id = await subirDocumento(version, headers, env, null, red, cache, carpeta);
      for (const adjunto of adjuntosDocumento(version)) {
        const adjuntoId = await subirDocumento(version, headers, env, adjunto, red, cache, carpeta);
        if (!id) id = adjuntoId;
      }
      if (!id) throw new Error('Documento sin archivo para respaldar');
      await db.update('documentos_versiones', filtro, { drive_archivo_id: id, bloqueo: null, ultimo_error: null });
      guardados++;
    } catch (error) {
      if (error instanceof ContinuarLuego) {
        await db.update('documentos_versiones', filtro, { bloqueo: null, reintentar_en: new Date().toISOString() });
        continue;
      }
      fallidos++;
      await db.update('documentos_versiones', filtro, { bloqueo: null, ultimo_error: String(error.message).slice(0, 200) });
    }
  }
  return { guardados, fallidos };
}
