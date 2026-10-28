// Los nombres sirven para adoptar carpetas existentes; después manda el UUID.
// No cambia permisos ni crea enlaces públicos.
const FOLDER = 'application/vnd.google-apps.folder';
const escapar = valor => String(valor).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const json = async (red, url, options, accion) => {
  const response = await red.fetch(url, options);
  if (!response.ok) throw new Error(`${accion}: HTTP ${response.status}`);
  return response.json();
};
const buscar = (q, headers, red) => json(red,
  'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
    q, fields: 'files(id,name,parents,appProperties),nextPageToken', pageSize: '100'
  }), { headers }, 'Buscar carpeta de paciente');

export async function carpetaPaciente(version, db, headers, env, red) {
  const id = version.paciente_id;
  let nombre = String(version.paciente_nombre || '').trim();
  if (!id || !nombre) throw new Error('El respaldo no identifica al paciente');
  red.carpetasPacientes ||= new Map();
  if (red.carpetasPacientes.has(id)) return red.carpetasPacientes.get(id);
  const base = `trashed = false and mimeType = '${FOLDER}'`;
  const identificadas = await buscar(`${base} and appProperties has { key='clidanfi_paciente' and value='${escapar(id)}' }`, headers, red);
  if (identificadas.nextPageToken || identificadas.files?.length > 1) throw new Error('Hay varias carpetas vinculadas al mismo paciente');
  let carpeta = identificadas.files?.[0];
  if (!carpeta) {
    const actuales = await db.select('pacientes', `id=eq.${encodeURIComponent(id)}&select=nombre&limit=1`);
    nombre = String(actuales[0]?.nombre || nombre).trim();
    const encontradas = await buscar(`${base} and name = '${escapar(nombre)}'${env.GOOGLE_DRIVE_FOLDER_ID ? ` and '${escapar(env.GOOGLE_DRIVE_FOLDER_ID)}' in parents` : ''}`, headers, red);
    // Una carpeta vinculada a otro paciente nunca se reutiliza por su nombre.
    const candidatas = (encontradas.files || []).filter(c => !c.appProperties?.clidanfi_paciente || c.appProperties.clidanfi_paciente === id);
    if (encontradas.nextPageToken || candidatas.length > 1) throw new Error('Hay carpetas con nombres repetidos; vincula la correcta al paciente');
    carpeta = candidatas[0];
    if (carpeta) {
      const pacientes = await db.select('pacientes', `nombre=eq.${encodeURIComponent(nombre)}&select=id&limit=2`);
      if (pacientes.length !== 1 || pacientes[0].id !== id) throw new Error('Nombre de paciente ambiguo; no se puede adoptar su carpeta automáticamente');
      await json(red, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(carpeta.id)}?fields=id`, {
        method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ appProperties: { ...carpeta.appProperties, clidanfi_paciente: id } })
      }, 'Vincular carpeta de paciente');
    } else {
      // No crea otra carpeta si el nombre corresponde a un homónimo vinculado.
      if (encontradas.files?.length) throw new Error('La carpeta con ese nombre pertenece a otro paciente');
      carpeta = await json(red, 'https://www.googleapis.com/drive/v3/files?fields=id', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nombre, mimeType: FOLDER, appProperties: { clidanfi_paciente: id },
          ...(env.GOOGLE_DRIVE_FOLDER_ID ? { parents: [env.GOOGLE_DRIVE_FOLDER_ID] } : {}) })
      }, 'Crear carpeta de paciente');
    }
  }
  if (!carpeta.id) throw new Error('Drive no devolvió identificador de carpeta');
  red.carpetasPacientes.set(id, carpeta.id);
  return carpeta.id;
}

export const propiedadesPaciente = version => ({ clidanfi_paciente: version.paciente_id, clidanfi_carpeta: '1' });

export async function ubicarArchivo(archivo, carpeta, version, headers, red) {
  if (!Array.isArray(archivo.parents)) archivo = await json(red,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(archivo.id)}?fields=id,parents,appProperties`,
    { headers }, 'Consultar carpeta del respaldo');
  if (archivo.parents?.includes(carpeta) && archivo.appProperties?.clidanfi_paciente === version.paciente_id && archivo.appProperties?.clidanfi_carpeta === '1') return;
  const query = new URLSearchParams({ fields: 'id' });
  if (!archivo.parents?.includes(carpeta)) query.set('addParents', carpeta);
  const anteriores = (archivo.parents || []).filter(p => p !== carpeta);
  if (anteriores.length) query.set('removeParents', anteriores.join(','));
  await json(red, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(archivo.id)}?${query}`, {
    method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ appProperties: { ...archivo.appProperties, ...propiedadesPaciente(version) } })
  }, 'Mover respaldo a carpeta de paciente');
}

export async function organizarRespaldos(db, headers, env, red) {
  const resultado = { organizados: 0, fallidos: 0 };
  const listado = await json(red, 'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
    q: `trashed = false and (mimeType = 'application/pdf' or mimeType = 'application/json' or appProperties has { key='clidanfi_nombre' and value='4' } or appProperties has { key='clidanfi_nombre' and value='3' }) and not appProperties has { key='clidanfi_carpeta' and value='1' }`,
    fields: 'files(id,parents,appProperties),nextPageToken', pageSize: '1000'
  }), { headers }, 'Buscar respaldos sin carpeta de paciente');
  for (const archivo of listado.files || []) {
    if (resultado.organizados >= 2 || red.usadas >= 14) break;
    try {
      const props = archivo.appProperties || {};
      const documento = props.clidanfi_documento;
      const id = documento ? documento.split(':')[0] : props.clidanfi_version;
      if (!/^[0-9a-f-]{36}$/i.test(id || '')) continue;
      const rows = await db.select(documento ? 'documentos_versiones' : 'valoraciones_versiones', `id=eq.${id}&limit=1`);
      if (!rows[0] || rows[0].origen === 'citas') continue;
      const carpeta = await carpetaPaciente(rows[0], db, headers, env, red);
      await ubicarArchivo(archivo, carpeta, rows[0], headers, red);
      resultado.organizados++;
    } catch { resultado.fallidos++; }
  }
  return resultado;
}
