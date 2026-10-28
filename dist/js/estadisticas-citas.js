(function (global) {
  'use strict';
  const formato = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' });
  const dia = valor => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(valor))) return valor;
    const d = new Date(valor);
    if (!Number.isFinite(d.getTime())) return null;
    const p = Object.fromEntries(formato.formatToParts(d).map(p => [p.type, p.value]));
    return `${p.year}-${p.month}-${p.day}`;
  };
  const moverDia = (fecha, n) => { const d = new Date(`${fecha}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const lunes = fecha => { const d = new Date(`${fecha}T12:00:00Z`); return moverDia(fecha, -((d.getUTCDay() + 6) % 7)); };
  const mesTexto = mes => new Date(`${mes}-01T12:00:00Z`).toLocaleDateString('es-MX', { timeZone: 'UTC', month: 'long', year: 'numeric' }).replace(' de ', ' ');
  const completadas = citas => citas.filter(c => c.estado === 'completada' && dia(c.inicia_en));
  function agrupar(citas, tipo, mes) {
    const datos = completadas(citas), grupos = new Map();
    const poner = (clave, etiqueta, desde, hasta) => grupos.set(clave, { clave, etiqueta, desde, hasta, citas: [], total: 0 });
    if (tipo === 'ano') {
      const anos = datos.map(c => Number(dia(c.inicia_en).slice(0, 4))).concat(Number(mes.slice(0, 4)));
      for (let a = Math.min(...anos); a <= Math.max(...anos); a++) poner(String(a), String(a), `${a}-01-01`, `${a}-12-31`);
    } else if (tipo === 'mes') {
      for (let m = 1; m <= 12; m++) {
        const clave = `${mes.slice(0, 4)}-${String(m).padStart(2, '0')}`;
        const d = new Date(`${clave}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1, 0);
        poner(clave, mesTexto(clave), `${clave}-01`, d.toISOString().slice(0, 10));
      }
    } else {
      for (let fecha = `${mes}-01`; fecha.startsWith(mes); fecha = moverDia(fecha, 1)) {
        const clave = tipo === 'dia' ? fecha : lunes(fecha);
        if (!grupos.has(clave)) poner(clave, '', fecha, fecha);
        grupos.get(clave).hasta = fecha;
      }
      for (const g of grupos.values()) g.etiqueta = tipo === 'dia' ? g.desde : `${g.desde.slice(8)}–${g.hasta.slice(8)} ${mesTexto(mes)}`;
    }
    for (const c of datos) {
      const fecha = dia(c.inicia_en);
      const clave = tipo === 'ano' ? fecha.slice(0, 4) : tipo === 'mes' ? fecha.slice(0, 7) : tipo === 'dia' ? fecha : lunes(fecha);
      const g = grupos.get(clave);
      if (g && fecha >= g.desde && fecha <= g.hasta) { g.citas.push(c); g.total++; }
    }
    return [...grupos.values()];
  }
  function pacientes(citas) {
    const grupos = new Map();
    for (const c of completadas(citas)) {
      const id = c.paciente_id || c.paciente?.id;
      const nombre = c.paciente_nombre || c.paciente?.nombre || 'Paciente sin nombre';
      const clave = id || nombre;
      if (!grupos.has(clave)) grupos.set(clave, { id, nombre, total: 0 });
      grupos.get(clave).total++;
    }
    return [...grupos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }
  global.EstadisticasCitas = { dia, moverDia, lunes, mesTexto, completadas, agrupar, pacientes };
})(typeof window !== 'undefined' ? window : globalThis);
