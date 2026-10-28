-- Ejecutar antes de publicar el formulario actualizado. No modifica creado_en.
begin;
alter table public.notas add column if not exists fecha_nota timestamptz;
alter table public.notas add column if not exists signos_vitales jsonb not null default '{}'::jsonb;
update public.notas set fecha_nota = creado_en where fecha_nota is null;
alter table public.notas alter column fecha_nota set default now();
alter table public.notas alter column fecha_nota set not null;
commit;
