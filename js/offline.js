/* Almacenamiento privado por cuenta y dispositivo. Nunca cachear respuestas
   autenticadas en CacheStorage: allí solo vive la aplicación pública. */
(function (global) {
  'use strict';
  const DAY = 86400000;
  let dbPromise, session = null, running = false, preparing = false, networkDown = false, syncJob = null;
  const urls = new Map();
  const lastConnections = new Map();
  const online = () => navigator.onLine !== false && !networkDown;
  const networkError = error => /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(error?.message || '');
  const networkUnavailable = () => { networkDown = true; notify(); };
  const fileDay = value => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isFinite(+date) ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}` : '';
  };
  const notify = () => global.dispatchEvent(new Event('clidanfi-offline'));
  function db() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open('clidanfi-offline-v1', 1);
      r.onupgradeneeded = () => {
        for (const name of ['meta', 'reads', 'files', 'queue']) r.result.createObjectStore(name, { keyPath: 'key' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(new Error('No se pudo abrir el almacenamiento local.'));
    });
    return dbPromise;
  }
  async function store(name, mode, action) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(name, mode);
      const request = action(tx.objectStore(name));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('No se pudo guardar en este dispositivo. Comprueba el espacio disponible.'));
    });
  }
  const get = (name, key) => store(name, 'readonly', s => s.get(key));
  const put = (name, value) => store(name, 'readwrite', s => s.put(value));
  const del = (name, key) => store(name, 'readwrite', s => s.delete(key));
  const all = name => store(name, 'readonly', s => s.getAll());
  const withSyncLock = fn => navigator.locks ? navigator.locks.request('clidanfi-sync', fn) : fn();
  async function mergeFile(key, update) {
    const database = await db();
    return new Promise((resolve,reject) => {
      const tx = database.transaction('files','readwrite'), files = tx.objectStore('files');
      let value;
      const request = files.get(key);
      request.onsuccess = () => { value = update(request.result); if (value) files.put(value); };
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('No se pudo actualizar el archivo local.'));
    });
  }
  const owner = () => {
    if (!session) throw new Error('Inicia sesión para acceder a los datos de este dispositivo.');
    return `${session.user.id}:${session.perfil.rol}${session.perfil.rol==='paciente' ? ':'+(session.pacienteId || 'sin-expediente') : ''}`;
  };
  const key = (name, args) => `${owner()}:${name}:${JSON.stringify(args)}`;
  const mine = async name => (await all(name)).filter(r => r.owner === owner());
  async function recordConnection() {
    if (!session || !online()) return;
    const uid = owner(), previous = lastConnections.get(uid);
    if (previous && Date.now() - previous.at < 60000) return;
    const value = new Date().toISOString();
    lastConnections.set(uid, { at: Date.now(), value });
    await put('meta', { key: `${uid}:last-connection`, value });
  }
  async function connectionInfo() {
    const uid = owner();
    return lastConnections.get(uid)?.value || (await get('meta', `${uid}:last-connection`))?.value || (await get('meta', `${uid}:prepared`))?.value || null;
  }
  async function cachedSession(id) {
    const row = await get('meta', id ? `session:${id}` : 'active');
    return row?.value || null;
  }
  async function remember(s) {
    const same = s && s.user.id === session?.user.id && s.perfil.rol === session?.perfil.rol
      && (!('pacienteId' in s) || s.pacienteId === session?.pacienteId);
    if (same) s = { ...session, ...s };
    if (s) {
      const previous = await cachedSession(s.user.id);
      if (!('pacienteId' in s) && previous?.perfil.rol === s.perfil.rol && previous?.pacienteId) s = { ...s, pacienteId: previous.pacienteId };
    }
    session = s;
    if (!same) {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    }
    if (s) {
      await put('meta', { key: `session:${s.user.id}`, value: s });
      await put('meta', { key: 'active', value: s });
      await recordConnection().catch(console.error);
    } else await del('meta', 'active');
    notify();
  }
  async function read(name, args) {
    return (await get('reads', key(name, args)))?.value;
  }
  async function save(name, args, value) {
    await put('reads', { key: key(name, args), owner: owner(), name, args, value, at: new Date().toISOString() });
  }
  async function fileUrl(row) {
    if (!row?.blob) return null;
    if (!urls.has(row.key)) urls.set(row.key, URL.createObjectURL(row.blob));
    return urls.get(row.key);
  }
  async function hydrate(value) {
    if (Array.isArray(value)) return Promise.all(value.map(hydrate));
    if (!value || typeof value !== 'object' || value instanceof Blob) return value;
    const result = { ...value };
    if (result.ruta) {
      const f = await get('files', `${owner()}:${result.ruta}`);
      if (f?.blob) result.url = await fileUrl(f);
      else if (!online() && !result.url?.startsWith('blob:')) {
        // Las evidencias se pintan como <img>; un marcador explica la ausencia.
        result.url = result.mime ? null : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#f1f1f1"/><text x="300" y="150" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#555">Foto no descargada en este dispositivo</text></svg>');
      }
    }
    for (const [k, v] of Object.entries(result)) if (v && typeof v === 'object') result[k] = await hydrate(v);
    return result;
  }
  async function catalog(value, inheritedDate, patient) {
    if (Array.isArray(value)) { for (const v of value) await catalog(v, inheritedDate, patient); return; }
    if (!value || typeof value !== 'object') return;
    const date = value.fecha_nota || value.creado_en || inheritedDate;
    const paciente = value.paciente_id || patient;
    if (value.ruta && !value.url?.startsWith('data:')) {
      const k = `${owner()}:${value.ruta}`;
      const uid = owner();
      await mergeFile(k, previous => ({ ...previous, key: k, owner: uid, ruta: value.ruta,
        id: value.id, bucket: value.mime ? 'expedientes' : 'evidencias', titulo: value.titulo || 'Archivo',
        date, paciente, remote: value.url || previous?.remote || null, mime: value.mime, expected: value.tamano || previous?.expected || 0 }));
    }
    for (const v of Object.values(value)) if (v && typeof v === 'object') await catalog(v, date, paciente);
  }
  async function download(row, manual = false) {
    if (!online()) throw new Error('Conéctate a internet para descargar archivos.');
    const uid = owner();
    if (row.owner !== uid) throw new Error('Archivo de otra cuenta.');
    const current = await get('files', row.key);
    if (current?.blob) return;
    const signed = await API.sb.storage.from(row.bucket).createSignedUrl(row.ruta, 3600);
    if (signed.error) throw new Error(signed.error.message);
    const response = await fetch(signed.data.signedUrl);
    if (!response.ok) throw new Error('No se pudo descargar el archivo.');
    const blob = await response.blob();
    if (owner() !== uid) throw new Error('La cuenta cambió durante la descarga.');
    // Leer y escribir en la misma transacción preserva una limpieza simultánea.
    await mergeFile(row.key, latest => !manual && latest?.removed ? latest : ({ ...row, ...latest, blob, bytes: blob.size, removed: false,
      pinned: manual || latest?.pinned, downloaded: new Date().toISOString() }));
    recordConnection().catch(console.error);
    notify();
  }
  async function removeFiles(from, to) {
    let bytes = 0, count = 0;
    for (const row of await mine('files')) {
      const d = fileDay(row.date);
      if (!row.blob || row.pending || !d || d < from || d > to) continue;
      bytes += row.blob.size; count++;
      if (urls.has(row.key)) { URL.revokeObjectURL(urls.get(row.key)); urls.delete(row.key); }
      // Tombstone: no volver a descargar automáticamente tras liberar espacio.
      await mergeFile(row.key, latest => ({ ...latest, blob: null, bytes: 0, removed: true, pinned: false }));
    }
    notify();
    return { bytes, count };
  }
  const readable = new Set(('pacientesCumpleanos listarPacientes obtenerPaciente historialCitas citasDeHoy proximasCitas citasDeManana citasDePaciente proximaCitaDePaciente obtenerCita cumplimientoDePaciente asistenciasDePaciente pagosDePaciente ingresosSemana valoracionDePaciente historialValoraciones opcionesValoracion listarEjercicios obtenerNota historialNotas notasDePaciente archivosDePaciente enlaceDeArchivo rutinasDePaciente rutinaActiva listarPromociones listarSorteos obtenerSorteo participantesDeSorteo excluidosDeSorteo misBoletos sorteosVitrina misSolicitudes listarSolicitudes resumenDashboard getConfig miPaciente').split(' '));
  const writable = new Set(['crearPaciente', 'crearPacienteExpres', 'crearNota', 'cambiarFechaNota', 'guardarValoracion', 'subirArchivo']);
  let original;
  async function localRead(name, args) {
    if (original?._autorizarOffline) await original._autorizarOffline(name,args);
    const pending = await mine('queue');
    let value = await read(name, args);
    if (value === undefined && pending.some(q => q.table === 'pacientes' && q.result.id === args[0])) {
      if (['notasDePaciente','archivosDePaciente','citasDePaciente','asistenciasDePaciente','pagosDePaciente','rutinasDePaciente','historialValoraciones'].includes(name)) value = [];
      if (['valoracionDePaciente','rutinaActiva','proximaCitaDePaciente'].includes(name)) value = null;
      if (name === 'cumplimientoDePaciente') value = { asistidas: 0, faltas: 0, canceladas: 0, cumplimiento: null };
    }
    if (name === 'listarPacientes') {
      value = await read(name, []) ?? value;
      if (value) {
        const term = String(args[0]?.q || '').toLocaleLowerCase();
        value = value.filter(p => [p.nombre, p.telefono, p.diagnostico].some(v => String(v || '').toLocaleLowerCase().includes(term)));
      }
    }
    const appointments = await read('historialCitas', []);
    if (appointments && name === 'resumenDashboard' && value) {
      const today = appointments.filter(c=>new Date(c.inicia_en).toDateString()===new Date().toDateString());
      value = { ...value, citas_hoy: today, citas_hoy_total: today.length,
        citas_hoy_pendientes: today.filter(c=>c.estado==='agendada').length };
    }
    if (appointments && ['citasDeHoy', 'citasDeManana', 'proximasCitas', 'obtenerCita', 'citasDePaciente', 'proximaCitaDePaciente'].includes(name)) {
      const now = new Date();
      const day = new Date(now); if (name === 'citasDeManana') day.setDate(day.getDate() + 1);
      const sameDay = c => new Date(c.inicia_en).toDateString() === day.toDateString();
      if (name === 'citasDeHoy' || name === 'citasDeManana') value = appointments.filter(sameDay);
      if (name === 'obtenerCita') value = appointments.find(c => c.id === args[0]) || null;
      if (name === 'citasDePaciente') value = appointments.filter(c => c.paciente_id === args[0]).sort((a,b) => b.inicia_en.localeCompare(a.inicia_en));
      if (name === 'proximaCitaDePaciente') value = appointments.find(c => c.paciente_id === args[0] && c.estado === 'agendada' && new Date(c.inicia_en) >= now) || null;
      if (name === 'proximasCitas') {
        const opts = args[0] || {};
        value = appointments.filter(c => c.estado === 'agendada' && new Date(c.inicia_en) >= now && new Date(c.inicia_en) <= new Date(+now + (opts.dias ?? 14) * DAY)).slice(0, opts.limite ?? 50);
      }
    }
    if (name === 'enlaceDeArchivo') {
      const row = (await mine('files')).find(f => f.id === args[0]);
      if (row) value = { titulo: row.titulo, mime: row.mime, ruta: row.ruta, url: await fileUrl(row) };
    }
    for (const op of pending) {
      if (op.name === 'editarNota') continue; // cola antigua: solo exportable
      const r = op.result;
      if (name === 'listarPacientes' && op.table === 'pacientes') {
        const term = String(args[0]?.q || '').toLocaleLowerCase();
        if ([r.nombre,r.telefono,r.diagnostico].some(v=>String(v || '').toLocaleLowerCase().includes(term))) value = [...(value || []).filter(p => p.id !== r.id), r];
      }
      if (name === 'obtenerPaciente' && op.table === 'pacientes' && r.id === args[0]) value = r;
      if (name === 'notasDePaciente' && op.table === 'notas' && r.paciente_id === args[0]) value = [r, ...(value || []).filter(n => n.id !== r.id)];
      if (name === 'obtenerNota' && op.table === 'notas' && r.id === args[0]) value = r;
      if (name === 'valoracionDePaciente' && op.table === 'valoraciones' && r.paciente_id === args[0]) value = r;
      if (name === 'archivosDePaciente' && op.table === 'archivos' && r.paciente_id === args[0]) value = [r, ...(value || []).filter(f => f.id !== r.id)];
      if (name === 'enlaceDeArchivo' && op.table === 'archivos' && r.id === args[0]) value = { ...r, url: URL.createObjectURL(op.args[1]) };
    }
    if (appointments && name==='obtenerPaciente' && value) value = { ...value,
      proxima_cita: appointments.find(c=>c.paciente_id===value.id && c.estado==='agendada' && new Date(c.inicia_en)>=new Date()) || null };
    if (name === 'notasDePaciente' && value) value.sort((a,b)=>new Date(b.fecha_nota || b.creado_en)-new Date(a.fecha_nota || a.creado_en));
    if (value === undefined) throw new Error('Esta información todavía no está disponible sin conexión. Conéctate y completa la preparación desde Mi cuenta.');
    return hydrate(value);
  }
  async function enqueue(name, args) {
    return withSyncLock(() => enqueueLocked(name, args));
  }
  async function enqueueLocked(name, args) {
    if (session?.perfil.rol !== 'fisio') throw new Error('Solo el fisioterapeuta puede guardar cambios clínicos.');
    const id = crypto.randomUUID(), now = new Date().toISOString();
    let table, result, base = null;
    if (name === 'crearPaciente' || name === 'crearPacienteExpres') {
      const data = { ...args[0] };
      if (!String(data.nombre || '').trim()) throw new Error('Escribe el nombre del paciente.');
      if (name === 'crearPacienteExpres') Object.assign(data, { diagnostico: data.motivo || '', expediente_pendiente: true, paquete_total: 0, paquete_usadas: 0, paquete_nombre: 'Sesión individual' });
      delete data.motivo;
      table = 'pacientes'; result = { ...data, id, creado_en: now };
    } else if (name === 'crearNota') {
      const data = args[0];
      if (!data.paciente_id || !String(data.texto || '').trim()) throw new Error('Indica el paciente y el texto de la nota.');
      table = 'notas'; result = { ...data, id, creado_en: now, fecha_nota: data.fecha_nota || now, revision: 1 };
    } else if (name === 'cambiarFechaNota') {
      if (online() && !(await mine('queue')).some(q=>q.table==='notas' && q.result.id===args[0])) {
        base = await original.obtenerNota(args[0]);
        await save('obtenerNota', [args[0]], base);
      } else base = await localRead('obtenerNota', [args[0]]);
      table = 'notas'; result = { ...base, fecha_nota: args[1], id: args[0] };
    } else if (name === 'guardarValoracion') {
      table = 'valoraciones';
      base = args[1].id ? await localRead('valoracionDePaciente', [args[0]]) : null;
      if (args[1].id && base?.id !== args[1].id) throw new Error('Abre la valoración actual antes de editarla sin conexión.');
      result = { ...args[1], id: args[1].id || id, paciente_id: args[0], creado_en: base?.creado_en || now, actualizado_en: now };
    } else if (name === 'subirArchivo') {
      const [patient, file, opts = {}] = args;
      if (!file || file.size > 20 * 1024 * 1024 || !['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'].includes(file.type)) throw new Error('Archivo no admitido o mayor de 20 MB.');
      table = 'archivos';
      const ruta = `${patient}/${id}.${file.type === 'application/pdf' ? 'pdf' : 'bin'}`;
      result = { id, paciente_id: patient, ruta, titulo: opts.titulo || file.name || 'Archivo', categoria: opts.categoria || 'Estudio', nota: opts.nota || '', mime: file.type, tamano: file.size, creado_en: now, es_pdf: file.type === 'application/pdf' };
    }
    if (table === 'notas') {
      if (name === 'crearNota') {
        result.creado_por = session.user.id;
        result.creado_por_nombre = session.perfil.nombre;
      } else {
        result.editado_por = session.user.id;
        result.editado_por_nombre = session.perfil.nombre;
        result.editado_en = now;
      }
      const fecha = new Date(result.fecha_nota);
      if (!Number.isFinite(+fecha)) throw new Error('Indica una fecha válida para la nota.');
      result.fecha_nota = fecha.toISOString();
      result.eva = result.eva == null ? null : Number(result.eva);
      if (result.eva !== null && (!Number.isInteger(result.eva) || result.eva < 0 || result.eva > 10)) throw new Error('EVA debe estar entre 0 y 10.');
      const signs = result.signos_vitales || {};
      const ta = String(signs.ta || '').replace(/\s/g,'');
      if (ta && !/^\d{1,3}\/\d{1,3}$/.test(ta)) throw new Error('T/A debe tener el formato 120/80.');
      result.signos_vitales = { ta };
      for (const field of ['tem','fc','fr']) {
        const v = signs[field] === '' || signs[field] == null ? null : Number(signs[field]);
        if (v !== null && (!Number.isFinite(v) || v <= 0 || (field !== 'tem' && !Number.isInteger(v)))) throw new Error(`Valor inválido para ${field.toUpperCase()}`);
        result.signos_vitales[field] = v;
      }
      for (const attachment of result.adjuntos || []) if (attachment.ruta) {
        const file = await get('files', `${owner()}:${attachment.ruta}`);
        if (file?.remote) attachment.url = file.remote;
      }
    }
    let op = { key: `${owner()}:${id}`, owner: owner(), name, args, table, result, base, at: now, change: id };
    const previous = (await mine('queue')).find(q => q.name !== 'editarNota' && q.table === table && q.result.id === result.id);
    if (previous) {
      op = { ...previous, result, error: null, change: id };
      if (previous.name === 'cambiarFechaNota') op.args = [result.id, result.fecha_nota];
      if (previous.name === 'guardarValoracion') op.args = [result.paciente_id, { ...result }];
    }
    // El registro y sus binarios en cola se escriben en una sola transacción.
    await put('queue', op);
    UI.toast('Guardado en este dispositivo · Pendiente de sincronizar', 'warn', 4500);
    notify();
    if (name === 'subirArchivo') return { ...result, url: URL.createObjectURL(args[1]) };
    return result;
  }
  function checked(response) { if (response.error) throw new Error(response.error.message); return response.data; }
  async function upload(bucket, path, blob) {
    const r = await API.sb.storage.from(bucket).upload(path, blob, { upsert: false, contentType: blob.type });
    if (r.error && !['409', 'Duplicate'].includes(String(r.error.statusCode || r.error.error))) throw new Error(r.error.message);
    const signed = await API.sb.storage.from(bucket).createSignedUrl(path, 86400 * 365);
    checked(signed);
    return { ruta: path, url: signed.data.signedUrl };
  }
  async function replay(op) {
    if (op.name === 'editarNota') throw new Error('La edición de contenido fue desactivada. Puedes exportar esta copia pendiente; no se modificará la nota.');
    const sb = API.sb, row = { ...op.result };
    delete row.es_pdf; delete row.url;
    const existing = checked(await sb.from(op.table).select('*').eq('id', row.id).maybeSingle());
    if (!op.base && existing) return existing; // reintento tras respuesta perdida
    if (op.name === 'cambiarFechaNota') {
      if (!existing) throw new Error('La nota ya no existe en el sistema.');
      if (+new Date(existing.fecha_nota) === +new Date(row.fecha_nota)) return existing;
      const updated = checked(await sb.from('notas').update({ fecha_nota: row.fecha_nota }).eq('id', row.id).select().single());
      return updated;
    }
    if (op.base) {
      if (existing && JSON.stringify(existing.datos) === JSON.stringify(row.datos) && JSON.stringify(existing.secciones_activas) === JSON.stringify(row.secciones_activas)) return existing;
      if (!existing || existing.actualizado_en !== op.base.actualizado_en) throw new Error('Conflicto de valoración: cambió en otro dispositivo. Tu copia local se conserva.');
      const updated = checked(await sb.from('valoraciones').update({ datos: row.datos, secciones_activas: row.secciones_activas, actualizado_en: row.actualizado_en }).eq('id', row.id).eq('actualizado_en', op.base.actualizado_en).select().maybeSingle());
      if (!updated) throw new Error('La valoración cambió durante la sincronización. Tu copia local se conserva.');
      return updated;
    }
    if (op.table === 'archivos') await upload('expedientes', row.ruta, op.args[1]);
    if (op.table === 'notas') {
      row.adjuntos = [];
      for (const [i, a] of (op.result.adjuntos || []).entries()) {
        if (!a.url?.startsWith('data:')) { row.adjuntos.push(a); continue; }
        const blob = await (await fetch(a.url)).blob();
        const r = await upload('evidencias', `${row.paciente_id}/${row.id}-${i}.jpg`, blob);
        row.adjuntos.push({ ...a, ...r, id: `${row.id}-${i}`, creado_en: op.at });
      }
    }
    return checked(await sb.from(op.table).insert(row).select().single());
  }
  function sync() {
    if (!syncJob) syncJob = syncOnce().finally(() => { syncJob = null; });
    return syncJob;
  }
  async function syncOnce() {
    if (!session || !online() || running) return;
    running = true; notify();
    try {
      // Un solo escritor entre pestañas; la clave primaria protege los reintentos.
      const run = async () => {
        const uid = owner();
        for (const op of (await mine('queue')).sort((a,b) => Number(b.table==='pacientes')-Number(a.table==='pacientes') || a.at.localeCompare(b.at))) {
          if (!online() || owner() !== uid) break;
          if (op.name === 'editarNota') {
            await put('queue', { ...op, error: 'La edición de contenido fue desactivada. Esta copia solo puede exportarse.' });
            continue;
          }
          try {
            const result = await replay(op);
            recordConnection().catch(console.error);
            if (owner() !== uid) throw new Error('La cuenta cambió durante la sincronización.');
            if (op.table === 'archivos') {
              await put('files', { key: `${uid}:${result.ruta}`, owner: uid, id: result.id, ruta: result.ruta,
                bucket: 'expedientes', titulo: result.titulo, date: result.creado_en, paciente: result.paciente_id,
                mime: result.mime, blob: op.args[1], bytes: op.args[1].size, removed: false });
            }
            if (op.table === 'notas') for (const [i,a] of (result.adjuntos || []).entries()) {
              const local = op.result.adjuntos?.[i];
              if (!local?.url?.startsWith('data:') || !a.ruta) continue;
              const blob = await (await fetch(local.url)).blob();
              await put('files', { key: `${uid}:${a.ruta}`, owner: uid, id: a.id, ruta: a.ruta,
                bucket: 'evidencias', titulo: a.titulo, date: result.fecha_nota || result.creado_en,
                paciente: result.paciente_id, remote: a.url, blob, bytes: blob.size, removed: false });
            }
            const readName = { pacientes: 'obtenerPaciente', notas: 'obtenerNota', valoraciones: 'valoracionDePaciente' }[op.table];
            if (readName) await save(readName, [op.table === 'valoraciones' ? result.paciente_id : result.id], result);
            if (op.table === 'pacientes') {
              for (const name of ['notasDePaciente','archivosDePaciente','citasDePaciente','asistenciasDePaciente','pagosDePaciente','rutinasDePaciente','historialValoraciones']) {
                if (await read(name,[result.id]) === undefined) await save(name,[result.id],[]);
              }
              for (const name of ['valoracionDePaciente','rutinaActiva','proximaCitaDePaciente']) {
                if (await read(name,[result.id]) === undefined) await save(name,[result.id],null);
              }
              if (await read('cumplimientoDePaciente',[result.id]) === undefined) await save('cumplimientoDePaciente',[result.id],{asistidas:0,faltas:0,canceladas:0,cumplimiento:null});
            }
            // Mantener una copia sincronizada hasta refrescar el listado completo.
            const listName = { pacientes: 'listarPacientes', notas: 'notasDePaciente', archivos: 'archivosDePaciente' }[op.table];
            if (listName) {
              const args = op.table === 'pacientes' ? [] : [result.paciente_id];
              const list = await read(listName, args) || [];
              await save(listName, args, [result, ...list.filter(r => r.id !== result.id)]);
            }
            await put('meta', { key: `${uid}:cache-epoch`, value: crypto.randomUUID() });
            const latest = await get('queue', op.key);
            if (latest && latest.change !== op.change) {
              const next = { ...latest, base: result };
              if (op.table === 'notas') { next.name = 'cambiarFechaNota'; next.args = [result.id, latest.result.fecha_nota]; }
              await put('queue', next);
            } else await del('queue', op.key);
          } catch (e) {
            await put('queue', { ...op, error: e.message });
            break; // conservar orden: un paciente debe existir antes que su nota
          }
        }
      };
      await withSyncLock(run);
    } finally { running = false; notify(); }
  }
  async function prepare() {
    if (!session || !online() || preparing) return;
    preparing = true; notify();
    const uid = owner();
    try {
      await sync();
      const call = async (name, args = []) => {
        if (owner() !== uid) throw new Error('La cuenta cambió.');
        const epoch = (await get('meta', `${uid}:cache-epoch`))?.value;
        let value = await original[name](...args);
        if (owner() !== uid) throw new Error('La cuenta cambió durante la preparación.');
        await withSyncLock(async () => {
          if (owner() !== uid) throw new Error('La cuenta cambió durante la preparación.');
          if ((await get('meta', `${uid}:cache-epoch`))?.value !== epoch) {
            const current = await read(name,args);
            if (current !== undefined) { value = current; return; }
          }
          await save(name,args,value);
        });
        recordConnection().catch(console.error);
        if (['notasDePaciente','archivosDePaciente'].includes(name)) await catalog(value);
        return value;
      };
      await call('getConfig');
      let patients;
      if (session.perfil.rol === 'fisio') {
        patients = await call('listarPacientes');
        await call('historialCitas');
        for (const name of ['resumenDashboard','listarEjercicios','opcionesValoracion','listarSolicitudes','listarPromociones','listarSorteos','pacientesCumpleanos']) await call(name);
      } else {
        const p = await call('miPaciente'); patients = p ? [p] : [];
        await call('listarPromociones');
        await call('listarPromociones',[{soloVigentes:true}]);
        await call('sorteosVitrina');
        await call('misSolicitudes');
      }
      for (const p of patients) {
        for (const name of ['obtenerPaciente','citasDePaciente','proximaCitaDePaciente','asistenciasDePaciente','pagosDePaciente','valoracionDePaciente','notasDePaciente','archivosDePaciente','rutinasDePaciente','rutinaActiva','cumplimientoDePaciente']) await call(name, [p.id]);
        if (session.perfil.rol === 'fisio') await call('historialValoraciones', [p.id]);
        else await call('misBoletos',[p.id]);
        const notes = await read('notasDePaciente', [p.id]);
        for (const note of notes) {
          await save('obtenerNota', [note.id], note);
          if (session.perfil.rol === 'fisio') await call('historialNotas', [note.id]);
        }
      }
      let failures = 0;
      for (const f of await mine('files')) if (!f.removed && !f.blob && new Date(f.date).getTime() >= Date.now() - 7 * DAY) {
        try { await download(f); } catch { failures++; }
      }
      await put('meta', { key: `${uid}:prepared`, value: new Date().toISOString(), failures });
      await del('meta', `${uid}:prepare-error`);
    } catch (e) {
      if (networkError(e)) networkUnavailable();
      await put('meta', { key: `${uid}:prepare-error`, value: e.message });
    } finally {
      preparing = false; notify();
      if (session && owner() !== uid && online()) prepare();
    }
  }
  function install(api) {
    original = { ...api };
    for (const name of readable) {
      if (typeof original[name] !== 'function') continue;
      api[name] = async (...args) => {
        if (!session) return original[name](...args);
        const uid = owner();
        const epoch = (await get('meta', `${uid}:cache-epoch`))?.value;
        if (!online()) return localRead(name, args);
        if (['obtenerNota','obtenerPaciente','enlaceDeArchivo'].includes(name)) {
          const table = { obtenerNota: 'notas', obtenerPaciente: 'pacientes', enlaceDeArchivo: 'archivos' }[name];
          if ((await mine('queue')).some(q => q.table === table && q.result.id === args[0])) return localRead(name, args);
        }
        let value;
        try { value = await original[name](...args); }
        catch (e) {
          if (!networkError(e)) throw e;
          networkDown = true; notify();
          return localRead(name, args);
        }
        if (owner() !== uid) throw new Error('La cuenta cambió durante la consulta.');
        const cached = await withSyncLock(async () => {
          if (owner() !== uid) throw new Error('La cuenta cambió durante la consulta.');
          if ((await get('meta', `${uid}:cache-epoch`))?.value !== epoch) {
            try { return await localRead(name,args); }
            catch (e) { if (!e.message.startsWith('Esta información todavía')) throw e; }
          }
          await save(name,args,value);
          return (await mine('queue')).length ? localRead(name,args) : value;
        });
        recordConnection().catch(console.error);
        if (name === 'notasDePaciente' || name === 'archivosDePaciente') await catalog(value);
        // La cola local debe seguir visible aunque haya conexión y un conflicto.
        return hydrate(cached);
      };
    }
    for (const [name, fn] of Object.entries(original)) {
      if (typeof fn !== 'function' || readable.has(name) || ['puedePush','faltaEnEsquema','verificarEsquema','_autorizarOffline'].includes(name)) continue;
      api[name] = async (...args) => {
        if (writable.has(name)) {
          const value = await enqueue(name, args);
          if (online()) sync().catch(console.error);
          return value;
        }
        if (!online()) {
          throw new Error('Esta operación requiere internet. Los cambios de agenda están desactivados sin conexión.');
        }
        return fn(...args);
      };
    }
  }
  async function status() {
    const files = await mine('files'), pending = await mine('queue');
    const info = await get('meta', `${owner()}:prepared`);
    const error = await get('meta', `${owner()}:prepare-error`);
    const reads = await mine('reads');
    return { files, pending, preparing, running, last: info?.value, failures: info?.failures || 0, error: error?.value,
      fileBytes: files.reduce((n,f) => n + (f.blob?.size || 0), 0),
      textBytes: new Blob([JSON.stringify(reads)]).size,
      pendingBytes: pending.reduce((n,q) => n + (q.name === 'subirArchivo' ? q.args[1].size : new Blob([JSON.stringify(q)]).size), 0) };
  }
  async function measureFiles() {
    if (!online()) return;
    const uid = owner();
    const files = (await mine('files')).filter(f => !f.blob && !(f.expected > 0));
    // Consultar metadatos no descarga el contenido de las fotografías o PDF.
    for (let i = 0; i < files.length; i += 4) await Promise.all(files.slice(i, i+4).map(async f => {
      try {
        const result = await API.sb.storage.from(f.bucket).info(f.ruta);
        if (result.error || !Number.isFinite(result.data?.size) || owner() !== uid) return;
        await mergeFile(f.key, current => current ? { ...current, expected: result.data.size } : null);
      } catch { /* mostrar tamaño por calcular si no se pudo consultar */ }
    }));
  }
  async function keepAsNew(key) {
    const op = await get('queue', key);
    if (!op || op.owner !== owner() || !op.error || op.table !== 'valoraciones') throw new Error('Este cambio no se puede resolver como copia nueva.');
    const id = crypto.randomUUID(), now = new Date().toISOString();
    const result = { ...op.result, id, creado_en: now, actualizado_en: now };
    await put('queue', { ...op, name: 'guardarValoracion', result, base: null, change: id, error: null });
    notify();
    await sync();
  }
  global.Offline = { cachedSession, remember, install, prepare, sync, status, download, removeFiles, online, hydrate, keepAsNew, networkError, networkUnavailable, fileDay, measureFiles, connectionInfo };
  async function reconnect() {
    if (!session || navigator.onLine === false) return;
    networkDown = true;
    try {
      // El evento online también ocurre con Wi-Fi sin acceso a internet.
      const response = await API.sb.from('perfiles').select('id').eq('id', session.user.id).single();
      if (networkError(response.error)) throw response.error;
      networkDown = false;
      await recordConnection().catch(console.error);
      notify();
      await prepare();
    } catch (error) { if (networkError(error)) networkUnavailable(); }
  }
  global.addEventListener('online', () => reconnect().catch(console.error));
  global.addEventListener('offline', notify);
  setInterval(() => {
    if (!session || navigator.onLine === false || global.document?.visibilityState === 'hidden') return;
    if (networkDown) reconnect().catch(console.error);
    else sync().catch(console.error);
  }, 60000);
})(window);
