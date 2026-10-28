import fs from 'node:fs/promises';
import { periodosInformes, generarInformeCitas } from '../src/informes-citas.js';
const citas = Array.from({ length: 160 }, (_, i) => ({ inicia_en: `2025-${String(i % 12 + 1).padStart(2, '0')}-${String(i % 27 + 1).padStart(2, '0')}T16:00:00Z` }));
citas.push(...Array.from({ length: 12 }, (_, i) => ({ inicia_en: `2026-01-0${i % 4 + 1}T16:00:00Z` })));
const periodos = periodosInformes(citas, new Date('2026-02-05T16:00:00Z'));
await fs.mkdir('../output/pdf', { recursive: true });
for (const tipo of ['mensual', 'anual']) {
  const p = periodos.find(p => p.tipo === tipo);
  await fs.writeFile(`../output/pdf/informe-${tipo}-prueba.pdf`, await generarInformeCitas(p));
}
console.log('Dos informes ficticios generados para revisión visual.');
