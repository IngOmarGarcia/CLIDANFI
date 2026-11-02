// Auditoría de lectura: no imprime datos clínicos, rutas ni credenciales.
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const opciones = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, opciones);
const ok = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const tablas = ['pacientes', 'pacientes_ordenados', 'citas', 'asistencias', 'notas', 'archivos',
  'valoraciones', 'rutinas', 'rutina_items', 'pagos', 'ejercicios', 'documentos_versiones', 'valoraciones_versiones'];
async function filas(cliente, tabla, columnas = 'id') {
  const resultado = [];
  for (let desde = 0; ; desde += 500) {
    const lote = ok(await cliente.from(tabla).select(columnas).order('id').range(desde, desde + 499));
    resultado.push(...lote);
    if (lote.length < 500) return resultado;
  }
}
const firma = rows => createHash('sha256').update(rows.map(r => r.id).sort().join('\n')).digest('hex');
(async () => {
  const perfiles = ok(await admin.from('perfiles').select('id,nombre').eq('rol', 'fisio'));
  const base = Object.fromEntries(await Promise.all(tablas.map(async t => [t, await filas(admin, t)])));
  const archivos = await filas(admin, 'archivos', 'id,ruta');
  const notas = await filas(admin, 'notas', 'id,adjuntos');
  const objetos = [
    ...archivos.filter(a => a.ruta).map(a => ({ bucket: 'expedientes', ruta: a.ruta })),
    ...notas.flatMap(n => (n.adjuntos || []).filter(a => a.ruta).map(a => ({ bucket: 'evidencias', ruta: a.ruta })))
  ];
  const informe = { verificado_en: new Date().toISOString(), perfiles: [], almacenamiento: objetos.length };
  for (const p of perfiles) {
    const usuario = ok(await admin.auth.admin.getUserById(p.id)).user;
    // No envía emails: obtiene un token administrativo temporal para probar la RLS real.
    const link = ok(await admin.auth.admin.generateLink({ type: 'magiclink', email: usuario.email }));
    const cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, opciones);
    ok(await cliente.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' }));
    try {
      const acceso = await Promise.all(tablas.map(async tabla => {
        const rows = await filas(cliente, tabla);
        return { tabla, registros: rows.length, coincide_con_total: firma(rows) === firma(base[tabla]) };
      }));
      let firmados = 0;
      for (const a of objetos) {
        const data = ok(await cliente.storage.from(a.bucket).createSignedUrl(a.ruta, 60));
        if (!data.signedUrl) throw new Error('No se obtuvo acceso al archivo');
        firmados++;
      }
      informe.perfiles.push({ nombre: p.nombre, acceso, archivos_accesibles: firmados });
    } finally { ok(await cliente.auth.signOut({ scope: 'local' })); }
  }
  const versiones = await filas(admin, 'documentos_versiones', 'id,origen,creado_en,drive_archivo_id,ultimo_error');
  const valoraciones = await filas(admin, 'valoraciones_versiones', 'id,creado_en,drive_archivo_id,ultimo_error');
  informe.respaldos = [...new Set(versiones.map(v => v.origen)), 'valoraciones'].map(origen => {
    const rows = origen === 'valoraciones' ? valoraciones : versiones.filter(v => v.origen === origen);
    const guardadas = rows.filter(v => v.drive_archivo_id);
    return { origen, versiones: rows.length, respaldadas: guardadas.length,
      pendientes: rows.length - guardadas.length, con_error: rows.filter(v => !v.drive_archivo_id && v.ultimo_error).length,
      ultima_version_respaldada: guardadas.map(v => v.creado_en).sort().at(-1) || null };
  });
  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync('tmp/verificacion-fisios.json', JSON.stringify(informe, null, 2));
  console.log(JSON.stringify(informe, null, 2));
  if (informe.perfiles.some(p => p.acceso.some(a => !a.coincide_con_total))) process.exitCode = 1;
})().catch(e => { console.error(e.message); process.exitCode = 1; });
