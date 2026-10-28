#!/usr/bin/env node
/* ==========================================================================
   CLIDANFI · test-funciones.js
   Prueba de regresión de la lógica de negocio que vive en js/api.js y que no
   se puede ver a simple vista: importes, ocupación de la agenda, cancelación,
   alta exprés, archivos del expediente y exclusión de rifas.

   Todas nacen de decisiones que sería fácil deshacer sin querer:
     · un cobro negativo o NaN entrando a la base
     · una cita cancelada que sigue ocupando su hueco
     · una columna que falta tumbando la operación entera
     · un binario huérfano en Storage cuando falla el registro
     · una exclusión de sorteo que se deshace sola al sincronizar

   Uso:  npm run test:funciones
         node scripts/test-funciones.js dist/js/api.js
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const API_JS = process.argv[2] ? path.resolve(process.argv[2]) : path.join(RAIZ, 'js', 'api.js');
console.log(`Objetivo: ${path.relative(RAIZ, API_JS) || API_JS}`);

let pasan = 0, fallan = 0;
const check = (cond, msg, extra = '') => {
  if (cond) { pasan++; console.log(`  ✓ ${msg}`); }
  else { fallan++; console.log(`  ✗ ${msg}${extra ? `\n      → ${extra}` : ''}`); }
};

/* --- Stub de supabase-js --------------------------------------------------
   Guarda cada consulta (tabla + métodos encadenados) para poder afirmar QUÉ
   se envió, no solo que no reventó. */
function montarAPI({ respuestas = {}, storage = {} } = {}) {
  const registro = [];
  const subidas = [];
  const borrados = [];

  const builder = (tabla) => {
    const entrada = { tabla, ops: [] };
    registro.push(entrada);

    const b = {};
    for (const m of ['select', 'eq', 'neq', 'gte', 'lte', 'order', 'limit',
                     'insert', 'update', 'delete', 'upsert', 'or', 'in']) {
      b[m] = (...args) => { entrada.ops.push([m, args]); return b; };
    }
    const resolver = () => {
      const f = respuestas[tabla];
      const r = typeof f === 'function' ? f(entrada) : f;
      return r === undefined || r === null ? { data: [], error: null } : r;
    };
    b.single = () => Promise.resolve(resolver());
    b.maybeSingle = () => Promise.resolve(resolver());
    b.then = (res, rej) => Promise.resolve(resolver()).then(res, rej);
    return b;
  };

  const SB = {
    from: builder,
    rpc: (nombre, args) => {
      registro.push({ tabla: `rpc:${nombre}`, ops: [['rpc', [args]]] });
      return Promise.resolve({ data: [{ creados: 2, eliminados: 0 }], error: null });
    },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'f@x.com' } } } }),
      getUser: async () => ({ data: { user: { id: 'u1', email: 'f@x.com' } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({})
    },
    storage: {
      from: (bucket) => ({
        upload: async (ruta, cuerpo, opts) => {
          subidas.push({ bucket, ruta, cuerpo, opts });
          return storage.uploadError ? { data: null, error: storage.uploadError } : { data: { path: ruta }, error: null };
        },
        createSignedUrl: async (ruta) => ({ data: { signedUrl: `https://proj.supabase.co/firmado/${ruta}` }, error: null }),
        getPublicUrl: (ruta) => ({ data: { publicUrl: `https://proj.supabase.co/publico/${ruta}` } }),
        remove: async (rutas) => {
          borrados.push(...rutas);
          const p = Promise.resolve({ data: null, error: null });
          p.catch = () => p;
          return p;
        }
      })
    }
  };

  const win = {};
  const ctx = {
    window: win, console, SB,
    UI: {
      startOfWeek: (d) => new Date(d),
      addDays: (d, n) => new Date(+new Date(d) + n * 864e5),
      isoDay: (d) => new Date(d).toISOString().slice(0, 10),
      normalize: (s) => String(s || ''),
      uid: (p) => `${p}-1`
    },
    // El catálogo clínico. `api.js` lo consulta para no dejar añadir una
    // opción de valoración que ya venía de fábrica.
    Store: {
      CATALOGO_EJERCICIOS: [{ id: 'ex_01', nombre: 'Chin tuck', categoria: 'Cervical', sets: 3, reps: 10, hold: 5 }],
      CATEGORIAS_EJERCICIO: ['Cervical', 'Lumbar'],
      CAMPOS_AMPLIABLES: ['select', 'checks', 'tests'],
      opcionesDeCampo: (sec, campo) =>
        (sec === 'antecedentes' && campo === 'patologicos') ? ['Diabetes', 'Hipertensión'] : [],
      ejercicio: (id) => (id === 'ex_01' ? { id, nombre: 'Chin tuck', categoria: 'Cervical' } : null)
    },
    Blob, atob, btoa, Uint8Array, TextDecoder, decodeURIComponent, encodeURIComponent,
    setTimeout, clearTimeout, Promise, Date, Math, JSON, Number, String, Object,
    Array, Error, TypeError, RegExp, Set, Map, Buffer, isNaN
  };
  ctx.globalThis = ctx;
  win.SB = SB; win.UI = ctx.UI;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(API_JS, 'utf8'), ctx, { filename: 'api.js' });

  return { API: win.API, registro, subidas, borrados };
}

/* El perfil manda: sin un `fisio` aquí, el guardia corta todas las llamadas. */
const PERFIL_FISIO = () => ({ data: { id: 'u1', rol: 'fisio', nombre: 'Fisio' }, error: null });
const capturar = async (fn) => { try { await fn(); return ''; } catch (e) { return e.message; } };
const ultima = (registro, tabla, metodo) =>
  [...registro].reverse().find((r) => r.tabla === tabla && r.ops.some(([m]) => m === metodo));
const argsDe = (entrada, metodo) => (entrada.ops.find(([m]) => m === metodo) || [null, []])[1][0];

(async () => {
  /* ======================================================================
     1 · IMPORTES: nada raro llega a la tabla `pagos`
     ====================================================================== */
  console.log('\n1 · Validación de importes en los cobros');
  {
    const { API, registro } = montarAPI({
      respuestas: { perfiles: PERFIL_FISIO, pagos: () => ({ data: { id: 'pg1' }, error: null }) }
    });

    check(/negativo/i.test(await capturar(() => API.registrarPago({ paciente_id: 'p1', monto: -50 }))),
      'un cobro negativo se rechaza con un motivo claro');
    check(!!(await capturar(() => API.registrarPago({ paciente_id: 'p1', monto: 'abc' }))),
      'un monto que no es número se rechaza');
    check(/obligatorio/i.test(await capturar(() => API.registrarPago({ paciente_id: 'p1', monto: '' }))),
      'un monto vacío se rechaza en vez de guardarse como 0');

    check(!(await capturar(() => API.registrarPago({ paciente_id: 'p1', monto: '450.50' }))),
      'un importe válido en texto sí pasa');
    const pago = argsDe(ultima(registro, 'pagos', 'insert'), 'insert');
    check(pago && pago.monto === 450.5, `el importe llega numérico y redondeado a centavos (${pago && pago.monto})`);

    check(/negativo/i.test(await capturar(() => API.setConfig({ precio_sesion: -1 }))),
      'la tarifa de la clínica tampoco admite negativos');
  }

  /* ======================================================================
     2 · La asistencia NO se registra si el cobro viene mal
     ====================================================================== */
  console.log('\n2 · Un cobro inválido no deja la asistencia a medias');
  {
    const { API, registro } = montarAPI({
      respuestas: { perfiles: PERFIL_FISIO, asistencias: () => ({ data: { id: 'a1' }, error: null }) }
    });

    const err = await capturar(() => API.registrarAsistencia({ paciente_id: 'p1', monto: -10 }));
    check(!!err, 'la operación falla', err);
    check(!ultima(registro, 'asistencias', 'insert'),
      'no se insertó la asistencia (ni se emitieron boletos ni se descontó la sesión)');
  }

  /* ======================================================================
     3 · OCUPACIÓN DE LA AGENDA
     ====================================================================== */
  console.log('\n3 · Huecos ocupados y horarios liberados');
  {
    const CITAS = [
      { id: 'c1', paciente_id: 'p1', inicia_en: '2026-03-02T16:00:00.000Z', duracion_min: 45, estado: 'agendada', pacientes: { nombre: 'Ana' } },
      { id: 'c2', paciente_id: 'p2', inicia_en: '2026-03-02T18:00:00.000Z', duracion_min: 45, estado: 'agendada', pacientes: { nombre: 'Beto' } }
    ];
    const { API, registro } = montarAPI({
      respuestas: { perfiles: PERFIL_FISIO, citas: () => ({ data: CITAS, error: null }) }
    });

    const pisa = await API.conflictosDeAgenda({ inicia_en: '2026-03-02T16:30:00.000Z', duracion_min: 45 });
    check(pisa.length === 1 && pisa[0].id === 'c1', `detecta el solape parcial (${pisa.map((c) => c.id)})`);
    check(pisa[0].paciente_nombre === 'Ana', 'el aviso puede decir con quién choca');

    const pegada = await API.conflictosDeAgenda({ inicia_en: '2026-03-02T16:45:00.000Z', duracion_min: 45 });
    check(pegada.length === 0, 'una cita que empieza justo al terminar la anterior NO es conflicto');

    const propia = await API.conflictosDeAgenda({ inicia_en: '2026-03-02T16:00:00.000Z', duracion_min: 45, excluirId: 'c1' });
    check(propia.length === 0, 'al reagendar, la cita no choca consigo misma');

    const consulta = ultima(registro, 'citas', 'select');
    const filtroEstado = consulta.ops.find(([m, a]) => m === 'eq' && a[0] === 'estado');
    check(filtroEstado && filtroEstado[1][1] === 'agendada',
      'solo se cuentan las citas vivas: cancelar libera el horario');
  }

  /* ======================================================================
     4 · CANCELAR ≠ BORRAR
     ====================================================================== */
  console.log('\n4 · Cancelación de una cita');
  {
    const { API, registro } = montarAPI({
      respuestas: { perfiles: PERFIL_FISIO, citas: () => ({ data: { id: 'c1', estado: 'cancelada' }, error: null }) }
    });

    await API.cancelarCita('c1', { motivo: 'El paciente no puede asistir' });
    const upd = ultima(registro, 'citas', 'update');
    const patch = argsDe(upd, 'update');

    check(patch.estado === 'cancelada', 'cambia el estatus a «cancelada»');
    check(patch.motivo_cancelacion === 'El paciente no puede asistir', 'guarda el motivo');
    check(!!patch.cancelada_en, 'sella cuándo se canceló');
    check(!upd.ops.some(([m]) => m === 'delete'), 'NO borra la cita: el historial se conserva');
  }

  /* ======================================================================
     5 · BASE DESACTUALIZADA: se guarda lo que quepa, no se pierde todo
     ====================================================================== */
  console.log('\n5 · Tolerancia a columnas que aún no existen');
  {
    let intentos = 0;
    const { API, registro } = montarAPI({
      respuestas: {
        perfiles: PERFIL_FISIO,
        citas: () => {
          intentos++;
          // Primer intento: la base no conoce `precio` todavía.
          return intentos === 1
            ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'precio' column of 'citas'" } }
            : { data: { id: 'c9' }, error: null };
        }
      }
    });

    const cita = await API.crearCita({ paciente_id: 'p1', inicia_en: '2026-03-02T16:00:00.000Z', precio: 500 });
    check(cita && cita.id === 'c9', 'la cita se agenda igual, sin el precio');
    check(intentos === 2, `se reintentó una sola vez (intentos: ${intentos})`);

    const segundo = [...registro].reverse().find((r) => r.tabla === 'citas');
    check(!('precio' in argsDe(segundo, 'insert')), 'el reintento va sin la columna que falta');
    check(API.faltaEnEsquema() === null, 'una columna ausente no se confunde con una tabla ausente');
  }

  /* ======================================================================
     6 · ALTA EXPRÉS (agendar sin registro previo)
     ====================================================================== */
  console.log('\n6 · Paciente nuevo con solo nombre y teléfono');
  {
    const { API, registro } = montarAPI({
      respuestas: { perfiles: PERFIL_FISIO, pacientes: () => ({ data: { id: 'p9' }, error: null }) }
    });

    check(/nombre/i.test(await capturar(() => API.crearPacienteExpres({ nombre: '   ' }))),
      'sin nombre no se crea nada');

    await API.crearPacienteExpres({ nombre: '  Laura Ruiz ', telefono: '667 123 4567', motivo: 'Cervicalgia' });
    const fila = argsDe(ultima(registro, 'pacientes', 'insert'), 'insert');

    check(fila.nombre === 'Laura Ruiz', 'el nombre se guarda sin espacios sobrantes');
    check(fila.expediente_pendiente === true, 'queda marcado como historial pendiente');
    check(fila.paquete_total === 0, 'no se le inventa un paquete de sesiones contratado');
    check(fila.diagnostico === 'Cervicalgia', 'el motivo de consulta se aprovecha como diagnóstico inicial');
  }

  /* ======================================================================
     7 · ARCHIVOS DEL EXPEDIENTE
     ====================================================================== */
  console.log('\n7 · Subida de imágenes y PDF al expediente');
  {
    const pdf = { name: 'resonancia.pdf', type: 'application/pdf', size: 1024 * 512 };
    const exe = { name: 'virus.exe', type: 'application/x-msdownload', size: 100 };
    const enorme = { name: 'tomografia.png', type: 'image/png', size: 25 * 1024 * 1024 };

    const { API, registro, subidas } = montarAPI({
      respuestas: { perfiles: PERFIL_FISIO, archivos: () => ({ data: { id: 'ar1', ruta: 'p1/arch-1.pdf', mime: 'application/pdf' }, error: null }) }
    });

    check(/formato/i.test(await capturar(() => API.subirArchivo('p1', exe))), 'un ejecutable se rechaza');
    check(/20 MB/.test(await capturar(() => API.subirArchivo('p1', enorme))), 'un archivo de 25 MB se rechaza por tamaño');
    check(subidas.length === 0, 'ninguno de los dos llegó a tocar el Storage');

    const guardado = await API.subirArchivo('p1', pdf, { titulo: 'Resonancia lumbar' });
    check(subidas.length === 1 && subidas[0].bucket === 'expedientes', 'el PDF sube al bucket privado `expedientes`');
    check(/^p1\//.test(subidas[0].ruta) && /\.pdf$/.test(subidas[0].ruta),
      `la ruta cuelga del paciente y conserva la extensión (${subidas[0].ruta})`);
    check(subidas[0].opts.contentType === 'application/pdf', 'se envía el contentType real, sin convertir a JPEG');
    check(guardado.es_pdf === true && /firmado/.test(guardado.url || ''),
      'vuelve marcado como PDF y con una URL firmada, no pública');

    const fila = argsDe(ultima(registro, 'archivos', 'insert'), 'insert');
    check(fila.titulo === 'Resonancia lumbar' && fila.tamano === pdf.size, 'se registran título y tamaño');
    check(!('url' in fila), 'la URL NO se persiste: se firma en cada lectura y caduca');
  }

  console.log('\n8 · Si falla el registro, no queda basura en el Storage');
  {
    const { API, subidas, borrados } = montarAPI({
      respuestas: {
        perfiles: PERFIL_FISIO,
        archivos: () => ({ data: null, error: { code: '42501', message: 'permission denied for table archivos' } })
      }
    });

    const err = await capturar(() => API.subirArchivo('p1', { name: 'rx.png', type: 'image/png', size: 2048 }));
    check(!!err, 'la subida falla con un motivo', err);
    check(subidas.length === 1 && borrados.length === 1 && borrados[0] === subidas[0].ruta,
      'el binario recién subido se retira del bucket');
  }

  /* ======================================================================
     9 · EXCLUIR DE UNA RIFA
     ====================================================================== */
  console.log('\n9 · Quitar a un participante de un sorteo');
  {
    const { API, registro } = montarAPI({
      respuestas: {
        perfiles: PERFIL_FISIO,
        sorteo_excluidos: () => ({ data: null, error: null }),
        boletos: () => ({ data: [{ id: 'b1' }, { id: 'b2' }], error: null })
      }
    });

    const r = await API.excluirDeSorteo('s1', 'p1', { motivo: 'Personal de la clínica' });
    check(r.permanente === true, 'la exclusión queda registrada en el servidor');
    check(r.boletos_eliminados === 2, `se retiran sus boletos (${r.boletos_eliminados})`);

    const exc = ultima(registro, 'sorteo_excluidos', 'upsert');
    const fila = argsDe(exc, 'upsert');
    check(fila.sorteo_id === 's1' && fila.paciente_id === 'p1', 'se apunta a quién y de qué sorteo');
    check(ultima(registro, 'boletos', 'delete').ops.filter(([m]) => m === 'eq').length === 2,
      'el borrado de boletos se acota al sorteo Y al paciente');
  }

  console.log('\n10 · Sin la tabla `sorteo_excluidos` se avisa de que no es permanente');
  {
    const { API } = montarAPI({
      respuestas: {
        perfiles: PERFIL_FISIO,
        sorteo_excluidos: () => ({ data: null, error: { code: '42P01', message: 'relation "sorteo_excluidos" does not exist' } }),
        boletos: () => ({ data: [{ id: 'b1' }], error: null })
      }
    });

    const r = await API.excluirDeSorteo('s1', 'p1');
    check(r.permanente === false, 'se informa de que la exclusión NO sobrevivirá a la sincronización');
    check(r.boletos_eliminados === 1, 'aun así se retiran los boletos actuales');
    check(/sorteo_excluidos/.test(API.faltaEnEsquema() || ''), 'y se apunta la tabla que falta en la base');
  }

  /* ======================================================================
     11 · ENLACES DE WHATSAPP  (js/ui.js)
     Un enlace mal formado no da error: abre WhatsApp con un número que no
     existe, y eso solo se descubre cuando el paciente no recibe nada.
     ====================================================================== */
  console.log('\n11 · Enlaces de WhatsApp');
  {
    const winUI = {};
    const ctxUI = {
      window: winUI, console, document: undefined,
      encodeURIComponent, decodeURIComponent, Intl, Date, Math, JSON,
      Number, String, Object, Array, Error, RegExp, Set, Map, isNaN, parseInt, parseFloat
    };
    ctxUI.globalThis = ctxUI;
    vm.createContext(ctxUI);
    vm.runInContext(fs.readFileSync(path.join(path.dirname(API_JS), 'ui.js'), 'utf8'), ctxUI, { filename: 'ui.js' });
    const { telWhatsApp, waLink } = winUI.UI;

    check(telWhatsApp('667 123 4567') === '526671234567', 'un móvil nacional de 10 dígitos recibe la lada 52');
    check(telWhatsApp('+52 667 123 4567') === '526671234567', 'un número que ya trae país no se duplica');
    check(telWhatsApp('(667) 123-4567') === '526671234567', 'los separadores y paréntesis no estorban');
    check(telWhatsApp('04491234567') === '524491234567', 'el viejo prefijo 044 se descarta sin comerse la lada 449');
    check(telWhatsApp('449 123 4567') === '524491234567', 'un 449 real (Aguascalientes) sobrevive intacto');
    check(telWhatsApp('123') === '', 'un teléfono demasiado corto devuelve vacío, no un enlace roto');
    check(telWhatsApp('') === '' && telWhatsApp(null) === '', 'sin teléfono no hay número');

    check(waLink('667 123 4567', 'Hola Ana').startsWith('https://wa.me/526671234567?text='),
      'el enlace apunta a wa.me con el número normalizado');
    check(/Hola%20Ana/.test(waLink('6671234567', 'Hola Ana')), 'el mensaje viaja codificado');
    check(waLink('123', 'Hola') === '', 'sin número utilizable no se genera enlace');

    const conSaltos = waLink('6671234567', 'Línea 1\nLínea 2');
    check(!/\n/.test(conSaltos) && /%0A/.test(conSaltos), 'los saltos de línea del mensaje se codifican');
  }

  /* ======================================================================
     12 · BITÁCORA DE CANCELACIÓN
     Sin motivo, una cita cancelada es indistinguible de un hueco cualquiera
     tres meses después, que es justo cuando hace falta saber si el paciente
     abandonó el tratamiento.
     ====================================================================== */
  console.log('\n12 · Cancelar deja constancia de quién y por qué');
  {
    const { API, registro } = montarAPI({
      respuestas: { perfiles: PERFIL_FISIO, citas: () => ({ data: { id: 'c1' }, error: null }) }
    });

    check(/motivo/i.test(await capturar(() => API.cancelarCita('c1', { motivo: '   ' }))),
      'sin motivo no se cancela');
    check(!ultima(registro, 'citas', 'update'), 'y no se tocó la cita');

    await API.cancelarCita('c1', { motivo: 'Se va de viaje', quien: 'Paciente' });
    const patch = argsDe(ultima(registro, 'citas', 'update'), 'update');
    check(patch.cancelada_por === 'Paciente', 'se guarda quién decidió cancelar');
    check(patch.motivo_cancelacion === 'Se va de viaje', 'y la razón');
    check(patch.cancelada_por_usuario === 'u1', 'se sella qué usuario lo tecleó, sin preguntárselo');

    await API.cancelarCita('c1', { motivo: 'Otro', quien: 'InventadoPorAlguien' });
    const p2 = argsDe(ultima(registro, 'citas', 'update'), 'update');
    check(p2.cancelada_por === 'Otro', 'un responsable fuera de catálogo cae en «Otro»');
  }

  /* ======================================================================
     13 · FALTAS  ≠  CANCELACIONES
     ====================================================================== */
  console.log('\n13 · Marcar falta al paciente');
  {
    const { API, registro } = montarAPI({
      respuestas: {
        perfiles: PERFIL_FISIO,
        citas: (e) => e.ops.some(([m]) => m === 'select' || m === 'update')
          ? { data: [
              { id: 'x1', estado: 'completada', inicia_en: '2026-01-05T16:00:00.000Z' },
              { id: 'x2', estado: 'completada', inicia_en: '2026-01-06T16:00:00.000Z' },
              { id: 'x3', estado: 'no_asistio', inicia_en: '2026-01-07T16:00:00.000Z' },
              { id: 'x4', estado: 'cancelada',  inicia_en: '2026-01-08T16:00:00.000Z' }
            ], error: null }
          : { data: [], error: null }
      }
    });

    await API.marcarFalta('c1', { motivo: 'No avisó', justificada: false });
    const patch = argsDe(ultima(registro, 'citas', 'update'), 'update');
    check(patch.estado === 'no_asistio', 'la cita queda como «no asistió»');
    check(!!patch.falta_en, 'se sella cuándo se registró la falta');
    check(patch.motivo_falta === 'No avisó' && patch.falta_justificada === false, 'se guardan motivo y matiz');

    const c = await API.cumplimientoDePaciente('p1');
    check(c.asistidas === 2 && c.faltas === 1 && c.canceladas === 1,
      `se cuentan por separado (${c.asistidas}/${c.faltas}/${c.canceladas})`);
    // 2 de 3 = 67 %. Si las canceladas penalizaran serían 2 de 4 = 50 %.
    check(c.cumplimiento === 67,
      `cancelar no baja el cumplimiento: avisar es lo que se quiere fomentar (${c.cumplimiento}%)`);
  }

  /* ======================================================================
     14 · ANULAR UNA PARTICIPACIÓN, NO A LA PERSONA
     ====================================================================== */
  console.log('\n14 · Quitar un boleto suelto de una rifa');
  {
    const { API, registro } = montarAPI({
      respuestas: { perfiles: PERFIL_FISIO, boletos: () => ({ data: { id: 'b1', anulado_en: 'x' }, error: null }) }
    });

    await API.anularBoleto('b1', { motivo: 'Asistencia duplicada' });
    const upd = ultima(registro, 'boletos', 'update');
    const patch = argsDe(upd, 'update');

    check(!!patch.anulado_en, 'el boleto queda marcado como anulado');
    check(patch.motivo_anulacion === 'Asistencia duplicada', 'con su motivo');
    check(patch.anulado_por === 'u1', 'y con quién lo anuló');
    // Lo esencial: si se BORRARA, `sincronizar_boletos` lo repondría en el
    // siguiente guardado del sorteo, porque su asistencia sigue existiendo.
    check(!upd.ops.some(([m]) => m === 'delete'),
      'NO se borra la fila: si se borrara, la sincronización lo repondría');

    await API.restaurarBoleto('b1');
    const vuelta = argsDe(ultima(registro, 'boletos', 'update'), 'update');
    check(vuelta.anulado_en === null, 'devolver la participación limpia la marca');
  }

  console.log('\n15 · Sin las columnas de anulación se avisa en vez de fallar raro');
  {
    const { API } = montarAPI({
      respuestas: {
        perfiles: PERFIL_FISIO,
        boletos: () => ({ data: null, error: { code: 'PGRST204', message: "Could not find the 'anulado_en' column of 'boletos'" } })
      }
    });
    const err = await capturar(() => API.anularBoleto('b1'));
    check(/schema\.sql/.test(err), `el mensaje dice cómo arreglarlo (${err})`);
  }

  /* ======================================================================
     16 · CATÁLOGO DE EJERCICIOS EDITABLE
     ====================================================================== */
  console.log('\n16 · Alta y edición de ejercicios');
  {
    const { API, registro, subidas } = montarAPI({
      respuestas: {
        perfiles: PERFIL_FISIO,
        ejercicios: () => ({ data: { id: 'ej_x-1', nombre: 'Puente a una pierna' }, error: null }),
        rutina_items: () => ({ data: [], error: null, count: 0 })
      }
    });

    check(/nombre/i.test(await capturar(() => API.guardarEjercicio({ nombre: '  ' }))), 'sin nombre no se guarda');
    check(/categor/i.test(await capturar(() => API.guardarEjercicio({ nombre: 'X', categoria: '' }))), 'sin categoría tampoco');

    await API.guardarEjercicio({
      nombre: '  Puente a una pierna ', categoria: 'Lumbar', sets: 3, reps: 12,
      foto: 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
    });

    check(subidas.length === 1 && subidas[0].bucket === 'ejercicios', 'la foto sube al bucket `ejercicios`');
    const fila = argsDe(ultima(registro, 'ejercicios', 'upsert'), 'upsert');
    check(fila.nombre === 'Puente a una pierna', 'el nombre se limpia de espacios');
    check(fila.propio === true, 'queda marcado como propio de la clínica');
    check(/^ej_/.test(fila.id), `el id nuevo no puede chocar con los del catálogo base (${fila.id})`);
    check(!!fila.image_url && !!fila.image_ruta, 'se guardan la url pública y la ruta del objeto');
  }

  console.log('\n17 · Un ejercicio en uso se desactiva, no se borra');
  {
    const { API, registro } = montarAPI({
      respuestas: {
        perfiles: PERFIL_FISIO,
        // 2 rutinas lo usan
        rutina_items: () => ({ data: [], error: null, count: 2 }),
        ejercicios: () => ({ data: { id: 'ex_01' }, error: null })
      }
    });

    const r = await API.eliminarEjercicio('ex_01');
    check(r.borrado === false && r.desactivado === true, 'no se borra');
    check(r.rutinas === 2, 'y se dice en cuántas rutinas se usa');
    check(argsDe(ultima(registro, 'ejercicios', 'update'), 'update').activo === false,
      'se desactiva: las rutinas ya entregadas no pueden quedar con un hueco');
  }

  /* ======================================================================
     18 · OPCIONES PERSONALIZADAS DE LA VALORACIÓN
     ====================================================================== */
  console.log('\n18 · Ampliar una lista de la valoración');
  {
    const { API, registro } = montarAPI({
      respuestas: {
        perfiles: PERFIL_FISIO,
        valoracion_opciones: () => ({ data: { id: 'vo1' }, error: null })
      }
    });

    check(/opción|opcion/i.test(await capturar(() => API.agregarOpcionValoracion('antecedentes', 'patologicos', '  '))),
      'una opción vacía se rechaza');

    // El catálogo base ya trae «Diabetes»: añadirla otra vez la duplicaría en
    // pantalla, así que se detecta antes de tocar la base.
    const ya = await API.agregarOpcionValoracion('antecedentes', 'patologicos', 'diabetes');
    check(ya.ya === true, 'no se duplica algo que ya viene en el catálogo base');
    check(!ultima(registro, 'valoracion_opciones', 'insert'), 'y no se escribió nada');

    const nueva = await API.agregarOpcionValoracion('antecedentes', 'patologicos', 'Fibromialgia');
    check(nueva.ya === false, 'una opción nueva sí se guarda');
    const fila = argsDe(ultima(registro, 'valoracion_opciones', 'insert'), 'insert');
    check(fila.seccion === 'antecedentes' && fila.campo === 'patologicos' && fila.valor === 'Fibromialgia',
      'se guarda con la ruta del campo al que pertenece');
  }

  console.log('\n19 · Opciones repetidas y base sin la tabla');
  {
    const { API } = montarAPI({
      respuestas: {
        perfiles: PERFIL_FISIO,
        valoracion_opciones: () => ({ data: null, error: { code: '23505', message: 'duplicate key value' } })
      }
    });
    const r = await API.agregarOpcionValoracion('dolor', 'tipo', 'Punzante');
    check(r.ya === true, 'añadir dos veces la misma no es un error: se avisa y ya');

    const { API: API2 } = montarAPI({
      respuestas: {
        perfiles: PERFIL_FISIO,
        valoracion_opciones: () => ({ data: null, error: { code: '42P01', message: 'relation "valoracion_opciones" does not exist' } })
      }
    });
    check(/schema\.sql/.test(await capturar(() => API2.agregarOpcionValoracion('dolor', 'tipo', 'Urente'))),
      'sin la tabla, el mensaje dice qué ejecutar');
    check((await API2.opcionesValoracion()) && Object.keys(await API2.opcionesValoracion()).length === 0,
      'y leerlas devuelve vacío en vez de tumbar la valoración');
  }

  /* ======================================================================
     20 · SUSCRIPCIÓN PUSH
     ====================================================================== */
  console.log('\n20 · Registro de un aparato para los avisos');
  {
    const { API, registro } = montarAPI({
      respuestas: { perfiles: PERFIL_FISIO, push_suscripciones: () => ({ data: { id: 'ps1' }, error: null }) }
    });

    check(!!(await capturar(() => API.registrarPush({ endpoint: 'https://x/y' }))),
      'una suscripción sin claves se rechaza');

    await API.registrarPush({
      endpoint: 'https://fcm.googleapis.com/fcm/send/AAA',
      keys: { p256dh: 'BPk...', auth: 'k9...' }
    }, { agente: 'Chrome/Android' });

    const up = ultima(registro, 'push_suscripciones', 'upsert');
    const fila = argsDe(up, 'upsert');
    check(fila.endpoint === 'https://fcm.googleapis.com/fcm/send/AAA', 'se guarda el endpoint del navegador');
    check(fila.usuario_id === 'u1', 'atada al usuario en sesión, no al que diga el cliente');
    check(fila.p256dh === 'BPk...' && fila.auth === 'k9...', 'con sus dos claves de cifrado');
    // Si fuera insert, volver a conceder el permiso reventaría por unicidad
    // justo cuando el usuario acaba de decir que sí.
    check(!up.ops.some(([m]) => m === 'insert'), 'es upsert: reactivar el permiso no puede fallar por duplicado');
  }

  console.log(`\n${'─'.repeat(60)}\n${pasan} pasan · ${fallan} fallan\n`);
  process.exit(fallan ? 1 : 0);
})();
