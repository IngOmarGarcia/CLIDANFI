// Respaldo independiente de avisos: no necesita una sesión del navegador.
import { crearCliente } from './supabase.js';

const secretos = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'];
const requerido = async (response, operacion) => {
  if (!response.ok) throw new Error(`${operacion}: HTTP ${response.status}`);
  return response.json();
};

export function nombreRespaldo(version) {
  const nombre = version.paciente_nombre.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 120);
  const fecha = new Date(version.contenido.creado_en).toISOString().replace(/[:.]/g, '-');
  return `${nombre} - ${fecha} - ${version.id}.json`;
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
  const versiones = await db.rpc('reclamar_respaldos_valoracion');
  let guardados = 0, fallidos = 0;
  for (const version of versiones) {
    const filtro = `id=eq.${version.id}&bloqueo=eq.${version.bloqueo}`;
    try {
      // Recupera una subida previa si se perdió la respuesta o falló Supabase.
      const query = new URLSearchParams({
        q: `trashed = false and appProperties has { key='clidanfi_version' and value='${version.id}' }`,
        fields: 'files(id)', pageSize: '1'
      });
      const existentes = await requerido(await fetch(
        `https://www.googleapis.com/drive/v3/files?${query}`, { headers }
      ), 'Buscar respaldo');
      let archivo = existentes.files?.[0];
      if (!archivo) {
        const metadata = {
          name: nombreRespaldo(version), mimeType: 'application/json',
          appProperties: { clidanfi_version: version.id },
          ...(env.GOOGLE_DRIVE_FOLDER_ID ? { parents: [env.GOOGLE_DRIVE_FOLDER_ID] } : {})
        };
        const boundary = `clidanfi_${crypto.randomUUID()}`;
        const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({
            paciente_nombre: version.paciente_nombre, version_id: version.id,
            guardado_en: version.creado_en, valoracion: version.contenido
          }, null, 2)}\r\n--${boundary}--`;
        archivo = await requerido(await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
            method: 'POST', headers: { ...headers, 'Content-Type': `multipart/related; boundary=${boundary}` }, body
          }
        ), 'Subir respaldo');
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
  return { guardados, fallidos };
}
