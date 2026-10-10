// Respaldo independiente de avisos: no necesita una sesión del navegador.
import { crearCliente } from './supabase.js';
import { generarValoracionPdf } from './valoracion-pdf.js';

const secretos = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'];
const requerido = async (response, operacion) => {
  if (!response.ok) throw new Error(`${operacion}: HTTP ${response.status}`);
  return response.json();
};

export function nombreRespaldo(version) {
  const nombre = version.paciente_nombre.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 120);
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(version.creado_en || version.contenido.creado_en))
    .map(p => [p.type, p.value]));
  const fecha = `${partes.day}-${partes.month}-${partes.year} ${partes.hour}-${partes.minute}-${partes.second}`;
  return `${nombre} - ${fecha} - Valoración inicial.pdf`;
}

async function subirPdf(version, headers, env, archivoId = null) {
  const metadata = {
    name: nombreRespaldo(version), mimeType: 'application/pdf',
    appProperties: { clidanfi_version: version.id, clidanfi_nombre: '2' },
    ...(!archivoId && env.GOOGLE_DRIVE_FOLDER_ID ? { parents: [env.GOOGLE_DRIVE_FOLDER_ID] } : {})
  };
  const boundary = `clidanfi_${crypto.randomUUID()}`;
  const bytes = await generarValoracionPdf(version);
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`, bytes,
    `\r\n--${boundary}--`
  ]);
  return requerido(await fetch(
    `https://www.googleapis.com/upload/drive/v3/files${archivoId ? '/' + encodeURIComponent(archivoId) : ''}?uploadType=multipart&fields=id`, {
      method: archivoId ? 'PATCH' : 'POST',
      headers: { ...headers, 'Content-Type': `multipart/related; boundary=${boundary}` }, body
    }
  ), archivoId ? 'Convertir respaldo a PDF' : 'Subir respaldo PDF');
}

export async function respaldarValoraciones(env) {
  if (!secretos.every(k => env[k])) return { omitido: 'Drive pendiente de autorización' };
  const token = await requerido(await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token'
    })
  }), 'Autorizar Drive');
  const headers = { Authorization: `Bearer ${token.access_token}` };
  // Evita respaldar accidentalmente a la cuenta con la que se creó otro token.
  const cuenta = await requerido(await fetch(
    'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { headers }
  ), 'Verificar cuenta Drive');
  if (cuenta.user?.emailAddress?.toLowerCase() !== 'clidanfi@gmail.com') {
    throw new Error('Drive debe estar autorizado por clidanfi@gmail.com');
  }
  const db = crearCliente(env);
  // Actualizar nombres anteriores sin cambiar enlaces; convertir JSON si queda alguno.
  const antiguos = await requerido(await fetch(
    'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
      q: "trashed = false and (mimeType = 'application/json' or mimeType = 'application/pdf') and not appProperties has { key='clidanfi_nombre' and value='2' }",
      fields: 'files(id,mimeType,appProperties)', pageSize: '100'
    }), { headers }
  ), 'Buscar respaldos JSON anteriores');
  let convertidos = 0, conversionesFallidas = 0, renombrados = 0;
  for (const archivo of (antiguos.files || []).filter(a => a.appProperties?.clidanfi_version).slice(0, 10)) {
    const id = archivo.appProperties.clidanfi_version;
    if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
    try {
      const rows = await db.select('valoraciones_versiones', `id=eq.${id}&limit=1`);
      if (!rows.length) continue;
      if (archivo.mimeType === 'application/pdf') {
        await requerido(await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(archivo.id)}?fields=id`, {
          method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: nombreRespaldo(rows[0]),
            appProperties: { clidanfi_version: id, clidanfi_nombre: '2' } })
        }), 'Actualizar nombre de respaldo');
        renombrados++;
      } else {
        await subirPdf(rows[0], headers, env, archivo.id);
        convertidos++;
      }
    } catch { conversionesFallidas++; }
  }
  const versiones = await db.rpc('reclamar_respaldos_valoracion');
  let guardados = 0, fallidos = 0;
  for (const version of versiones) {
    const filtro = `id=eq.${version.id}&bloqueo=eq.${version.bloqueo}`;
    try {
      // Recupera una subida previa si se perdió la respuesta o falló Supabase.
      const query = new URLSearchParams({
        q: `trashed = false and appProperties has { key='clidanfi_version' and value='${version.id}' }`,
        fields: 'files(id,mimeType)', pageSize: '1'
      });
      const existentes = await requerido(await fetch(
        `https://www.googleapis.com/drive/v3/files?${query}`, { headers }
      ), 'Buscar respaldo');
      let archivo = existentes.files?.[0];
      if (!archivo || archivo.mimeType !== 'application/pdf') {
        archivo = await subirPdf(version, headers, env, archivo?.id);
      }
      if (!archivo.id) throw new Error('Drive no devolvió identificador del respaldo');
      await db.update('valoraciones_versiones', filtro, {
        drive_archivo_id: archivo.id, ultimo_error: null, bloqueo: null
      });
      guardados++;
    } catch (error) {
      fallidos++;
      await db.update('valoraciones_versiones', filtro, {
        ultimo_error: String(error.message).slice(0, 200), bloqueo: null
      });
    }
  }
  return { guardados, fallidos, convertidos, conversionesFallidas, renombrados };
}
