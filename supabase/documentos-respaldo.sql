-- Instalar después de valoraciones-respaldo.sql. Transaccional y repetible.
begin;
create table if not exists public.documentos_versiones (
  id uuid primary key default gen_random_uuid(),
  origen text not null,
  documento_id uuid not null,
  paciente_id uuid not null,
  paciente_nombre text not null,
  numero integer not null,
  creado_en timestamptz not null default now(),
  contenido jsonb not null,
  drive_archivo_id text,
  intentos integer not null default 0,
  reintentar_en timestamptz not null default now(),
  bloqueo uuid,
  ultimo_error text,
  unique(origen, documento_id, numero)
);
alter table public.documentos_versiones enable row level security;
revoke all on public.documentos_versiones from anon, authenticated;
grant select on public.documentos_versiones to authenticated;
grant all on public.documentos_versiones to service_role;
drop policy if exists fisio_lee_documentos on public.documentos_versiones;
create policy fisio_lee_documentos on public.documentos_versiones
  for select to authenticated using(public.es_fisio());

create or replace function public.encolar_documento(tabla text, fila jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare anterior documentos_versiones; paciente uuid; nombre text;
begin
  if tabla = 'citas' then return; end if;
  if tabla not in ('pacientes','notas','rutinas','archivos','pagos') then
    raise exception 'Origen de respaldo no permitido';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(tabla || (fila->>'id'), 0));
  paciente := case when tabla = 'pacientes' then (fila->>'id')::uuid
    else (fila->>'paciente_id')::uuid end;
  select p.nombre into nombre from pacientes p where p.id = paciente;
  if nombre is null then return; end if;
  select * into anterior from documentos_versiones
    where origen = tabla and documento_id = (fila->>'id')::uuid
    order by numero desc limit 1;
  if anterior.contenido = fila then return; end if;
  insert into documentos_versiones(origen,documento_id,paciente_id,paciente_nombre,numero,contenido)
    values(tabla,(fila->>'id')::uuid,paciente,nombre,coalesce(anterior.numero,0)+1,fila);
end $$;
revoke all on function public.encolar_documento(text,jsonb) from public,anon,authenticated;

create or replace function public.conservar_documento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'UPDATE' then perform encolar_documento(TG_TABLE_NAME,to_jsonb(old)); end if;
  perform encolar_documento(TG_TABLE_NAME,to_jsonb(new));
  return new;
end $$;
revoke all on function public.conservar_documento() from public,anon,authenticated;
drop trigger if exists conservar_documento on public.citas;
do $$ declare tabla text; begin
  foreach tabla in array array['pacientes','notas','archivos','pagos'] loop
    execute format('drop trigger if exists conservar_documento on public.%I',tabla);
    execute format('create trigger conservar_documento after insert or update on public.%I for each row execute function public.conservar_documento()',tabla);
    execute format('select public.encolar_documento(%L,to_jsonb(t)) from public.%I t',tabla,tabla);
  end loop;
end $$;

-- Las rutinas se capturan al finalizar la transacción, con TODOS sus ejercicios.
create or replace function public.capturar_rutina(rid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare fila jsonb;
begin
  select to_jsonb(r) || jsonb_build_object('ejercicios',coalesce((
    select jsonb_agg(to_jsonb(i) || jsonb_build_object('ejercicio',to_jsonb(e)) order by i.orden,i.id)
    from rutina_items i join ejercicios e on e.id = i.ejercicio_id where i.rutina_id = r.id
  ),'[]'::jsonb)) into fila from rutinas r where r.id = rid;
  if fila is not null then perform encolar_documento('rutinas',fila); end if;
end $$;
revoke all on function public.capturar_rutina(uuid) from public,anon,authenticated;
create or replace function public.conservar_rutina()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_TABLE_NAME = 'rutinas' then perform capturar_rutina(new.id);
  elsif TG_OP = 'DELETE' then perform capturar_rutina(old.rutina_id);
  else
    perform capturar_rutina(new.rutina_id);
    if TG_OP = 'UPDATE' and old.rutina_id <> new.rutina_id then perform capturar_rutina(old.rutina_id); end if;
  end if;
  return null;
end $$;
revoke all on function public.conservar_rutina() from public,anon,authenticated;
drop trigger if exists conservar_rutina on public.rutinas;
create constraint trigger conservar_rutina after insert or update on public.rutinas
  deferrable initially deferred for each row execute function public.conservar_rutina();
drop trigger if exists conservar_rutina on public.rutina_items;
create constraint trigger conservar_rutina after insert or update or delete on public.rutina_items
  deferrable initially deferred for each row execute function public.conservar_rutina();
select public.capturar_rutina(id) from public.rutinas;

-- Una sola transacción evita respaldar rutinas vacías o parcialmente guardadas.
create or replace function public.guardar_rutina_completa(paciente uuid, titulo text,
  notas text default '', items jsonb default '[]', rutina uuid default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare rid uuid; elemento jsonb; posicion integer := 0;
begin
  if not public.es_fisio() then raise exception 'No autorizado'; end if;
  if rutina is null then
    insert into rutinas(paciente_id,titulo,notas,activa)
      values(paciente,titulo,notas,true) returning id into rid;
  else
    update rutinas r set titulo = guardar_rutina_completa.titulo,
      notas = guardar_rutina_completa.notas, activa = true
      where r.id = rutina and r.paciente_id = paciente returning r.id into rid;
    if rid is null then raise exception 'Rutina no encontrada'; end if;
    delete from rutina_items where rutina_id = rid;
  end if;
  for elemento in select * from jsonb_array_elements(items) loop
    insert into rutina_items(rutina_id,ejercicio_id,orden,series,reps,hold,frecuencia,nota)
      values(rid,elemento->>'ejercicio_id',posicion,(elemento->>'series')::int,
        (elemento->>'reps')::int,(elemento->>'hold')::int,
        elemento->>'frecuencia',elemento->>'nota');
    posicion := posicion + 1;
  end loop;
  return rid;
end $$;
revoke all on function public.guardar_rutina_completa(uuid,text,text,jsonb,uuid) from public,anon;
grant execute on function public.guardar_rutina_completa(uuid,text,text,jsonb,uuid) to authenticated;

create or replace function public.reclamar_respaldos_documento()
returns setof public.documentos_versiones language sql security definer set search_path = public as $$
  with pendientes as (
    select id from documentos_versiones where origen <> 'citas'
      and drive_archivo_id is null and reintentar_en <= now()
    order by creado_en,id limit 10 for update skip locked
  ) update documentos_versiones h set bloqueo = gen_random_uuid(), intentos = intentos + 1,
    reintentar_en = now() + interval '15 minutes'
    from pendientes p where h.id = p.id returning h.*;
$$;
revoke all on function public.reclamar_respaldos_documento() from public,anon,authenticated;
grant execute on function public.reclamar_respaldos_documento() to service_role;
create index if not exists idx_documentos_cola on public.documentos_versiones(reintentar_en)
  where drive_archivo_id is null;
create index if not exists idx_documentos_paciente on public.documentos_versiones(paciente_id,creado_en desc);
commit;
