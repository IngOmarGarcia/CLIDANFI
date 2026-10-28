// Diagnóstico de metadatos: no imprime contenido clínico ni credenciales.
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const ok = r => { if (r.error) throw new Error(r.error.message); return r.data; };
(async () => {
  const versiones = ok(await sb.from('valoraciones_versiones')
    .select('id,valoracion_id,paciente_id,creado_en,drive_archivo_id,intentos,ultimo_error,reintentar_en')
    .order('creado_en', { ascending: false }).limit(100));
  const valoraciones = ok(await sb.from('valoraciones').select('id,paciente_id,creado_en,actualizado_en')
    .order('actualizado_en', { ascending: false }).limit(30));
  const citas = ok(await sb.from('citas').select('id,paciente_id,inicia_en,estado')
    .gte('inicia_en', '2026-10-10T17:30:00Z').lte('inicia_en', '2026-10-10T19:00:00Z'));
  const archivos = ok(await sb.from('archivos').select('id,paciente_id,creado_en,mime')
    .gte('creado_en', '2026-10-10T17:30:00Z'));
  console.log(JSON.stringify({
    cola: { revisadas: versiones.length, respaldadas: versiones.filter(v => v.drive_archivo_id).length,
      pendientes: versiones.filter(v => !v.drive_archivo_id),
      ultimos_guardados: versiones.slice(0, 10).map(v => ({ creado_en: v.creado_en, respaldada: !!v.drive_archivo_id })) },
    valoraciones_recientes: valoraciones,
    citas_mediodia: citas.map(c => ({ ...c, valoraciones: valoraciones.filter(v => v.paciente_id === c.paciente_id),
      versiones: versiones.filter(v => v.paciente_id === c.paciente_id).map(v => ({ fecha: v.creado_en, respaldada: !!v.drive_archivo_id })) })),
    adjuntos_desde_mediodia: archivos
  }, null, 2));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
