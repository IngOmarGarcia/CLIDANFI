/* ==========================================================================
   CLIDANFI · api.js  ·  CAPA DE ACCESO A DATOS
   --------------------------------------------------------------------------
   TODA la app habla únicamente con `API.*`. Ninguna vista toca localStorage
   ni Supabase directamente.

   ► Implementación actual: mock sobre localStorage (Store).
   ► Para pasar a producción: incluye `js/api-supabase.js` DESPUÉS de este
     archivo en index.html. Ese archivo sobrescribe `window.API` con la
     versión real de Supabase, misma firma, mismos nombres. Cero cambios en
     las vistas.
   ========================================================================== */
(function (global) {
  'use strict';

  const { uid, ticketCode, startOfDay, startOfWeek, addDays, isoDay, normalize } = UI;
  const S = () => Store.db;
  const persist = () => Store.save();

  /** Simula latencia de red para que la UI ya contemple estados async. */
  const tick = (v) => new Promise((r) => setTimeout(() => r(v), 0));
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const byDateDesc = (k) => (a, b) => new Date(b[k]) - new Date(a[k]);
  const byDateAsc  = (k) => (a, b) => new Date(a[k]) - new Date(b[k]);

  /* ======================================================================
     CONFIGURACIÓN
     ====================================================================== */
  const getConfig = async () => tick(clone(S().config));

  const setConfig = async (patch) => {
    Object.assign(S().config, patch);
    persist();
    return tick(clone(S().config));
  };

  /* ======================================================================
     PACIENTES
     ====================================================================== */

  /** Fecha ISO de la última asistencia registrada, o null. */
  function _ultimaAsistencia(pacienteId) {
    const list = S().asistencias.filter((a) => a.paciente_id === pacienteId);
    if (!list.length) return null;
    return list.reduce((max, a) => (new Date(a.asistio_en) > new Date(max) ? a.asistio_en : max), list[0].asistio_en);
  }

  /** Enriquece al paciente con datos derivados que la UI necesita. */
  function _decorarPaciente(p) {
    const ultima = _ultimaAsistencia(p.id);
    const totalVisitas = S().asistencias.filter((a) => a.paciente_id === p.id).length;
    const proxima = S().citas
      .filter((c) => c.paciente_id === p.id && c.estado === 'agendada' && new Date(c.inicia_en) >= new Date())
      .sort(byDateAsc('inicia_en'))[0] || null;
    return {
      ...clone(p),
      ultima_asistencia: ultima,
      total_visitas: totalVisitas,
      proxima_cita: proxima ? clone(proxima) : null,
      paquete_restantes: Math.max(0, (p.paquete_total || 0) - (p.paquete_usadas || 0))
    };
  }

  /**
   * Lista de pacientes ORDENADA POR FECHA DE ÚLTIMA ASISTENCIA (desc).
   * Los que nunca han asistido quedan al final.
   * @param {{q?: string}} opts  q = búsqueda por nombre/teléfono/diagnóstico
   */
  const listarPacientes = async ({ q = '' } = {}) => {
    const term = normalize(q).trim();
    let list = S().pacientes.map(_decorarPaciente);

    if (term) {
      list = list.filter((p) =>
        normalize(p.nombre).includes(term) ||
        normalize(p.diagnostico).includes(term) ||
        String(p.telefono || '').replace(/\s/g, '').includes(term.replace(/\s/g, '')));
    }

    list.sort((a, b) => {
      if (!a.ultima_asistencia && !b.ultima_asistencia) return a.nombre.localeCompare(b.nombre);
      if (!a.ultima_asistencia) return 1;   // sin asistencias → al final
      if (!b.ultima_asistencia) return -1;
      return new Date(b.ultima_asistencia) - new Date(a.ultima_asistencia);
    });

    return tick(list);
  };

  const obtenerPaciente = async (id) => {
    const p = S().pacientes.find((x) => x.id === id);
    return tick(p ? _decorarPaciente(p) : null);
  };

  const crearPaciente = async (data) => {
    const p = {
      id: uid('pac'), nombre: '', telefono: '', email: '', edad: null, sexo: '',
      diagnostico: '', avatar_url: '', alergias: '',
      paquete_nombre: 'Sesión individual', paquete_total: 1, paquete_usadas: 0, paquete_vence: null,
      activo: true, creado_en: new Date().toISOString(),
      ...data
    };
    S().pacientes.push(p);
    persist();
    return tick(_decorarPaciente(p));
  };

  const actualizarPaciente = async (id, patch) => {
    const p = S().pacientes.find((x) => x.id === id);
    if (!p) throw new Error('Paciente no encontrado');
    Object.assign(p, patch);
    persist();
    return tick(_decorarPaciente(p));
  };

  const eliminarPaciente = async (id) => {
    const d = S();
    d.pacientes = d.pacientes.filter((p) => p.id !== id);
    ['citas', 'asistencias', 'pagos', 'valoraciones', 'notas', 'rutinas', 'boletos']
      .forEach((t) => { d[t] = d[t].filter((r) => r.paciente_id !== id); });
    persist();
    return tick(true);
  };

  /* ======================================================================
     CITAS / AGENDA
     ====================================================================== */
  const _decorarCita = (c) => {
    const p = S().pacientes.find((x) => x.id === c.paciente_id);
    return { ...clone(c), paciente_nombre: p ? p.nombre : 'Paciente eliminado', paciente: p ? clone(p) : null };
  };

  const citasDeHoy = async () => {
    const hoy = isoDay(new Date());
    return tick(S().citas
      .filter((c) => isoDay(c.inicia_en) === hoy)
      .sort(byDateAsc('inicia_en'))
      .map(_decorarCita));
  };

  /** Próximas citas agendadas (desde ahora), agrupables por día. */
  const proximasCitas = async ({ dias = 14, limite = 50 } = {}) => {
    const ahora = new Date();
    const hasta = addDays(startOfDay(ahora), dias + 1);
    return tick(S().citas
      .filter((c) => c.estado === 'agendada' && new Date(c.inicia_en) >= ahora && new Date(c.inicia_en) < hasta)
      .sort(byDateAsc('inicia_en'))
      .slice(0, limite)
      .map(_decorarCita));
  };

  const citasDePaciente = async (pacienteId) =>
    tick(S().citas.filter((c) => c.paciente_id === pacienteId).sort(byDateDesc('inicia_en')).map(_decorarCita));

  const proximaCitaDePaciente = async (pacienteId) => {
    const ahora = new Date();
    const c = S().citas
      .filter((x) => x.paciente_id === pacienteId && x.estado === 'agendada' && new Date(x.inicia_en) >= ahora)
      .sort(byDateAsc('inicia_en'))[0];
    return tick(c ? _decorarCita(c) : null);
  };

  const crearCita = async (data) => {
    const c = {
      id: uid('cit'), paciente_id: null, inicia_en: new Date().toISOString(),
      duracion_min: 45, motivo: 'Sesión de rehabilitación', estado: 'agendada', notas: '',
      ...data
    };
    S().citas.push(c);
    persist();
    return tick(_decorarCita(c));
  };

  const actualizarCita = async (id, patch) => {
    const c = S().citas.find((x) => x.id === id);
    if (!c) throw new Error('Cita no encontrada');
    Object.assign(c, patch);
    persist();
    return tick(_decorarCita(c));
  };

  const eliminarCita = async (id) => {
    S().citas = S().citas.filter((c) => c.id !== id);
    persist();
    return tick(true);
  };

  /* ======================================================================
     ASISTENCIAS  ·  el corazón del sistema
     Registrar una asistencia dispara, en cascada:
       1. actualiza el orden de la lista de pacientes (última asistencia)
       2. descuenta una sesión del paquete
       3. registra el ingreso (si hay monto)
       4. emite 1 BOLETO por cada sorteo activo vigente
     ====================================================================== */
  const registrarAsistencia = async ({ paciente_id, cita_id = null, fecha = null, monto = null, metodo = 'Efectivo', concepto = 'Sesión de fisioterapia', nota = '' }) => {
    const d = S();
    const p = d.pacientes.find((x) => x.id === paciente_id);
    if (!p) throw new Error('Paciente no encontrado');

    const iso = fecha ? new Date(fecha).toISOString() : new Date().toISOString();

    const asistencia = { id: uid('asi'), paciente_id, cita_id, asistio_en: iso, nota, creado_en: new Date().toISOString() };
    d.asistencias.push(asistencia);

    // 2 · paquete
    if ((p.paquete_total || 0) > 0) p.paquete_usadas = Math.min(p.paquete_total, (p.paquete_usadas || 0) + 1);

    // 3 · ingreso
    if (monto !== null && Number(monto) > 0) {
      d.pagos.push({ id: uid('pag'), paciente_id, monto: Number(monto), metodo, concepto, pagado_en: iso });
    }

    // 4 · boletos automáticos
    const nuevos = _emitirBoletosPara(asistencia);

    // marca la cita como completada
    if (cita_id) {
      const c = d.citas.find((x) => x.id === cita_id);
      if (c) c.estado = 'completada';
    }

    persist();
    return tick({ asistencia: clone(asistencia), boletos: nuevos });
  };

  /** Emite un boleto por cada sorteo activo cuyo periodo cubra la asistencia. */
  function _emitirBoletosPara(asistencia) {
    const d = S();
    const t = new Date(asistencia.asistio_en);
    const nuevos = [];
    d.sorteos.forEach((s) => {
      if (s.estado !== 'activo') return;
      if (t < new Date(s.inicia_en) || t > new Date(s.termina_en)) return;
      const yaExiste = d.boletos.some((b) => b.sorteo_id === s.id && b.asistencia_id === asistencia.id);
      if (yaExiste) return;
      const b = {
        id: uid('bol'), sorteo_id: s.id, paciente_id: asistencia.paciente_id,
        asistencia_id: asistencia.id, codigo: ticketCode(), creado_en: asistencia.asistio_en
      };
      d.boletos.push(b);
      nuevos.push(clone(b));
    });
    return nuevos;
  }

  const asistenciasDePaciente = async (pacienteId) =>
    tick(S().asistencias.filter((a) => a.paciente_id === pacienteId).sort(byDateDesc('asistio_en')).map(clone));

  const eliminarAsistencia = async (id) => {
    const d = S();
    d.asistencias = d.asistencias.filter((a) => a.id !== id);
    d.boletos = d.boletos.filter((b) => b.asistencia_id !== id);
    persist();
    return tick(true);
  };

  /* ======================================================================
     INGRESOS
     ====================================================================== */
  const registrarPago = async ({ paciente_id, monto, metodo = 'Efectivo', concepto = 'Sesión de fisioterapia', fecha = null }) => {
    const pago = {
      id: uid('pag'), paciente_id, monto: Number(monto) || 0, metodo, concepto,
      pagado_en: fecha ? new Date(fecha).toISOString() : new Date().toISOString()
    };
    S().pagos.push(pago);
    persist();
    return tick(clone(pago));
  };

  /**
   * Resumen de ingresos de la semana (lunes → domingo).
   * @returns {{total, porDia:[{fecha,label,total}], semanaAnterior, variacion}}
   */
  const ingresosSemana = async (ref = new Date()) => {
    const ini = startOfWeek(ref);
    const fin = addDays(ini, 7);
    const iniPrev = addDays(ini, -7);

    const enRango = (p, a, b) => { const t = new Date(p.pagado_en); return t >= a && t < b; };
    const pagos = S().pagos;

    const total = pagos.filter((p) => enRango(p, ini, fin)).reduce((s, p) => s + p.monto, 0);
    const semanaAnterior = pagos.filter((p) => enRango(p, iniPrev, ini)).reduce((s, p) => s + p.monto, 0);

    const porDia = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(ini, i);
      const key = isoDay(d);
      return {
        fecha: key,
        label: UI.DIAS_S[d.getDay()],
        esHoy: key === isoDay(new Date()),
        total: pagos.filter((p) => isoDay(p.pagado_en) === key).reduce((s, p) => s + p.monto, 0)
      };
    });

    const variacion = semanaAnterior > 0 ? Math.round(((total - semanaAnterior) / semanaAnterior) * 100) : null;
    return tick({ total, porDia, semanaAnterior, variacion, inicio: ini.toISOString(), fin: addDays(ini, 6).toISOString() });
  };

  const pagosDePaciente = async (pacienteId) =>
    tick(S().pagos.filter((p) => p.paciente_id === pacienteId).sort(byDateDesc('pagado_en')).map(clone));

  /* ======================================================================
     VALORACIÓN INICIAL
     ====================================================================== */
  const valoracionDePaciente = async (pacienteId) => {
    const v = S().valoraciones.filter((x) => x.paciente_id === pacienteId).sort(byDateDesc('creado_en'))[0];
    return tick(v ? clone(v) : null);
  };

  const guardarValoracion = async (pacienteId, { secciones_activas, datos, id = null }) => {
    const d = S();
    let v = id ? d.valoraciones.find((x) => x.id === id) : null;
    if (v) {
      v.secciones_activas = secciones_activas;
      v.datos = datos;
      v.actualizado_en = new Date().toISOString();
    } else {
      v = {
        id: uid('val'), paciente_id: pacienteId, secciones_activas, datos,
        creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString()
      };
      d.valoraciones.push(v);
    }
    persist();
    return tick(clone(v));
  };

  /* ======================================================================
     NOTAS DE EVOLUCIÓN + ADJUNTOS (fotos de pruebas)
     ====================================================================== */
  const notasDePaciente = async (pacienteId) =>
    tick(S().notas.filter((n) => n.paciente_id === pacienteId).sort(byDateDesc('creado_en')).map(clone));

  const crearNota = async ({ paciente_id, texto, eva = null, tipo = 'evolucion', adjuntos = [] }) => {
    const n = {
      id: uid('not'), paciente_id, tipo, texto, eva,
      adjuntos: adjuntos.map((a) => ({ id: uid('adj'), url: a.url, titulo: a.titulo || 'Evidencia', creado_en: new Date().toISOString() })),
      creado_en: new Date().toISOString()
    };
    S().notas.push(n);
    persist();
    return tick(clone(n));
  };

  const agregarAdjunto = async (notaId, { url, titulo = 'Evidencia' }) => {
    const n = S().notas.find((x) => x.id === notaId);
    if (!n) throw new Error('Nota no encontrada');
    n.adjuntos = n.adjuntos || [];
    n.adjuntos.push({ id: uid('adj'), url, titulo, creado_en: new Date().toISOString() });
    persist();
    return tick(clone(n));
  };

  const eliminarNota = async (id) => {
    S().notas = S().notas.filter((n) => n.id !== id);
    persist();
    return tick(true);
  };

  /* ======================================================================
     RUTINAS DE EJERCICIO
     La más reciente queda ACTIVA y aparece arriba; el resto queda como
     histórico consultable por fecha.
     ====================================================================== */
  const _decorarRutina = (r) => ({
    ...clone(r),
    items: (r.items || []).slice().sort((a, b) => a.orden - b.orden).map((it) => ({
      ...clone(it),
      ejercicio: Store.ejercicio(it.ejercicio_id) || { nombre: 'Ejercicio eliminado', categoria: 'Movilidad', image_url: '', descripcion: '' }
    }))
  });

  const rutinasDePaciente = async (pacienteId) =>
    tick(S().rutinas.filter((r) => r.paciente_id === pacienteId).sort(byDateDesc('creado_en')).map(_decorarRutina));

  const rutinaActiva = async (pacienteId) => {
    const list = S().rutinas.filter((r) => r.paciente_id === pacienteId).sort(byDateDesc('creado_en'));
    const r = list.find((x) => x.activa) || list[0];
    return tick(r ? _decorarRutina(r) : null);
  };

  const guardarRutina = async (pacienteId, { titulo, notas = '', items = [], id = null }) => {
    const d = S();
    const normItems = items.map((it, i) => ({
      id: it.id || uid('rit'), ejercicio_id: it.ejercicio_id, orden: i,
      series: Number(it.series) || 0, reps: Number(it.reps) || 0, hold: Number(it.hold) || 0,
      frecuencia: it.frecuencia || 'Diario', nota: it.nota || ''
    }));

    let r = id ? d.rutinas.find((x) => x.id === id) : null;
    if (r) {
      Object.assign(r, { titulo, notas, items: normItems, actualizado_en: new Date().toISOString() });
    } else {
      r = {
        id: uid('rut'), paciente_id: pacienteId, titulo, notas, items: normItems,
        activa: true, creado_en: new Date().toISOString()
      };
      d.rutinas.push(r);
    }
    // Solo una rutina activa por paciente
    d.rutinas.filter((x) => x.paciente_id === pacienteId).forEach((x) => { x.activa = x.id === r.id; });
    persist();
    return tick(_decorarRutina(r));
  };

  const activarRutina = async (rutinaId) => {
    const d = S();
    const r = d.rutinas.find((x) => x.id === rutinaId);
    if (!r) throw new Error('Rutina no encontrada');
    d.rutinas.filter((x) => x.paciente_id === r.paciente_id).forEach((x) => { x.activa = x.id === rutinaId; });
    persist();
    return tick(_decorarRutina(r));
  };

  const eliminarRutina = async (rutinaId) => {
    S().rutinas = S().rutinas.filter((r) => r.id !== rutinaId);
    persist();
    return tick(true);
  };

  /* ======================================================================
     PROMOCIONES
     ====================================================================== */
  const _vigente = (p) => {
    const now = new Date();
    return p.activa && new Date(p.desde) <= now && new Date(p.hasta) >= now;
  };

  const listarPromociones = async ({ soloVigentes = false } = {}) => {
    let list = S().promociones.map((p) => ({ ...clone(p), vigente: _vigente(p) }));
    if (soloVigentes) list = list.filter((p) => p.vigente);
    return tick(list.sort((a, b) => Number(b.vigente) - Number(a.vigente) || new Date(b.desde) - new Date(a.desde)));
  };

  const guardarPromocion = async (data) => {
    const d = S();
    if (data.id) {
      const p = d.promociones.find((x) => x.id === data.id);
      if (p) Object.assign(p, data);
      persist();
      return tick(clone(p));
    }
    const p = { id: uid('pro'), color: 'brand', image_url: '', activa: true, ...data };
    d.promociones.push(p);
    persist();
    return tick(clone(p));
  };

  const eliminarPromocion = async (id) => {
    S().promociones = S().promociones.filter((p) => p.id !== id);
    persist();
    return tick(true);
  };

  /* ======================================================================
     SORTEOS / RIFAS
     ====================================================================== */
  const _decorarSorteo = (s) => {
    const d = S();
    const boletos = d.boletos.filter((b) => b.sorteo_id === s.id);
    const participantes = new Set(boletos.map((b) => b.paciente_id));
    const ganador = s.ganador_paciente_id ? d.pacientes.find((p) => p.id === s.ganador_paciente_id) : null;
    const now = new Date();
    return {
      ...clone(s),
      total_boletos: boletos.length,
      total_participantes: participantes.size,
      ganador_nombre: ganador ? ganador.nombre : null,
      vigente: s.estado === 'activo' && new Date(s.inicia_en) <= now && new Date(s.termina_en) >= now,
      cerrado: new Date(s.termina_en) < now,
      dias_restantes: Math.max(0, Math.ceil((new Date(s.termina_en) - now) / 86400000))
    };
  };

  const listarSorteos = async ({ soloPublicados = false } = {}) => {
    let list = S().sorteos.map(_decorarSorteo);
    if (soloPublicados) list = list.filter((s) => s.publicado);
    // activos primero, luego por fecha de término desc
    return tick(list.sort((a, b) =>
      Number(b.estado === 'activo') - Number(a.estado === 'activo') ||
      new Date(b.termina_en) - new Date(a.termina_en)));
  };

  const obtenerSorteo = async (id) => {
    const s = S().sorteos.find((x) => x.id === id);
    return tick(s ? _decorarSorteo(s) : null);
  };

  const guardarSorteo = async (data) => {
    const d = S();
    if (data.id) {
      const s = d.sorteos.find((x) => x.id === data.id);
      if (!s) throw new Error('Sorteo no encontrado');
      Object.assign(s, data);
      persist();
      await sincronizarBoletos(s.id);
      return tick(_decorarSorteo(s));
    }
    const s = {
      id: uid('sor'), titulo: '', premio: '', descripcion: '',
      inicia_en: new Date().toISOString(), termina_en: addDays(new Date(), 30).toISOString(),
      estado: 'activo', publicado: true,
      ganador_paciente_id: null, ganador_boleto: null, sorteado_en: null,
      creado_en: new Date().toISOString(), ...data
    };
    d.sorteos.push(s);
    persist();
    await sincronizarBoletos(s.id);
    return tick(_decorarSorteo(s));
  };

  const eliminarSorteo = async (id) => {
    const d = S();
    d.sorteos = d.sorteos.filter((s) => s.id !== id);
    d.boletos = d.boletos.filter((b) => b.sorteo_id !== id);
    persist();
    return tick(true);
  };

  /**
   * Recorre las asistencias dentro del periodo del sorteo y emite los boletos
   * que falten (1 boleto = 1 asistencia). Idempotente.
   */
  const sincronizarBoletos = async (sorteoId) => {
    const d = S();
    const s = d.sorteos.find((x) => x.id === sorteoId);
    if (!s) throw new Error('Sorteo no encontrado');
    const d0 = new Date(s.inicia_en), d1 = new Date(s.termina_en);
    let creados = 0;

    d.asistencias.forEach((a) => {
      const t = new Date(a.asistio_en);
      if (t < d0 || t > d1) return;
      if (d.boletos.some((b) => b.sorteo_id === s.id && b.asistencia_id === a.id)) return;
      d.boletos.push({
        id: uid('bol'), sorteo_id: s.id, paciente_id: a.paciente_id,
        asistencia_id: a.id, codigo: ticketCode(), creado_en: a.asistio_en
      });
      creados++;
    });

    // Limpia boletos de asistencias que quedaron fuera del nuevo periodo
    const validos = new Set(d.asistencias
      .filter((a) => { const t = new Date(a.asistio_en); return t >= d0 && t <= d1; })
      .map((a) => a.id));
    const antes = d.boletos.length;
    d.boletos = d.boletos.filter((b) => b.sorteo_id !== s.id || validos.has(b.asistencia_id));

    persist();
    return tick({ creados, eliminados: antes - d.boletos.length });
  };

  /** Boletos de un sorteo, agrupados por paciente y ordenados por cantidad. */
  const participantesDeSorteo = async (sorteoId) => {
    const d = S();
    const map = new Map();
    d.boletos.filter((b) => b.sorteo_id === sorteoId).forEach((b) => {
      if (!map.has(b.paciente_id)) map.set(b.paciente_id, { paciente_id: b.paciente_id, boletos: [] });
      map.get(b.paciente_id).boletos.push(b.codigo);
    });
    const list = [...map.values()].map((r) => {
      const p = d.pacientes.find((x) => x.id === r.paciente_id);
      return { ...r, nombre: p ? p.nombre : 'Paciente eliminado', total: r.boletos.length };
    });
    return tick(list.sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre)));
  };

  /** Elige un boleto al azar (probabilidad proporcional a asistencias). */
  const realizarSorteo = async (sorteoId) => {
    const d = S();
    const s = d.sorteos.find((x) => x.id === sorteoId);
    if (!s) throw new Error('Sorteo no encontrado');
    const boletos = d.boletos.filter((b) => b.sorteo_id === sorteoId);
    if (!boletos.length) throw new Error('No hay boletos emitidos para este sorteo');

    const g = boletos[Math.floor(Math.random() * boletos.length)];
    const p = d.pacientes.find((x) => x.id === g.paciente_id);

    s.ganador_paciente_id = g.paciente_id;
    s.ganador_boleto = g.codigo;
    s.sorteado_en = new Date().toISOString();
    s.estado = 'sorteado';
    s.publicado = false; // el fisio decide cuándo publicarlo
    persist();

    return tick({
      sorteo: _decorarSorteo(s),
      ganador: { paciente_id: g.paciente_id, nombre: p ? p.nombre : '—', codigo: g.codigo, total_boletos: boletos.length }
    });
  };

  const publicarGanador = async (sorteoId, publicado = true) => {
    const s = S().sorteos.find((x) => x.id === sorteoId);
    if (!s) throw new Error('Sorteo no encontrado');
    s.publicado = publicado;
    persist();
    return tick(_decorarSorteo(s));
  };

  /** Boletos del paciente agrupados por sorteo (vista paciente). */
  const misBoletos = async (pacienteId) => {
    const d = S();
    return tick(d.sorteos.filter((s) => s.publicado).map((s) => {
      const mios = d.boletos.filter((b) => b.sorteo_id === s.id && b.paciente_id === pacienteId);
      return {
        ...(_decorarSorteo(s)),
        mis_boletos: mios.map((b) => b.codigo),
        mis_boletos_total: mios.length,
        soy_ganador: s.ganador_paciente_id === pacienteId
      };
    }).sort((a, b) =>
      Number(b.estado === 'activo') - Number(a.estado === 'activo') ||
      new Date(b.termina_en) - new Date(a.termina_en)));
  };

  /* ======================================================================
     DASHBOARD
     ====================================================================== */
  const resumenDashboard = async () => {
    const d = S();
    const hoy = isoDay(new Date());
    const ingresos = await ingresosSemana();
    const citasHoy = await citasDeHoy();
    const semanaIni = startOfWeek(new Date());

    return tick({
      ingresos,
      citas_hoy: citasHoy,
      citas_hoy_total: citasHoy.length,
      citas_hoy_pendientes: citasHoy.filter((c) => c.estado === 'agendada').length,
      atendidos_hoy: d.asistencias.filter((a) => isoDay(a.asistio_en) === hoy).length,
      atendidos_semana: d.asistencias.filter((a) => new Date(a.asistio_en) >= semanaIni).length,
      pacientes_activos: d.pacientes.filter((p) => p.activo).length,
      sorteos_activos: d.sorteos.filter((s) => s.estado === 'activo').length,
      promos_vigentes: d.promociones.filter(_vigente).length,
      ticket_promedio: (() => {
        const pagos = d.pagos.filter((p) => new Date(p.pagado_en) >= semanaIni);
        return pagos.length ? Math.round(pagos.reduce((s, p) => s + p.monto, 0) / pagos.length) : 0;
      })()
    });
  };

  /* ======================================================================
     AUTENTICACIÓN (modo demostración)
     Espejo local de Supabase Auth: misma firma, sesión en localStorage.
     En producción esta implementación se sustituye por la de
     js/api-supabase.js, que valida contra el servidor.
     ====================================================================== */
  const SESION_KEY = 'clidanfi.sesion';
  let _sesion = null;
  const _oyentes = [];

  const _emitir = () => _oyentes.forEach((cb) => { try { cb(_sesion); } catch (e) { console.error(e); } });

  const _cargarSesion = () => {
    if (_sesion) return _sesion;
    try { _sesion = JSON.parse(localStorage.getItem(SESION_KEY) || 'null'); } catch { _sesion = null; }
    return _sesion;
  };

  const auth = {
    entrar: async (email, password) => {
      const correo = String(email || '').trim().toLowerCase();
      const u = S().usuarios.find((x) => x.email.toLowerCase() === correo);
      // Mensaje genérico a propósito: no revelamos si el correo existe.
      if (!u || u.password !== password) throw new Error('Correo o contraseña incorrectos.');
      _sesion = { user: { id: u.id, email: u.email }, perfil: { id: u.id, rol: u.rol, nombre: u.nombre } };
      localStorage.setItem(SESION_KEY, JSON.stringify(_sesion));
      _emitir();
      return _sesion;
    },
    salir: async () => {
      _sesion = null;
      localStorage.removeItem(SESION_KEY);
      _emitir();
    },
    sesion: async () => _cargarSesion(),
    registrar: async () => { throw new Error('El alta de cuentas requiere Supabase. Crea el usuario desde el panel de Supabase.'); },
    cambiarPassword: async () => { throw new Error('El cambio de contraseña requiere Supabase.'); },
    onCambio: (cb) => { _oyentes.push(cb); return () => _oyentes.splice(_oyentes.indexOf(cb), 1); }
  };

  /** Paciente vinculado a la sesión actual (null si el usuario es fisio). */
  const miPaciente = async () => {
    const s = _cargarSesion();
    if (!s) return null;
    const p = S().pacientes.find((x) => x.usuario_id === s.user.id);
    return p ? _decorarPaciente(p) : null;
  };

  /* ======================================================================
     CONTROL DE ACCESO
     Esta matriz es el ESPEJO EN CLIENTE de las políticas RLS de
     supabase/schema.sql. Existe para que el modo demostración se comporte
     igual que producción y para dar errores claros.

     ⚠ En producción la autoridad es RLS, en el servidor. Un guardia en el
       navegador nunca es una medida de seguridad por sí solo.
     ====================================================================== */

  // Exclusivas del fisioterapeuta
  const SOLO_FISIO = [
    'listarPacientes', 'crearPaciente', 'actualizarPaciente', 'eliminarPaciente',
    'citasDeHoy', 'proximasCitas', 'crearCita', 'actualizarCita', 'eliminarCita',
    'registrarAsistencia', 'eliminarAsistencia', 'registrarPago', 'ingresosSemana',
    'guardarValoracion', 'crearNota', 'agregarAdjunto', 'eliminarNota',
    'guardarRutina', 'activarRutina', 'eliminarRutina',
    'guardarPromocion', 'eliminarPromocion',
    'listarSorteos', 'obtenerSorteo', 'guardarSorteo', 'eliminarSorteo',
    'sincronizarBoletos', 'participantesDeSorteo', 'realizarSorteo', 'publicarGanador',
    'resumenDashboard'
  ];

  // El paciente solo accede a lo suyo. El valor es la posición del argumento
  // que lleva el id de paciente.
  const SOLO_PROPIO = {
    obtenerPaciente: 0, citasDePaciente: 0, proximaCitaDePaciente: 0,
    asistenciasDePaciente: 0, pagosDePaciente: 0,
    valoracionDePaciente: 0, notasDePaciente: 0,
    rutinasDePaciente: 0, rutinaActiva: 0, misBoletos: 0
  };

  // Abiertas a cualquier sesión: getConfig, setConfig, listarPromociones, miPaciente

  const _rol = () => (_cargarSesion() || {}).perfil?.rol || null;

  const _miPacienteId = () => {
    const s = _cargarSesion();
    if (!s) return null;
    const p = S().pacientes.find((x) => x.usuario_id === s.user.id);
    return p ? p.id : null;
  };

  function _proteger(api) {
    const salida = {};
    for (const [nombre, fn] of Object.entries(api)) {
      if (typeof fn !== 'function') { salida[nombre] = fn; continue; }

      salida[nombre] = async (...args) => {
        if (!_cargarSesion()) throw new Error('Sesión no iniciada.');

        if (SOLO_FISIO.includes(nombre) && _rol() !== 'fisio') {
          throw new Error('Acceso denegado: esta información es exclusiva del fisioterapeuta.');
        }
        if (nombre in SOLO_PROPIO && _rol() !== 'fisio') {
          const pedido = args[SOLO_PROPIO[nombre]];
          if (!pedido || pedido !== _miPacienteId()) {
            throw new Error('Acceso denegado: no puedes consultar el expediente de otro paciente.');
          }
        }
        return fn(...args);
      };
    }
    return salida;
  }

  /* ======================================================================
     EXPORT
     ====================================================================== */
  global.API = Object.assign(_proteger({
    // configuración de la app
    getConfig, setConfig,
    // pacientes
    listarPacientes, obtenerPaciente, crearPaciente, actualizarPaciente, eliminarPaciente,
    // agenda
    citasDeHoy, proximasCitas, citasDePaciente, proximaCitaDePaciente, crearCita, actualizarCita, eliminarCita,
    // asistencias e ingresos
    registrarAsistencia, asistenciasDePaciente, eliminarAsistencia,
    registrarPago, ingresosSemana, pagosDePaciente,
    // clínico
    valoracionDePaciente, guardarValoracion,
    notasDePaciente, crearNota, agregarAdjunto, eliminarNota,
    // rutinas
    rutinasDePaciente, rutinaActiva, guardarRutina, activarRutina, eliminarRutina,
    // marketing
    listarPromociones, guardarPromocion, eliminarPromocion,
    listarSorteos, obtenerSorteo, guardarSorteo, eliminarSorteo,
    sincronizarBoletos, participantesDeSorteo, realizarSorteo, publicarGanador, misBoletos,
    // dashboard
    resumenDashboard
  }), {
    // Fuera del guardia: `auth` debe funcionar SIN sesión previa.
    _impl: 'localStorage',
    auth,
    miPaciente
  });
})(window);
