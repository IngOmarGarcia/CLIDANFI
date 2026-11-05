-- Para instalaciones que ya habilitaron el editor de contenido.
-- Conserva las notas y su historial; no afecta la corrección de fecha_nota.
begin;
do $$ begin
  if to_regprocedure('public.editar_nota_versionada(uuid,integer,jsonb)') is not null then
    revoke all on function public.editar_nota_versionada(uuid,integer,jsonb)
      from public, anon, authenticated;
  end if;
end $$;
commit;
