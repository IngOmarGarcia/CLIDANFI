// Prueba explícita de integración. Solo crea/consulta datos de Prueba Drive.
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const marca = 'DATOS FICTICIOS - prueba de respaldo Drive';
const ok = r => { if (r.error) throw new Error(r.error.message); return r.data; };
(async () => {
  let pacientes = ok(await sb.from('pacientes').select('id,nombre,diagnostico').eq('nombre', 'Prueba Drive'));
  let paciente = pacientes.find(p => p.diagnostico === marca);
  if (process.argv.includes('--crear')) {
    if (!paciente) paciente = ok(await sb.from('pacientes').insert({
      nombre: 'Prueba Drive', edad: 30, sexo: 'F', diagnostico: marca,
      telefono: '', email: '', activo: true, expediente_pendiente: false
    }).select('id,nombre,diagnostico').single());
    const valoraciones = ok(await sb.from('valoraciones').select('id')
      .eq('paciente_id', paciente.id));
    if (!valoraciones.length) ok(await sb.from('valoraciones').insert({
      paciente_id: paciente.id, secciones_activas: ['general', 'dolor', 'diagnostico'],
      datos: {
        general: { motivo: marca, inicio: 'Prueba técnica', ocupacion: 'Paciente ficticio',
          actividad: 'Sedentario', mecanismo: 'Prueba de integración', referido: '' },
        dolor: { localizacion: 'Hombro ficticio', eva_reposo: 2, eva_actividad: 4,
          tipo: [], horario: 'Dato de prueba', agravantes: 'Sin aplicación clínica', aliviantes: '', irradiacion: '' },
        diagnostico: { dx: marca, obj_corto: 'Comprobar copia en Drive', obj_largo: 'Verificar conservación de versiones',
          plan: [], sesiones: 1, frecuencia: 'Prueba única', pronostico: 'Sin aplicación clínica' }
      }
    }));
    const adjuntos = ok(await sb.from('archivos').select('id').eq('paciente_id', paciente.id)
      .eq('titulo', 'Imagen ficticia - Prueba Drive'));
    if (!adjuntos.length) {
      const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5eUAAAAASUVORK5CYII=', 'base64');
      const ruta = `${paciente.id}/prueba-drive.png`;
      const subida = await sb.storage.from('expedientes').upload(ruta, bytes,
        { contentType: 'image/png', upsert: false });
      if (subida.error && !/already exists|duplicate/i.test(subida.error.message)) ok(subida);
      ok(await sb.from('archivos').insert({ paciente_id: paciente.id, titulo: 'Imagen ficticia - Prueba Drive',
        ruta, mime: 'image/png', tamano: bytes.length, categoria: 'Otro',
        nota: marca + '. Este adjunto se guarda en Supabase; Drive respalda las valoraciones.' }));
    }
  }
  if (!paciente) throw new Error('No existe el paciente ficticio; ejecutar con --crear');
  let ejemploEvolucion;
  if (process.argv.includes('--evolucion')) {
    const texto = `${marca}. EJEMPLO DE NOTA DE EVOLUCIÓN. ` +
      'Sesión de demostración sin aplicación clínica. Se registra movilidad de hombro ficticia, ' +
      'ejercicio terapéutico de prueba y EVA 2/10. Objetivo: verificar el respaldo como ' +
      'Evolución Prueba Drive y conservar una copia adicional al actualizar el documento.';
    const existentes = ok(await sb.from('notas').select('id,creado_en')
      .eq('paciente_id', paciente.id).like('texto', `${marca}. EJEMPLO DE NOTA DE EVOLUCIÓN.%`).limit(1));
    ejemploEvolucion = existentes[0] || ok(await sb.from('notas').insert({
      paciente_id: paciente.id, tipo: 'evolucion', texto, eva: 2, adjuntos: []
    }).select('id,creado_en').single());
    if (process.argv.includes('--actualizar-evolucion')) {
      ok(await sb.from('notas').update({ texto: texto + ' ACTUALIZADO: segunda versión ficticia para comprobar el nombre del respaldo.' })
        .eq('id', ejemploEvolucion.id).eq('paciente_id', paciente.id));
    }
  }
  if (process.argv.includes('--reintentar-ejemplo')) {
    const pendientes = ok(await sb.from('documentos_versiones').select('id,bloqueo')
      .eq('paciente_id', paciente.id).is('drive_archivo_id', null).not('bloqueo', 'is', null));
    for (const fila of pendientes) {
      ok(await sb.from('documentos_versiones').update({ bloqueo: null, reintentar_en: new Date().toISOString() })
        .eq('id', fila.id).eq('bloqueo', fila.bloqueo).eq('paciente_id', paciente.id).is('drive_archivo_id', null));
    }
  }
  if (process.argv.includes('--nueva-version')) {
    const fila = ok(await sb.from('valoraciones').select('id,datos').eq('paciente_id', paciente.id)
      .order('creado_en', { ascending: false }).limit(1).single());
    const ahora = new Date().toISOString();
    ok(await sb.from('valoraciones').update({
      datos: { ...fila.datos, general: { ...fila.datos.general,
        motivo: `${marca}. Verificación de nueva edición PDF: ${ahora}` } }, actualizado_en: ahora
    }).eq('id', fila.id).eq('paciente_id', paciente.id));
  }
  const versiones = ok(await sb.from('valoraciones_versiones')
    .select('id,creado_en,drive_archivo_id,intentos,ultimo_error,reintentar_en')
    .eq('paciente_id', paciente.id).order('creado_en', { ascending: false }));
  console.log(JSON.stringify({ paciente: paciente.nombre, id: paciente.id,
    ...(ejemploEvolucion ? { ejemplo_evolucion: ejemploEvolucion } : {}), versiones }, null, 2));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
