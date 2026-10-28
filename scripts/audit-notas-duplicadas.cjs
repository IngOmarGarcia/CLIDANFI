// Diagnóstico de solo lectura. No imprime texto clínico, nombres ni credenciales.
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');
const crypto = require('node:crypto');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const ok = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const hash = obj => crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
(async () => {
  const notas = ok(await sb.from('notas').select('id,paciente_id,texto,eva,adjuntos,creado_en,fecha_nota,signos_vitales')
    .order('creado_en', { ascending: false }).limit(1000));
  const versiones = ok(await sb.from('documentos_versiones').select('id,documento_id,numero,creado_en,contenido,drive_archivo_id,intentos,ultimo_error')
    .eq('origen', 'notas').order('creado_en', { ascending: false }).limit(2000));
  const gruposNotas = new Map(), gruposVersiones = new Map();
  for (const n of notas) {
    const firma = hash([n.paciente_id, n.texto, n.eva, n.adjuntos, n.signos_vitales]);
    const grupo = gruposNotas.get(firma) || [];
    grupo.push(n); gruposNotas.set(firma, grupo);
  }
  for (const v of versiones) {
    const grupo = gruposVersiones.get(v.documento_id) || [];
    grupo.push(v); gruposVersiones.set(v.documento_id, grupo);
  }
  const repetidas = [...gruposNotas.values()].filter(g => g.length > 1).map(g => ({
    cantidad: g.length, fechas: g.slice(0, 10).map(n => n.creado_en)
  }));
  const detalle = [...gruposVersiones].sort((a, b) => b[1].length - a[1].length).slice(0, 12).map(([id, g]) => {
    const cambios = [];
    for (let i = 0; i < Math.min(g.length - 1, 12); i++) {
      const a = g[i + 1].contenido, b = g[i].contenido;
      cambios.push({ anterior: g[i + 1].numero, nueva: g[i].numero,
        campos: [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])) });
    }
    return { documento: id, versiones: g.length, ultimas: g.slice(0, 8).map(v => ({ numero: v.numero,
      fecha: v.creado_en, respaldada: !!v.drive_archivo_id, intentos: v.intentos, error: v.ultimo_error })), cambios };
  });
  console.log(JSON.stringify({ notas_revisadas: notas.length, versiones_revisadas: versiones.length,
    grupos_notas_mismo_contenido: repetidas, documentos: detalle }, null, 2));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
