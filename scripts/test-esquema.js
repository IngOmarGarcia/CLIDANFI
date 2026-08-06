#!/usr/bin/env node
/* ==========================================================================
   CLIDANFI · test-esquema.js
   Prueba de regresión de la detección de esquema de js/api.js.

   Nace de un fallo real: el panel avisaba «Falta solicitudes_cita» con la
   tabla creada y accesible. La causa era que `opcional()` atribuía CUALQUIER
   error de objeto ausente a esa tabla, viniera de la consulta que viniera, y
   que `_esFalta()` aceptaba mensajes ambiguos («does not exist», «Not Found»)
   que también produce una columna que falta o un 404 del proxy.

   Uso:  npm run test:esquema            (comprueba js/api.js)
         node scripts/test-esquema.js dist/js/api.js
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const API_JS = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(RAIZ, 'js', 'api.js');
console.log(`Objetivo: ${path.relative(RAIZ, API_JS) || API_JS}`);

let pasan = 0, fallan = 0;
const check = (cond, msg, extra = '') => {
  if (cond) { pasan++; console.log(`  ✓ ${msg}`); }
  else { fallan++; console.log(`  ✗ ${msg}${extra ? `\n      → ${extra}` : ''}`); }
};

/* --- Stub mínimo de supabase-js ------------------------------------------ */
function crearSB(respuestas) {
  // respuestas: { tabla: () => ({ data, error, count }) }
  const resolver = (tabla) => {
    const f = respuestas[tabla];
    if (!f) return { data: [], error: null, count: 0 };
    return f();
  };

  const builder = (tabla) => {
    const b = {};
    const enc = () => b;
    for (const m of ['select', 'eq', 'neq', 'gte', 'lte', 'order', 'limit',
                     'insert', 'update', 'delete', 'upsert']) b[m] = enc;
    b.single = () => Promise.resolve(resolver(tabla));
    b.maybeSingle = () => Promise.resolve(resolver(tabla));
    b.then = (res, rej) => Promise.resolve(resolver(tabla)).then(res, rej);
    return b;
  };

  return {
    from: builder,
    rpc: () => Promise.resolve({ data: [], error: null }),
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'f@x.com' } } } }),
      getUser: async () => ({ data: { user: { id: 'u1', email: 'f@x.com' } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({})
    },
    storage: { from: () => ({}) }
  };
}

/* --- Carga api.js en un contexto aislado --------------------------------- */
function cargarAPI(respuestas) {
  const win = {};
  const ctx = {
    window: win, console,
    SB: crearSB(respuestas),
    UI: {
      startOfWeek: (d) => new Date(d),
      addDays: (d, n) => new Date(new Date(d).getTime() + n * 86400000),
      isoDay: (d) => new Date(d).toISOString().slice(0, 10),
      normalize: (s) => String(s || '').toLowerCase(),
      uid: () => 'id'
    },
    setTimeout, clearTimeout, Promise, Date, Math, JSON, Number, String, Object, Array, Error
  };
  ctx.globalThis = ctx;
  win.SB = ctx.SB; win.UI = ctx.UI;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(API_JS, 'utf8'), ctx, { filename: 'api.js' });
  return win.API;
}

const perfilFisio = () => ({ data: { id: 'u1', rol: 'fisio', nombre: 'Fisio' }, error: null });

/* ========================================================================== */
(async () => {

  console.log('\n1 · Un fallo en `configuracion` NO debe culpar a solicitudes_cita');
  {
    const API = cargarAPI({
      perfiles: perfilFisio,
      // El caso real: columna que la base todavía no tiene.
      configuracion: () => ({ data: null, error: { code: '42703', message: 'column configuracion.precio_sesion does not exist' } }),
      solicitudes_cita: () => ({ data: [], error: null, count: 0 })
    });
    await API.getConfig();
    const falta = API.faltaEnEsquema();
    check(falta !== 'solicitudes_cita',
      'no se reporta solicitudes_cita cuando el fallo fue en configuracion',
      `faltaEnEsquema() devolvió ${JSON.stringify(falta)}`);
  }

  console.log('\n2 · Una columna que falta no es una tabla que falta');
  {
    const API = cargarAPI({
      perfiles: perfilFisio,
      configuracion: () => ({ data: null, error: { code: '42703', message: 'column configuracion.precio_sesion does not exist' } })
    });
    await API.getConfig();
    check(API.faltaEnEsquema() === null,
      'un error 42703 (columna) no marca la base como desactualizada',
      `faltaEnEsquema() devolvió ${JSON.stringify(API.faltaEnEsquema())}`);
  }

  console.log('\n3 · Un 404 genérico («Not Found») no es una tabla ausente');
  {
    const API = cargarAPI({
      perfiles: perfilFisio,
      configuracion: () => ({ data: null, error: { message: 'Not Found' } })
    });
    await API.getConfig();
    check(API.faltaEnEsquema() === null,
      'un «Not Found» suelto no marca la base como desactualizada',
      `faltaEnEsquema() devolvió ${JSON.stringify(API.faltaEnEsquema())}`);
  }

  console.log('\n4 · El aviso se limpia solo cuando la tabla responde bien');
  {
    let primeraVez = true;
    const API = cargarAPI({
      perfiles: perfilFisio,
      configuracion: () => ({ data: null, error: null }),
      solicitudes_cita: () => {
        if (primeraVez) {   // caché de PostgREST aún fría tras el deploy
          primeraVez = false;
          return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.solicitudes_cita' in the schema cache" } };
        }
        return { data: [], error: null, count: 0 };
      }
    });
    await API.listarSolicitudes();
    check(API.faltaEnEsquema() === 'solicitudes_cita',
      'el primer fallo real sí se registra',
      `faltaEnEsquema() devolvió ${JSON.stringify(API.faltaEnEsquema())}`);
    await API.listarSolicitudes();
    check(API.faltaEnEsquema() === null,
      'al responder bien, el aviso desaparece (no se queda pegado)',
      `faltaEnEsquema() devolvió ${JSON.stringify(API.faltaEnEsquema())}`);
  }

  console.log('\n5 · RLS/permisos denegados no es «base desactualizada»');
  {
    const API = cargarAPI({
      perfiles: perfilFisio,
      configuracion: () => ({ data: null, error: null }),
      solicitudes_cita: () => ({ data: null, error: { code: '42501', message: 'permission denied for table solicitudes_cita' } })
    });
    let msg = '';
    try { await API.listarSolicitudes(); } catch (e) { msg = e.message; }
    check(API.faltaEnEsquema() === null,
      'un 42501 no marca la tabla como inexistente',
      `faltaEnEsquema() devolvió ${JSON.stringify(API.faltaEnEsquema())}`);
    check(/permiso|polít|RLS/i.test(msg),
      'el error de permisos se explica como tal',
      `mensaje: ${JSON.stringify(msg)}`);
  }

  console.log('\n6 · El dashboard no revienta si solicitudes_cita falla');
  {
    const API = cargarAPI({
      perfiles: perfilFisio,
      configuracion: () => ({ data: null, error: null }),
      solicitudes_cita: () => ({ data: null, error: { code: '42501', message: 'permission denied for table solicitudes_cita' } }),
      pagos: () => ({ data: [], error: null }),
      citas: () => ({ data: [], error: null }),
      promociones: () => ({ data: [], error: null })
    });
    let r = null, err = '';
    try { r = await API.resumenDashboard(); } catch (e) { err = e.message; }
    check(r !== null, 'resumenDashboard() se completa', `lanzó: ${err}`);
    check(r && r.solicitudes_nuevas === 0, 'solicitudes_nuevas cae a 0 sin romper nada');
  }

  console.log(`\n${'─'.repeat(60)}\n${pasan} pasan · ${fallan} fallan\n`);
  process.exit(fallan ? 1 : 0);
})();
