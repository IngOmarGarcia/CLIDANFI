(function (global) {
  'use strict';
  const zona = 'America/Mexico_City';
  const hoyCentro = () => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const parte = tipo => p.find(x => x.type === tipo).value;
    return `${parte('year')}-${parte('month')}-${parte('day')}`;
  };
  function nacimientoValido(fecha) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '') || fecha > hoyCentro()) return false;
    const d = new Date(`${fecha}T12:00:00Z`);
    return !isNaN(d) && d.toISOString().slice(0, 10) === fecha;
  }
  function cumpleEn(paciente, ano) {
    const fecha = paciente.fecha_nacimiento;
    if (!nacimientoValido(fecha) || ano < Number(fecha.slice(0, 4))) return null;
    // Se conserva el 29 de febrero en años bisiestos; en los demás, se muestra el 28.
    const md = fecha.slice(5) === '02-29' && new Date(ano, 2, 0).getDate() === 28 ? '02-28' : fecha.slice(5);
    return { ...paciente, dia: `${ano}-${md}`, cumple_edad: ano - Number(fecha.slice(0, 4)) };
  }
  function festivos(ano) {
    const lista = [];
    const agregar = (md, nombre, oficial = false) => lista.push({ dia: `${ano}-${md}`, nombre, oficial });
    const lunes = (mes, numero) => {
      const primero = new Date(ano, mes - 1, 1);
      return `${String(mes).padStart(2, '0')}-${String(1 + (8 - primero.getDay()) % 7 + (numero - 1) * 7).padStart(2, '0')}`;
    };
    // Descansos nacionales recurrentes: art. 74 LFT. No incluye jornadas electorales locales.
    agregar('01-01', 'Año Nuevo', true);
    agregar(lunes(2, 1), 'Día de la Constitución', true);
    agregar(lunes(3, 3), 'Natalicio de Benito Juárez', true);
    agregar('05-01', 'Día del Trabajo', true);
    agregar('09-16', 'Independencia de México', true);
    agregar(lunes(11, 3), 'Revolución Mexicana', true);
    agregar('12-25', 'Navidad', true);
    if (ano >= 2024 && (ano - 2024) % 6 === 0) agregar('10-01', 'Transmisión del Poder Ejecutivo Federal', true);
    [['01-06', 'Día de Reyes'], ['02-14', 'Día del Amor y la Amistad'], ['04-30', 'Día de la Niñez'], ['05-05', 'Batalla de Puebla'], ['05-10', 'Día de las Madres'], ['09-15', 'Grito de Independencia'], ['11-01', 'Día de Todos los Santos'], ['11-02', 'Día de Muertos'], ['12-12', 'Día de la Virgen de Guadalupe'], ['12-24', 'Nochebuena'], ['12-31', 'Fin de año']].forEach(([md, nombre]) => agregar(md, nombre));
    return lista.sort((a, b) => a.dia.localeCompare(b.dia));
  }
  global.CalendarioEventos = { hoyCentro, nacimientoValido, cumpleEn, festivos };
})(window);
