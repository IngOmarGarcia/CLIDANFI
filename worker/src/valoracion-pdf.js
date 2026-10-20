import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const secciones = {
  general: 'Ficha de ingreso', antecedentes: 'Antecedentes', dolor: 'Evaluación del dolor',
  postural: 'Evaluación postural', rom: 'Goniometría (ROM)', fuerza: 'Fuerza muscular',
  esp_cervical: 'Pruebas especiales - Cervical', esp_hombro: 'Pruebas especiales - Hombro',
  esp_lumbar: 'Pruebas especiales - Lumbopélvico', esp_rodilla: 'Pruebas especiales - Rodilla',
  marcha: 'Análisis de marcha', neuro: 'Valoración neurológica', diagnostico: 'Diagnóstico y plan'
};
const etiquetas = {
  ficha: 'Ficha del paciente', evolucion: 'Nota de evolución', rutina: 'Rutina de ejercicios',
  recibo: 'Recibo de pago', cita: 'Cita', texto: 'Evolución', eva: 'EVA (0-10)',
  adjuntos: 'Evidencias', titulo: 'Título', notas: 'Notas', nombre: 'Nombre',
  descripcion: 'Descripción', indicaciones: 'Indicaciones', series: 'Series',
  repeticiones: 'Repeticiones', segundos: 'Duración (segundos)', nota: 'Observaciones',
  monto: 'Importe (MXN)', metodo: 'Método de pago', concepto: 'Concepto', pagado_en: 'Fecha de pago',
  motivo: 'Motivo de consulta', inicio: 'Inicio de los síntomas', mecanismo: 'Mecanismo de lesión',
  ocupacion: 'Ocupación', actividad: 'Actividad física', referido: 'Médico que refiere',
  patologicos: 'Antecedentes patológicos', quirurgicos: 'Antecedentes quirúrgicos',
  medicamentos: 'Medicamentos', alergias: 'Alergias', estudios: 'Estudios de gabinete',
  eva_reposo: 'EVA en reposo (0-10)', eva_actividad: 'EVA en actividad (0-10)',
  localizacion: 'Localización', tipo: 'Tipo de dolor', irradiacion: 'Irradiación',
  horario: 'Predominio horario', agravantes: 'Factores agravantes', aliviantes: 'Factores aliviantes',
  anterior: 'Vista anterior', lateral: 'Vista lateral', posterior: 'Vista posterior',
  obs: 'Observaciones', tabla: 'Mediciones (izquierda / derecha)', izq: 'Izquierda', der: 'Derecha',
  tests: 'Pruebas especiales', patron: 'Patrón de marcha', fases: 'Alteraciones por fase',
  ayuda: 'Auxiliar de marcha', cadencia: 'Cadencia (pasos/min)', test6min: 'Marcha 6 min (metros)',
  sensibilidad: 'Sensibilidad', dermatoma: 'Dermatoma / territorio', reflejos: 'Reflejos',
  tension: 'Pruebas de tensión neural', dx: 'Diagnóstico fisioterapéutico',
  obj_corto: 'Objetivos a corto plazo', obj_largo: 'Objetivos a largo plazo', plan: 'Plan de tratamiento',
  sesiones: 'Sesiones estimadas', frecuencia: 'Frecuencia', pronostico: 'Pronóstico'
};
const etiqueta = k => etiquetas[k] || k.replace(/_/g, ' ');
const tieneDato = v => v !== null && v !== undefined && v !== '' &&
  (typeof v !== 'object' || Object.values(v).some(tieneDato));
const fecha = s => new Date(s).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

export async function generarValoracionPdf(version) {
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  // Las fuentes PDF estándar cubren español. Representar símbolos ajenos sin fallar el respaldo.
  const limpiar = value => Array.from(String(value).normalize('NFC').replace(/[\u2010-\u2015]/g, '-'))
    .map(c => { try { normal.encodeText(c); return c; } catch { return ` [U+${c.codePointAt(0).toString(16).toUpperCase()}] `; } }).join('');
  const azul = rgb(.12, .29, .39), tinta = rgb(.16, .2, .23);
  let page, y;
  const nueva = () => {
    page = doc.addPage([595.28, 841.89]); y = 748;
    page.drawText('CLIDANFI', { x: 44, y: 798, size: 18, font: bold, color: azul });
    page.drawText(limpiar((version.titulo_documento || 'Valoración de fisioterapia').toUpperCase()), { x: 44, y: 776, size: 10, font: bold, color: tinta });
    page.drawLine({ start: { x: 44, y: 763 }, end: { x: 551, y: 763 }, thickness: 1, color: azul });
  };
  const asegurar = h => { if (!page || y - h < 60) nueva(); };
  const envolver = (text, font, size, width) => {
    const lines = [];
    for (const paragraph of limpiar(text).split(/\r?\n/)) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (line && font.widthOfTextAtSize(`${line} ${word}`, size) > width) { lines.push(line); line = ''; }
        for (const char of word) {
          if (font.widthOfTextAtSize(line + char, size) > width) { lines.push(line); line = ''; }
          line += char;
        }
        line += ' ';
      }
      lines.push(line.trimEnd());
    }
    return lines;
  };
  const texto = (value, { fuerte = false, size = 10, indent = 0 } = {}) => {
    const font = fuerte ? bold : normal;
    for (const line of envolver(value, font, size, 507 - indent)) {
      asegurar(15); page.drawText(line, { x: 44 + indent, y, size, font, color: tinta }); y -= 15;
    }
  };
  nueva();
  texto(version.paciente_nombre, { fuerte: true, size: 16 }); y -= 5;
  texto(`Creación: ${fecha(version.contenido.creado_en)}`);
  texto(`Versión guardada: ${fecha(version.creado_en)} (hora de Ciudad de México)`);
  texto(`Documento: ${version.contenido.id || version.valoracion_id || '-'}`, { size: 8 });
  texto(`Versión: ${version.id}`, { size: 8 }); y -= 12;
  const render = (key, value, indent = 0) => {
    if (!tieneDato(value)) return;
    if (Array.isArray(value)) texto(`${etiqueta(key)}: ${value.map(v => typeof v === 'object' ? Object.values(v).join(' / ') : v).join(' · ')}`, { indent });
    else if (typeof value === 'object') {
      asegurar(45); texto(etiqueta(key), { fuerte: true, indent });
      for (const [k, v] of Object.entries(value)) render(k, v, Math.min(indent + 12, 72));
    } else texto(`${etiqueta(key)}: ${value === 'NE' ? 'No evaluado' : value === true ? 'Sí' : value === false ? 'No' : value}`, { indent });
  };
  for (const [key, value] of Object.entries(version.contenido.datos || {})) {
    // Se incluyen datos de secciones desactivadas para no perder información guardada.
    if (!tieneDato(value)) continue;
    asegurar(60); y -= 5;
    page.drawRectangle({ x: 40, y: y - 5, width: 515, height: 23, color: rgb(.93, .96, .97) });
    texto(secciones[key] || etiqueta(key), { fuerte: true, size: 11 }); y -= 8;
    if (typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) render(k, v);
    } else render(key, value);
    y -= 10;
  }
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: 44, y: 43 }, end: { x: 551, y: 43 }, thickness: .5, color: rgb(.75, .8, .82) });
    p.drawText(`Expediente clínico - Confidencial    |    Página ${i + 1} de ${pages.length}`, {
      x: 44, y: 28, size: 8, font: normal, color: tinta
    });
  });
  doc.setTitle(`${version.titulo_documento || 'Valoración'} - ${limpiar(version.paciente_nombre)}`);
  doc.setAuthor('CLIDANFI');
  return doc.save();
}
