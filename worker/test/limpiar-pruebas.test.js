import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('limpieza limitada a expedientes técnicos, repetible y conserva protección clínica', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key, email text);
      create table perfiles(id uuid primary key references auth.users on delete cascade);
      create type estado_cita as enum ('agendada','completada','no_asistio','cancelada');
      create function es_fisio() returns boolean language sql as 'select true';`);
    const schema = await readFile(new URL('../../supabase/schema.sql', import.meta.url), 'utf8');
    for (const tabla of ['pacientes','citas','asistencias','pagos','valoraciones','notas','archivos','ejercicios','rutinas','rutina_items']) {
      await db.exec(schema.match(new RegExp(`create table if not exists ${tabla} \\([\\s\\S]*?\\n\\);`))[0]);
    }
    await db.exec(await readFile(new URL('../../supabase/valoraciones-respaldo.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../../supabase/documentos-respaldo.sql', import.meta.url), 'utf8'));
    await db.exec(`insert into auth.users values ('67d7b60c-70e7-4976-afbc-baa592a3fe6a','paciente@clidanfi.mx');
      insert into perfiles values ('67d7b60c-70e7-4976-afbc-baa592a3fe6a');
      insert into pacientes(id,nombre,email,usuario_id) values
        ('af352c3f-60be-4d8e-b047-e5bc7863294d','Paciente de Prueba','paciente@clidanfi.mx','67d7b60c-70e7-4976-afbc-baa592a3fe6a');
      insert into pacientes(id,nombre,diagnostico) values
        ('d70b597b-a4e8-4d51-abc5-787b3f23c87e','Prueba Drive','DATOS FICTICIOS - prueba de respaldo Drive');
      insert into pacientes(nombre) values ('Expediente real');
      insert into valoraciones(paciente_id) select id from pacientes;
      insert into notas(paciente_id,texto) select id,'Nota' from pacientes;
      insert into citas(paciente_id,inicia_en) select id,now() from pacientes;
      insert into asistencias(paciente_id) select id from pacientes;
      insert into pagos(paciente_id,monto) select id,100 from pacientes;`);
    const sql = await readFile(new URL('../../supabase/limpiar-datos-prueba.sql', import.meta.url), 'utf8');
    await db.exec(sql); await db.exec(sql);
    for (const tabla of ['pacientes','valoraciones','notas','citas','asistencias','pagos','valoraciones_versiones']) {
      assert.equal((await db.query(`select count(*)::int n from ${tabla}`)).rows[0].n, 1, tabla);
    }
    assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int n from perfiles')).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int n from documentos_versiones')).rows[0].n, 3);
    await assert.rejects(db.exec('delete from valoraciones'), /No se pueden borrar/);
    // Si una identidad ya no coincide, aborta antes de tocar cualquier expediente.
    await db.exec(`insert into pacientes(id,nombre) values ('d70b597b-a4e8-4d51-abc5-787b3f23c87e','Otro expediente real');`);
    await assert.rejects(db.exec(sql), /no coincide/);
    await db.exec('rollback');
    assert.equal((await db.query('select count(*)::int n from pacientes')).rows[0].n, 2);
  } finally { await db.close(); }
});
