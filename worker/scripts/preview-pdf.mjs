import fs from 'node:fs/promises';
import { generarValoracionPdf } from '../src/valoracion-pdf.js';
const version = {
  id: '11111111-1111-4111-8111-111111111111', paciente_nombre: 'Prueba Drive - Ana Pérez',
  creado_en: '2026-10-10T18:00:00Z',
  contenido: { id: '22222222-2222-4222-8222-222222222222', creado_en: '2026-10-09T14:30:00Z',
    datos: {
      general: { motivo: 'Documento ficticio para comprobar el respaldo en PDF.', ocupacion: 'Paciente de prueba' },
      dolor: { eva_reposo: 0, eva_actividad: 4, localizacion: 'Hombro derecho' },
      rom: { tabla: { 'Flexión de hombro': { izq: 160, der: 120 } } },
      diagnostico: { dx: 'DATOS FICTICIOS - sin aplicación clínica',
        obj_corto: 'Comprobar texto legible con acentos: valoración, flexión y evolución.',
        obj_largo: 'Texto largo de prueba para revisar los saltos de página. '.repeat(100),
        sesiones: 0, frecuencia: '1 × semana' }
    }
  }
};
await fs.mkdir('../output/pdf', { recursive: true });
await fs.writeFile('../output/pdf/valoracion-prueba.pdf', await generarValoracionPdf(version));
console.log('PDF ficticio generado para revisión visual');
