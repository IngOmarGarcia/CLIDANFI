import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import '../../js/estadisticas-citas.js';
const fechas = globalThis.EstadisticasCitas;

export function periodosInformes(citas, ahora = new Date(), clavesExistentes = []) {
  const hoy = fechas.dia(ahora), mesActual = hoy.slice(0, 7), ano = Number(hoy.slice(0, 4));
  const dias = citas.map(c => fechas.dia(c.inicia_en)).filter(Boolean).sort();
  const periodos = [];
  const crear = (tipo, desde, hasta) => {
    const filas = [];
    if (tipo === 'mensual') {
      const semanas = new Map();
      for (let dia = desde; dia <= hasta; dia = fechas.moverDia(dia, 1)) {
        const lunes = fechas.lunes(dia);
        if (!semanas.has(lunes)) semanas.set(lunes, { desde: dia, hasta: dia, total: 0 });
        semanas.get(lunes).hasta = dia;
      }
      for (const fila of semanas.values()) filas.push({ ...fila, etiqueta: `Semana ${filas.length + 1} (${fila.desde.slice(8)} al ${fila.hasta.slice(8)})` });
    } else for (let mes = 1; mes <= 12; mes++) {
      const clave = `${desde.slice(0, 4)}-${String(mes).padStart(2, '0')}`;
      const ultimo = new Date(`${clave}-01T12:00:00Z`); ultimo.setUTCMonth(ultimo.getUTCMonth() + 1, 0);
      filas.push({ etiqueta: fechas.mesTexto(clave), desde: `${clave}-01`, hasta: ultimo.toISOString().slice(0, 10), total: 0 });
    }
    for (const dia of dias) {
      if (dia < desde || dia > hasta) continue;
      const fila = filas.find(f => dia >= f.desde && dia <= f.hasta);
      if (fila) fila.total++;
    }
    const total = filas.reduce((s, f) => s + f.total, 0);
    periodos.push({ clave: `${tipo}:${desde}`, tipo, desde, hasta, filas, total });
  };
  if (dias.length) {
    for (let mes = dias[0].slice(0, 7); mes < mesActual;) {
      const siguiente = new Date(`${mes}-01T12:00:00Z`); siguiente.setUTCMonth(siguiente.getUTCMonth() + 1);
      const fin = fechas.moverDia(siguiente.toISOString().slice(0, 10), -1);
      crear('mensual', `${mes}-01`, fin);
      mes = siguiente.toISOString().slice(0, 7);
    }
    for (let a = Number(dias[0].slice(0, 4)); a < ano; a++) crear('anual', `${a}-01-01`, `${a}-12-31`);
  }
  // Una cancelación o cambio de fecha puede vaciar un periodo ya publicado.
  // También se actualiza a cero, conservando el archivo en lugar de abandonarlo.
  for (const clave of clavesExistentes) {
    if (periodos.some(p => p.clave === clave) || !/^(mensual|anual):\d{4}-\d{2}-\d{2}$/.test(clave)) continue;
    const [tipo, desde] = clave.split(':');
    if (tipo === 'mensual' && desde.endsWith('-01') && desde.slice(0, 7) < mesActual) {
      const ultimo = new Date(`${desde}T12:00:00Z`); ultimo.setUTCMonth(ultimo.getUTCMonth() + 1, 0);
      crear(tipo, desde, ultimo.toISOString().slice(0, 10));
    }
    if (tipo === 'anual' && desde.endsWith('-01-01') && Number(desde.slice(0, 4)) < ano) crear(tipo, desde, `${desde.slice(0, 4)}-12-31`);
  }
  return periodos.sort((a, b) => b.hasta.localeCompare(a.hasta) || a.tipo.localeCompare(b.tipo));
}

export async function generarInformeCitas(periodo) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]), tinta = rgb(.15, .17, .2), marca = rgb(.57, .12, .14);
  const texto = (s, x, y, size = 11, fuerte = false) => page.drawText(String(s).replace(/[\u2010-\u2015]/g, '-'), { x, y, size, font: fuerte ? bold : font, color: tinta });
  texto('CLIDANFI', 44, 788, 14, true);
  texto(`Informe ${periodo.tipo === 'anual' ? 'anual' : 'mensual'} de citas completadas`, 44, 754, 18, true);
  texto(`${periodo.desde} al ${periodo.hasta}`, 44, 730, 12);
  texto('Zona horaria: Ciudad de México', 44, 711, 10);
  page.drawRectangle({ x: 44, y: 636, width: 507, height: 52, color: rgb(.97, .94, .93) });
  texto('Total de citas completadas', 58, 666, 11, true);
  texto(periodo.total, 58, 646, 17, true);
  const max = Math.max(1, ...periodo.filas.map(f => f.total));
  let y = 603;
  for (const fila of periodo.filas) {
    texto(fila.etiqueta, 44, y, 10);
    page.drawRectangle({ x: 228, y: y - 2, width: 270, height: 12, color: rgb(.95, .94, .93) });
    if (fila.total) page.drawRectangle({ x: 228, y: y - 2, width: 270 * fila.total / max, height: 12, color: marca });
    texto(fila.total, 516, y, 11, true);
    y -= 30;
  }
  texto('Solo totales agregados. No incluye nombres ni listados de pacientes.', 44, 106, 10);
  texto('Las citas canceladas, pendientes y faltas no se incluyen.', 44, 89, 10);
  texto('CLIDANFI | Reporte general | Página 1 de 1', 44, 43, 9);
  doc.setTitle(`CLIDANFI - Informe ${periodo.tipo} ${periodo.desde}`);
  doc.setAuthor('CLIDANFI');
  return doc.save();
}

const pedir = async (red, url, opciones, accion) => {
  const r = await red.fetch(url, opciones);
  if (!r.ok) throw new Error(`${accion}: HTTP ${r.status}`);
  return r.json();
};

export async function respaldarInformesCitas(db, headers, env, red, ahora = new Date()) {
  // Las consultas traen exclusivamente fechas; los listados de pacientes nunca
  // entran en este flujo. Si falta presupuesto no se publican totales parciales.
  const citas = [];
  for (let offset = 0; ; offset += 1000) {
    if (red.usadas >= 22) return { diferidos: true };
    const pagina = await db.select('citas', `select=inicia_en&estado=eq.completada&order=inicia_en.asc,id.asc&limit=1000&offset=${offset}`);
    citas.push(...pagina);
    if (pagina.length < 1000) break;
  }
  const archivos = [], existentes = new Map();
  let token;
  do {
    if (red.usadas >= 24) return { diferidos: true };
    const q = new URLSearchParams({ q: "trashed = false and appProperties has { key='clidanfi_informe' }",
      fields: 'files(id,parents,appProperties),nextPageToken', pageSize: '1000', ...(token ? { pageToken: token } : {}) });
    const lista = await pedir(red, `https://www.googleapis.com/drive/v3/files?${q}`, { headers }, 'Buscar informes generales');
    archivos.push(...(lista.files || [])); token = lista.nextPageToken;
  } while (token);
  for (const archivo of archivos) {
    const clave = archivo.appProperties.clidanfi_informe;
    if (existentes.has(clave)) throw new Error('Hay informes generales duplicados para un mismo periodo');
    existentes.set(clave, archivo);
  }
  const periodos = periodosInformes(citas, ahora, [...existentes.keys()]);
  const pendientes = [];
  for (const p of periodos) {
    const bytes = new TextEncoder().encode(JSON.stringify(p));
    const firma = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
    const anterior = existentes.get(p.clave);
    if (anterior?.appProperties.clidanfi_firma !== firma) pendientes.push({ p, firma, anterior });
    if (pendientes.length === 2) break;
  }
  if (!pendientes.length) return { guardados: 0, actualizados: 0 };
  if (red.usadas >= 25) return { diferidos: true };
  const q = new URLSearchParams({ q: "trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='clidanfi_informes' and value='1' }", fields: 'files(id)', pageSize: '2' });
  let carpetas = await pedir(red, `https://www.googleapis.com/drive/v3/files?${q}`, { headers }, 'Buscar carpeta de informes');
  if (carpetas.files?.length > 1) throw new Error('Hay varias carpetas de informes generales');
  let carpeta = carpetas.files?.[0];
  if (!carpeta) carpeta = await pedir(red, 'https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({
      name: 'Reportes generales', mimeType: 'application/vnd.google-apps.folder', appProperties: { clidanfi_informes: '1' },
      ...(env.GOOGLE_DRIVE_FOLDER_ID ? { parents: [env.GOOGLE_DRIVE_FOLDER_ID] } : {}) })
  }, 'Crear carpeta de informes');
  if (!carpeta.id) throw new Error('Drive no devolvió carpeta de informes');
  const resultado = { guardados: 0, actualizados: 0 };
  for (const { p, firma, anterior } of pendientes) {
    const metadata = { name: `Informe ${p.tipo} ${p.tipo === 'mensual' ? p.desde.slice(0, 7) : p.desde.slice(0, 4)}.pdf`,
      mimeType: 'application/pdf', appProperties: { clidanfi_informe: p.clave, clidanfi_firma: firma },
      ...(!anterior ? { parents: [carpeta.id] } : {}) };
    const boundary = `clidanfi_${crypto.randomUUID()}`;
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`, await generarInformeCitas(p), `\r\n--${boundary}--`]);
    const archivo = await pedir(red, `https://www.googleapis.com/upload/drive/v3/files${anterior ? `/${encodeURIComponent(anterior.id)}` : ''}?uploadType=multipart&fields=id`, {
      method: anterior ? 'PATCH' : 'POST', headers: { ...headers, 'Content-Type': `multipart/related; boundary=${boundary}` }, body
    }, 'Guardar informe general');
    if (!archivo.id) throw new Error('Drive no devolvió identificador del informe');
    resultado[anterior ? 'actualizados' : 'guardados']++;
  }
  return resultado;
}
