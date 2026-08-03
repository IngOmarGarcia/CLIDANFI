#!/usr/bin/env node
/* ==========================================================================
   CLIDANFI · check-schema.js
   Cruza lo que consulta el cliente (js/api.js) con lo que define la base
   (supabase/schema.sql). Sirve para cazar los 404 de PostgREST ANTES de
   desplegar: tabla renombrada, vista que falta, RPC inexistente, columna
   con otro nombre…

   Uso:  npm run check
   ========================================================================== */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const api = fs.readFileSync(path.join(RAIZ, 'js', 'api.js'), 'utf8');
const sql = fs.readFileSync(path.join(RAIZ, 'supabase', 'schema.sql'), 'utf8');

let fallos = 0;
const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fallos++; };

/* --- Lo que DEFINE el esquema -------------------------------------------- */
const tablas  = new Set([...sql.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]));
const vistas  = new Set([...sql.matchAll(/create view (\w+)/g)].map((m) => m[1]));
const funcs   = new Set([...sql.matchAll(/create or replace function (\w+)\s*\(/g)].map((m) => m[1]));
const buckets = new Set([...sql.matchAll(/\('(\w+)',\s*'\w+',\s*(?:true|false)\)/g)].map((m) => m[1]));

/* --- Lo que USA el cliente ------------------------------------------------
   `storage.from('bucket')` se excluye del recuento de tablas: son buckets. */
const conStorage = new Set([...api.matchAll(/storage\.from\('(\w+)'\)/g)].map((m) => m[1]));
const usaTablas = [...new Set(
  [...api.matchAll(/(?<!storage)\.from\('([\w.]+)'\)/g)].map((m) => m[1])
)].filter((t) => !conStorage.has(t)).sort();

const usaRpc = [...new Set([...api.matchAll(/\.rpc\('(\w+)'/g)].map((m) => m[1]))].sort();

console.log('── Tablas y vistas ──');
usaTablas.forEach((t) => {
  const tipo = vistas.has(t) ? '(vista)' : tablas.has(t) ? '(tabla)' : '';
  ok(tablas.has(t) || vistas.has(t),
    `${t.padEnd(22)} ${tipo || '← no existe en schema.sql · daría 404'}`);
});

console.log('\n── Funciones RPC ──');
usaRpc.forEach((f) => ok(funcs.has(f), `${f.padEnd(22)}${funcs.has(f) ? '' : ' ← no existe en schema.sql · daría 404'}`));

console.log('\n── Buckets de Storage ──');
[...conStorage].forEach((b) => ok(buckets.has(b), `${b.padEnd(22)}${buckets.has(b) ? '' : ' ← no existe en schema.sql'}`));

/* --- Columnas usadas en filtros -------------------------------------------
   Cada trozo llega SOLO hasta el siguiente .from(, para no mezclar consultas
   distintas que estén en el mismo Promise.all. */
console.log('\n── Columnas en filtros .eq() / .gte() / .lte() ──');

const columnasDe = (tabla) => {
  const m = sql.match(new RegExp(`create table if not exists ${tabla} \\(([\\s\\S]*?)\\n\\);`));
  return m ? new Set([...m[1].matchAll(/^\s{2}(\w+)\s+\w/gm)].map((x) => x[1])) : null;
};

const vistos = new Set();
for (const m of api.matchAll(/\.from\('([\w.]+)'\)([\s\S]*?)(?=\.from\('|$)/g)) {
  const tabla = m[1];
  if (conStorage.has(tabla)) continue;
  // Las vistas heredan las columnas de su tabla base
  const cols = columnasDe(tabla) || (tabla === 'pacientes_ordenados' ? columnasDe('pacientes') : null);
  if (!cols) continue;

  for (const c of m[2].matchAll(/\.(?:eq|gte|lte|neq)\('(\w+)'/g)) {
    const clave = `${tabla}.${c[1]}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    // Columnas calculadas por la vista, no presentes en la tabla base
    const derivadas = ['ultima_asistencia', 'total_visitas', 'paquete_restantes'];
    ok(cols.has(c[1]) || derivadas.includes(c[1]),
      `${clave}${cols.has(c[1]) || derivadas.includes(c[1]) ? '' : ' ← esa columna no existe'}`);
  }
}

console.log(fallos
  ? `\n${fallos} DESAJUSTE(S). Corrígelos o la app dará 404 en producción.`
  : '\nCliente y esquema coinciden ✔');
process.exit(fallos ? 1 : 0);
