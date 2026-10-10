import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { generarValoracionPdf } from '../src/valoracion-pdf.js';

export const ejemplo = {
  id: '11111111-1111-4111-8111-111111111111', paciente_nombre: 'Prueba Drive - Ana Pérez',
  creado_en: '2026-10-10T18:00:00Z',
  contenido: { id: '22222222-2222-4222-8222-222222222222', creado_en: '2026-10-09T14:30:00Z',
    datos: {
      general: { motivo: 'Documento ficticio para comprobar el respaldo en PDF.', ocupacion: 'Paciente de prueba' },
      dolor: { eva_reposo: 0, eva_actividad: 4, localizacion: 'Hombro derecho' },
      rom: { tabla: { 'Flexión de hombro': { izq: 160, der: 120 } } },
      esp_hombro: { tests: { Neer: 'Pos', Jobe: 'NE' } },
      diagnostico: { dx: 'DATOS FICTICIOS - sin aplicación clínica',
        obj_corto: 'Comprobar texto legible con acentos: valoración, flexión y evolución.',
        obj_largo: 'Texto largo de prueba para revisar los saltos de página. '.repeat(100),
        plan: ['Prueba de respaldo', 'Verificación visual'], sesiones: 0,
        pronostico: 'Prueba Unicode: ✓ 🩺' }
    }
  }
};
test('PDF válido con paginación, texto largo y símbolos no latinos', async () => {
  const bytes = await generarValoracionPdf(ejemplo);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 2);
  assert.match(pdf.getTitle(), /Ana Pérez/);
});
