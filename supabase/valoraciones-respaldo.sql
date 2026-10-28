-- Ejecutar una vez en SQL Editor. No elimina ni reemplaza datos existentes.
begin;

-- Cada guardado conserva una copia completa, independiente del expediente.
create table if not exists public.valoraciones_versiones (
  id uuid primary key default gen_random_uuid(),
  valoracion_id uuid not null,
  paciente_id uuid not null,
  paciente_nombre text not null,
  creado_en timestamptz not null default now(),
  contenido jsonb not null,
  drive_archivo_id text,
  intentos integer not null default 0,
  reintentar_en timestamptz not null default now(),
  bloqueo uuid,
  ultimo_error text
);
alter table public.valoraciones_versiones enable row level security;
revoke all on public.valoraciones_versiones from anon, authenticated;
grant select on public.valoraciones_versiones to authenticated;
grant all on public.valoraciones_versiones to service_role;
drop policy if exists fisio_lee_versiones on public.valoraciones_versiones;
create policy fisio_lee_versiones on public.valoraciones_versiones
  for select to authenticated using (public.es_fisio());

create or replace function public.conservar_valoracion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Antes de la primera edición tras instalar, conserva también la fila previa.
  if TG_OP = 'UPDATE' and not exists (
    select 1 from valoraciones_versiones where valoracion_id = old.id
  ) then
    insert into valoraciones_versiones(valoracion_id, paciente_id, paciente_nombre, contenido)
      select old.id, old.paciente_id, p.nombre, to_jsonb(old)
      from pacientes p where p.id = old.paciente_id;
  end if;
  insert into valoraciones_versiones(valoracion_id, paciente_id, paciente_nombre, contenido)
    select new.id, new.paciente_id, p.nombre, to_jsonb(new)
    from pacientes p where p.id = new.paciente_id;
  return new;
end $$;
revoke all on function public.conservar_valoracion() from public;
drop trigger if exists conservar_valoracion on public.valoraciones;
create trigger conservar_valoracion after insert or update on public.valoraciones
  for each row execute function public.conservar_valoracion();

-- Incluir las valoraciones que todavía existen; repetir el script no duplica.
insert into public.valoraciones_versiones(valoracion_id, paciente_id, paciente_nombre, contenido)
  select v.id, v.paciente_id, p.nombre, to_jsonb(v)
  from public.valoraciones v join public.pacientes p on p.id = v.paciente_id
  where not exists (select 1 from public.valoraciones_versiones h where h.valoracion_id = v.id);

-- Una valoración clínica no se borra desde la app ni por cascada de paciente.
create or replace function public.impedir_borrado_valoracion()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'No se pueden borrar valoraciones clínicas. Desactiva el paciente para conservar su expediente.';
end $$;
drop trigger if exists impedir_borrado_valoracion on public.valoraciones;
create trigger impedir_borrado_valoracion before delete on public.valoraciones
  for each row execute function public.impedir_borrado_valoracion();

-- Reclamo atómico: dos ejecuciones del Worker no procesan la misma versión.
create or replace function public.reclamar_respaldos_valoracion()
returns setof public.valoraciones_versiones
language sql security definer set search_path = public as $$
  with pendientes as (
    select id from valoraciones_versiones
    where drive_archivo_id is null and reintentar_en <= now()
    order by creado_en limit 10 for update skip locked
  )
  update valoraciones_versiones h
    set bloqueo = gen_random_uuid(), intentos = intentos + 1,
        reintentar_en = now() + interval '15 minutes'
    from pendientes p where h.id = p.id returning h.*;
$$;
revoke all on function public.reclamar_respaldos_valoracion() from public, anon, authenticated;
grant execute on function public.reclamar_respaldos_valoracion() to service_role;
create index if not exists idx_valoraciones_versiones_cola
  on public.valoraciones_versiones(reintentar_en) where drive_archivo_id is null;
create index if not exists idx_valoraciones_versiones_paciente
  on public.valoraciones_versiones(paciente_id, creado_en desc);
commit;
