-- Después de autoria-notas.sql. Atribución histórica solicitada por la clínica.
-- No cambia contenido clínico, fechas, revisiones ni crea guardados nuevos.
begin;
do $$
declare
  legado uuid := '08025cd3-2edd-4679-9fb3-05d4afa3a605';
  corte timestamptz;
  tabla text;
begin
  if not exists(select 1 from perfiles where id = legado and regexp_replace(nombre, '^(fisio\.?\s+)+', '', 'i') = 'CLIDANFI' and rol = 'fisio') then
    raise exception 'No se encontró la cuenta histórica CLIDANFI esperada';
  end if;
  select creado_en into corte from perfiles where id = '85e3d0e1-4687-4d00-b99b-0c691c821b38' and rol = 'fisio';
  if corte is null then raise exception 'Falta el perfil de fisio de Dana'; end if;

  foreach tabla in array array['pacientes','citas','asistencias','pagos','valoraciones','notas','archivos','rutinas'] loop
    -- Bloqueo transaccional: nadie escribe mientras se suspenden los triggers.
    execute format('lock table public.%I in access exclusive mode', tabla);
    execute format('alter table public.%I disable trigger user', tabla);
    execute format($q$
      update public.%I t set creado_por = $1, creado_por_nombre = 'Fisio. CLIDANFI'
      where (creado_por is null or creado_por = $1)
        and coalesce((to_jsonb(t)->>'creado_en')::timestamptz,
          (to_jsonb(t)->>'pagado_en')::timestamptz) <= $2
    $q$, tabla) using legado, corte;
    execute format($q$
      update public.%I set editado_por = $1, editado_por_nombre = 'Fisio. CLIDANFI'
      where editado_por = $1 or (editado_por is null and editado_en <= $2)
    $q$, tabla) using legado, corte;
    execute format('alter table public.%I enable trigger user', tabla);
  end loop;

  update documentos_versiones set contenido = contenido ||
    jsonb_build_object('creado_por', legado, 'creado_por_nombre', 'Fisio. CLIDANFI') ||
    case when numero > 1 or contenido->>'editado_en' is not null then
      jsonb_build_object('editado_por', legado, 'editado_por_nombre', 'Fisio. CLIDANFI')
    else '{}'::jsonb end
    where creado_en <= corte and (contenido->>'creado_por' is null or contenido->>'creado_por' = legado::text);

  with anteriores as (
    select id, row_number() over(partition by valoracion_id order by creado_en,id) numero
    from valoraciones_versiones where creado_en <= corte
  )
  update valoraciones_versiones h set contenido = contenido ||
    jsonb_build_object('creado_por', legado, 'creado_por_nombre', 'Fisio. CLIDANFI') ||
    case when a.numero > 1 or contenido->>'editado_en' is not null then
      jsonb_build_object('editado_por', legado, 'editado_por_nombre', 'Fisio. CLIDANFI')
    else '{}'::jsonb end
    from anteriores a where a.id = h.id
    and (contenido->>'creado_por' is null or contenido->>'creado_por' = legado::text);
end $$;
commit;
