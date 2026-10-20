// Adaptadores de los documentos del expediente a la plantilla PDF clínica.
export const tiposDocumento = {
  pacientes: 'Ficha', notas: 'Evolución', rutinas: 'Rutina',
  archivos: 'Archivo', pagos: 'Recibo'
};

export function prepararDocumento(version) {
  const c = version.contenido;
  let datos;
  switch (version.origen) {
    case 'pacientes': {
      const { usuario_id, avatar_url, ...ficha } = c;
      datos = { ficha }; break;
    }
    case 'notas':
      datos = { evolucion: { tipo: c.tipo, texto: c.texto, eva: c.eva,
        adjuntos: (c.adjuntos || []).map(a => a.ruta ? a.titulo || 'Evidencia'
          : `${a.titulo || 'Referencia externa'}: ${a.url || 'Sin enlace'}`) } }; break;
    case 'rutinas':
      datos = { rutina: { titulo: c.titulo, notas: c.notas, activa: c.activa } };
      (c.ejercicios || []).forEach((i, n) => {
        datos[`Ejercicio ${n + 1}`] = { nombre: i.ejercicio?.nombre,
          descripcion: i.ejercicio?.descripcion, indicaciones: i.ejercicio?.cue,
          series: i.series, repeticiones: i.reps, segundos: i.hold,
          frecuencia: i.frecuencia, nota: i.nota };
      });
      break;
    case 'pagos': datos = { recibo: c }; break;
    default: throw new Error(`Tipo de documento no soportado: ${version.origen}`);
  }
  return { ...version, titulo_documento: tiposDocumento[version.origen],
    contenido: { id: version.documento_id, creado_en: c.creado_en || c.pagado_en || version.creado_en, datos } };
}

// Solo objetos privados de nuestros buckets. Nunca solicitar URLs aportadas por usuarios.
export function adjuntosDocumento(version) {
  if (version.origen === 'archivos') return [{
    clave: 'principal', bucket: 'expedientes', ruta: version.contenido.ruta,
    titulo: version.contenido.titulo, mime: version.contenido.mime
  }];
  if (version.origen === 'notas') return (version.contenido.adjuntos || [])
    .filter(a => a.ruta).map((a, i) => ({
      clave: `adjunto-${i}`, bucket: 'evidencias', ruta: a.ruta,
      titulo: a.titulo || 'Evidencia', mime: 'image/jpeg'
    }));
  return [];
}
