// Solo estados y cantidades; no imprime contenido clínico, nombres ni secretos.
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const revisar = async (tabla, origen) => {
  let query = sb.from(tabla).select('*', { count: 'exact', head: true });
  if (origen) query = query.eq('origen', origen);
  const total = await query;
  if (total.error) throw new Error(`${tabla}: ${total.error.message}`);
  let pendientes = sb.from(tabla).select('*', { count: 'exact', head: true }).is('drive_archivo_id', null);
  if (origen) pendientes = pendientes.eq('origen', origen);
  const p = await pendientes;
  if (p.error) throw new Error(p.error.message);
  let errores = sb.from(tabla).select('intentos,ultimo_error,reintentar_en')
    .is('drive_archivo_id', null).not('ultimo_error', 'is', null).limit(10);
  if (origen) errores = errores.eq('origen', origen);
  const e = await errores;
  if (e.error) throw new Error(e.error.message);
  return { versiones: total.count, respaldadas: total.count - p.count, pendientes: p.count, errores: e.data };
};
(async () => {
  const resultado = { historias: await revisar('valoraciones_versiones') };
  for (const origen of ['pacientes', 'notas', 'rutinas', 'archivos', 'pagos', 'citas']) {
    resultado[origen] = await revisar('documentos_versiones', origen);
  }
  resultado.pendientes_sin_citas = Object.entries(resultado)
    .filter(([origen]) => origen !== 'citas').reduce((n, [, estado]) => n + estado.pendientes, 0);
  if (process.argv.includes('--ejemplo')) {
    const pacientes = await sb.from('pacientes').select('id')
      .eq('nombre', 'Prueba Drive').eq('diagnostico', 'DATOS FICTICIOS - prueba de respaldo Drive');
    if (pacientes.error) throw new Error(pacientes.error.message);
    const ids = pacientes.data.map(p => p.id);
    if (ids.length) {
      const ejemplos = await sb.from('documentos_versiones')
        .select('origen,numero,creado_en,drive_archivo_id,intentos,ultimo_error')
        .in('paciente_id', ids).order('creado_en');
      if (ejemplos.error) throw new Error(ejemplos.error.message);
      resultado.ejemplo_prueba_drive = ejemplos.data;
    }
  }
  console.log(JSON.stringify(resultado, null, 2));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
