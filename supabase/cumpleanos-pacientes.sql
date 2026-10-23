-- Migración aditiva; no inventa fechas a partir de la edad ni modifica datos existentes.
alter table public.pacientes add column if not exists fecha_nacimiento date;
notify pgrst, 'reload schema';
