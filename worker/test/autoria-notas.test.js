import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('autoría desde sesión, historial completo y rechazo de edición desactualizada', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
      create table perfiles(id uuid primary key, nombre text, rol text default 'fisio');
      create type estado_cita as enum ('agendada','completada','no_asistio','cancelada');
      create function es_fisio() returns boolean language sql as $$select current_setting('test.fisio',true) = 'si'$$;
      set test.fisio = 'si';`);
    const schema = await readFile(new URL('../../supabase/schema.sql', import.meta.url), 'utf8');
    for (const tabla of ['pacientes','notas','archivos','ejercicios','rutinas','rutina_items','pagos','citas','asistencias','valoraciones']) {
      await db.exec(schema.match(new RegExp(`create table if not exists ${tabla} \\([\\s\\S]*?\\n\\);`))[0]);
    }
    await db.exec(`alter table notas add fecha_nota timestamptz default now(), add signos_vitales jsonb default '{}';`);
    await db.exec(await readFile(new URL('../../supabase/valoraciones-respaldo.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../../supabase/documentos-respaldo.sql', import.meta.url), 'utf8'));
    const sql = await readFile(new URL('../../supabase/autoria-notas.sql', import.meta.url), 'utf8');
    await db.exec(sql); await db.exec(sql);
    const dana = '00000000-0000-0000-0000-000000000001';
    const otro = '00000000-0000-0000-0000-000000000002';
    await db.query("insert into perfiles(id,nombre) values($1,'Dana'),($2,'Otro fisio')", [dana,otro]);
    await db.query("select set_config('test.actor',$1,false)", [dana]);
    const paciente = (await db.query("insert into pacientes(nombre) values('Ficticio') returning *")).rows[0];
    assert.equal(paciente.creado_por_nombre, 'Fisio. Dana');
    await db.query('update pacientes set telefono=$1 where id=$2', ['123',paciente.id]);
    const nota = (await db.query("insert into notas(paciente_id,texto,creado_por_nombre) values($1,'Original','Falso') returning *", [paciente.id])).rows[0];
    assert.equal(nota.creado_por_nombre, 'Fisio. Dana');
    await db.query("select set_config('test.actor',$1,false)", [otro]);
    const cambios = { texto: 'Corregida', eva: 4, fecha_nota: new Date().toISOString(), signos_vitales: {fc:70}, adjuntos: [] };
    await db.query('select editar_nota_versionada($1,1,$2::jsonb)', [nota.id, JSON.stringify(cambios)]);
    const editada = (await db.query('select * from notas where id=$1', [nota.id])).rows[0];
    assert.equal(editada.revision, 2);
    assert.equal(editada.creado_por_nombre, 'Fisio. Dana');
    assert.equal(editada.editado_por_nombre, 'Fisio. Otro fisio');
    assert.ok(editada.editado_en);
    const versiones = (await db.query("select contenido from documentos_versiones where origen='notas' order by numero")).rows;
    assert.deepEqual(versiones.map(v => v.contenido.texto), ['Original','Corregida']);
    await assert.rejects(db.query('select editar_nota_versionada($1,1,$2::jsonb)', [nota.id, JSON.stringify(cambios)]), /Otro usuario/);
    await db.exec("set test.fisio = 'no'");
    await assert.rejects(db.query('select editar_nota_versionada($1,2,$2::jsonb)', [nota.id, JSON.stringify(cambios)]), /Solo los fisios/);
    // La atribución histórica no genera versiones ni toca a los nuevos autores.
    await db.exec(`alter table perfiles add creado_en timestamptz default now();
      insert into perfiles(id,nombre,creado_en) values
        ('08025cd3-2edd-4679-9fb3-05d4afa3a605','CLIDANFI',now()),
        ('85e3d0e1-4687-4d00-b99b-0c691c821b38','Dana Patricia Campuzano Robles',now() + interval '1 second');
      set test.actor = '';`);
    const historica = (await db.query("insert into notas(paciente_id,texto) values($1,'Histórica') returning *", [paciente.id])).rows[0];
    const cuenta = (await db.query('select count(*)::int n from documentos_versiones')).rows[0].n;
    const atribucion = await readFile(new URL('../../supabase/autoria-historica-clidanfi.sql', import.meta.url), 'utf8');
    await db.exec(atribucion); await db.exec(atribucion);
    const atribuida = (await db.query('select * from notas where id=$1',[historica.id])).rows[0];
    assert.equal(atribuida.creado_por_nombre, 'Fisio. CLIDANFI');
    assert.equal(atribuida.revision, historica.revision);
    assert.deepEqual(atribuida.creado_en, historica.creado_en);
    assert.equal((await db.query('select count(*)::int n from documentos_versiones')).rows[0].n, cuenta);
    assert.equal((await db.query('select creado_por_nombre from notas where id=$1',[nota.id])).rows[0].creado_por_nombre, 'Fisio. Dana');
    assert.equal((await db.query("select contenido->>'creado_por_nombre' nombre from documentos_versiones where documento_id=$1",[historica.id])).rows[0].nombre, 'Fisio. CLIDANFI');
  } finally { await db.close(); }
});
