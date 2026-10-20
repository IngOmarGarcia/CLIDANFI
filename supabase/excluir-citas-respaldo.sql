-- Desactiva únicamente el respaldo de citas. No borra ni modifica la agenda.
begin;
drop trigger if exists conservar_documento on public.citas;
delete from public.documentos_versiones where origen = 'citas' and drive_archivo_id is null;
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
commit;
