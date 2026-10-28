import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('migración repetible, versiones completas, transacciones y permisos', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create table public.perfiles(id uuid primary key);
      create type estado_cita as enum ('agendada','completada','no_asistio','cancelada');
      create function public.es_fisio() returns boolean language sql as 'select true';`);
    const schema = await readFile(new URL('../../supabase/schema.sql', import.meta.url), 'utf8');
    for (const tabla of ['pacientes','notas','archivos','ejercicios','rutinas','rutina_items','pagos','citas']) {
      const ddl = schema.match(new RegExp(`create table if not exists ${tabla} \\([\\s\\S]*?\\n\\);`));
      assert.ok(ddl, tabla);
      await db.exec(ddl[0]);
    }
    const paciente = (await db.query("insert into pacientes(nombre) values('Prueba ficticia') returning id")).rows[0].id;
    await db.query("insert into notas(paciente_id,texto,eva) values($1,'Inicial',0)", [paciente]);
    await db.exec("insert into ejercicios(id,nombre,categoria) values('prueba','Flexión','Prueba')");
    const sql = await readFile(new URL('../../supabase/documentos-respaldo.sql', import.meta.url), 'utf8');
    await db.exec(sql);
    await db.exec(sql);
    assert.equal((await db.query('select count(*)::int n from documentos_versiones')).rows[0].n, 2);
    await db.query("update notas set texto='Editada' where paciente_id=$1", [paciente]);
    const notas = (await db.query("select numero,contenido from documentos_versiones where origen='notas' order by numero")).rows;
    assert.deepEqual(notas.map(n => n.numero), [1, 2]);
    assert.deepEqual(notas.map(n => n.contenido.texto), ['Inicial', 'Editada']);
    const items = JSON.stringify([{ ejercicio_id: 'prueba', series: 3, reps: 10, hold: 0, frecuencia: 'Diario', nota: 'Ficticia' }]);
    const rutina = (await db.query("select guardar_rutina_completa($1,'Rutina ficticia','Prueba',$2::jsonb) id", [paciente,items])).rows[0].id;
    let versiones = (await db.query("select numero,contenido from documentos_versiones where origen='rutinas' order by numero")).rows;
    assert.equal(versiones.length, 1);
    assert.equal(versiones[0].contenido.ejercicios.length, 1);
    assert.equal(versiones[0].contenido.ejercicios[0].ejercicio.nombre, 'Flexión');
    await db.query("select guardar_rutina_completa($1,'Actualizada','Prueba',$2::jsonb,$3)", [paciente,items,rutina]);
    versiones = (await db.query("select numero,contenido from documentos_versiones where origen='rutinas' order by numero")).rows;
    assert.equal(versiones.length, 2);
    assert.ok(versiones.every(v => v.contenido.ejercicios.length === 1));
    await assert.rejects(() => db.query("select guardar_rutina_completa($1,'No debe guardarse','', $2::jsonb,$3)",
      [paciente,JSON.stringify([{ ejercicio_id: 'inexistente', series: 1, reps: 1, hold: 0 }]),rutina]));
    assert.equal((await db.query('select titulo from rutinas where id=$1',[rutina])).rows[0].titulo, 'Actualizada');
    assert.equal((await db.query("select count(*)::int n from documentos_versiones where origen='rutinas'")).rows[0].n, 2);
    const permisos = (await db.query(`select
      has_function_privilege('authenticated','public.reclamar_respaldos_documento()','execute') reclamar,
      has_function_privilege('authenticated','public.encolar_documento(text,jsonb)','execute') encolar,
      has_function_privilege('service_role','public.reclamar_respaldos_documento()','execute') servicio`)).rows[0];
    assert.deepEqual(permisos, { reclamar: false, encolar: false, servicio: true });
    const cola = (await db.query('select * from reclamar_respaldos_documento()')).rows;
    assert.equal(cola.length, 5);
    assert.ok(cola.every(v => v.intentos === 1 && v.bloqueo));
    assert.equal((await db.query('select * from reclamar_respaldos_documento()')).rows.length, 0);
    // El historial sobrevive al borrado del documento original.
    await db.query('delete from notas where paciente_id=$1',[paciente]);
    assert.equal((await db.query("select count(*)::int n from documentos_versiones where origen='notas'")).rows[0].n, 2);
    const cita = (await db.query("insert into citas(paciente_id,inicia_en) values($1,now()) returning id", [paciente])).rows[0].id;
    assert.equal((await db.query("select count(*)::int n from documentos_versiones where origen='citas'")).rows[0].n, 0);
    for (const driveId of [null, 'copia-anterior']) {
      await db.query(`insert into documentos_versiones(origen,documento_id,paciente_id,paciente_nombre,numero,contenido,drive_archivo_id)
        values('citas',$1,$2,'Prueba', $3, '{}', $4)`, [cita,paciente,driveId ? 2 : 1,driveId]);
    }
    const excluir = await readFile(new URL('../../supabase/excluir-citas-respaldo.sql', import.meta.url), 'utf8');
    await db.exec(excluir);
    await db.exec(excluir);
    assert.equal((await db.query("select count(*)::int n from documentos_versiones where origen='citas'")).rows[0].n, 1);
    assert.equal((await db.query('select * from reclamar_respaldos_documento()')).rows.length, 0);
    assert.equal((await db.query('select count(*)::int n from citas')).rows[0].n, 1);
  } finally { await db.close(); }
});
