-- Ejecutar después de schema.sql, valoraciones-respaldo.sql y documentos-respaldo.sql.
begin;
create or replace function public.registrar_autoria()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); nombre_actor text;
begin
  select case when rol = 'fisio' then 'Fisio. ' || regexp_replace(trim(nombre), '^(fisio\.?\s+)+', '', 'i')
    else nombre end into nombre_actor from perfiles where id = actor;
  if TG_OP = 'INSERT' then
    if TG_TABLE_NAME = 'notas' then new.revision := 1; end if;
    new.creado_por := actor;
    new.creado_por_nombre := nombre_actor;
    new.editado_por := null; new.editado_por_nombre := null; new.editado_en := null;
  else
    if TG_TABLE_NAME = 'notas' then new.revision := old.revision; end if;
    new.creado_por := old.creado_por;
    new.creado_por_nombre := old.creado_por_nombre;
    new.editado_por := old.editado_por;
    new.editado_por_nombre := old.editado_por_nombre;
    new.editado_en := old.editado_en;
    if (to_jsonb(new) - array['editado_por','editado_por_nombre','editado_en','revision'])
      is distinct from (to_jsonb(old) - array['editado_por','editado_por_nombre','editado_en','revision']) then
      new.editado_por := actor; new.editado_por_nombre := nombre_actor; new.editado_en := clock_timestamp();
      if TG_TABLE_NAME = 'notas' then new.revision := old.revision + 1; end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.registrar_autoria() from public, anon, authenticated;
alter table public.notas add column if not exists revision integer not null default 1;
do $$ declare tabla text; begin
  foreach tabla in array array['pacientes','citas','asistencias','pagos','valoraciones','notas','archivos','rutinas'] loop
    execute format('alter table public.%I add column if not exists creado_por uuid, add column if not exists creado_por_nombre text, add column if not exists editado_por uuid, add column if not exists editado_por_nombre text, add column if not exists editado_en timestamptz', tabla);
    execute format('drop trigger if exists registrar_autoria on public.%I', tabla);
    execute format('create trigger registrar_autoria before insert or update on public.%I for each row execute function public.registrar_autoria()', tabla);
  end loop;
end $$;

create or replace function public.editar_nota_versionada(nota_id uuid, revision_esperada integer, cambios jsonb)
returns public.notas language plpgsql security invoker set search_path = public as $$
declare actual public.notas;
begin
  if not public.es_fisio() then raise exception 'Solo los fisios pueden editar notas'; end if;
  select * into actual from notas where id = nota_id for update;
  if actual.id is null then raise exception 'Nota no encontrada'; end if;
  if actual.revision is distinct from revision_esperada then
    raise exception 'Otro usuario modificó esta nota. Vuelve a abrirla para revisar los cambios.';
  end if;
  if nullif(trim(cambios->>'texto'), '') is null then raise exception 'Escribe la evolución'; end if;
  update notas set texto = trim(cambios->>'texto'), eva = (cambios->>'eva')::int,
    fecha_nota = (cambios->>'fecha_nota')::timestamptz,
    signos_vitales = cambios->'signos_vitales', adjuntos = cambios->'adjuntos'
    where id = nota_id returning * into actual;
  return actual;
end $$;
-- Compatibilidad histórica: el editor de contenido ya no se ofrece al cliente.
revoke all on function public.editar_nota_versionada(uuid,integer,jsonb) from public, anon, authenticated;
commit;
