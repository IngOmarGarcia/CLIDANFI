-- ============================================================================
-- CLIDANFI · Políticas RLS y privilegios de `solicitudes_cita`
--
-- Pégalo entero en Supabase → SQL Editor → Run.
-- Es idempotente: puedes ejecutarlo las veces que quieras sin romper nada.
--
-- Modelo de acceso:
--   · fisioterapeuta → SELECT, INSERT, UPDATE, DELETE sobre todas las filas
--   · paciente       → SELECT de las SUYAS, e INSERT de las suyas en estado
--                      'nueva'. No puede editar ni borrar ninguna.
--   · anónimo        → sin acceso
-- ============================================================================

begin;

-- ---- 0 · La tabla debe existir ---------------------------------------------
-- (Si ya la tienes, esto no la toca. Si no, la crea igual que schema.sql.)
create table if not exists solicitudes_cita (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null references auth.users(id) on delete cascade,
  nombre        text not null,
  telefono      text default '',
  email         text default '',
  motivo        text default '',
  preferencia   text default '',
  estado        text not null default 'nueva',
  paciente_id   uuid references pacientes(id) on delete set null,
  creado_en     timestamptz not null default now()
);


-- ---- 1 · Helper de rol ------------------------------------------------------
-- SECURITY DEFINER para que pueda leer `perfiles` sin quedar atrapado por la
-- RLS de esa misma tabla. Todas las políticas de abajo dependen de él.
create or replace function es_fisio()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from perfiles where id = auth.uid() and rol = 'fisio');
$$;

revoke all on function es_fisio() from public, anon;
grant execute on function es_fisio() to authenticated;


-- ---- 2 · Privilegios de tabla ----------------------------------------------
-- IMPRESCINDIBLE: las políticas RLS filtran FILAS, pero PostgreSQL comprueba
-- primero el GRANT. Sin esto, PostgREST responde 42501 «permission denied for
-- table solicitudes_cita» y ninguna política llega siquiera a evaluarse.
revoke all on solicitudes_cita from anon;
grant select, insert, update, delete on solicitudes_cita to authenticated;


-- ---- 3 · Activar RLS --------------------------------------------------------
alter table solicitudes_cita enable row level security;
-- Nota: NO se usa `force row level security`. La tabla pertenece a `postgres`,
-- que evade RLS de todos modos, y forzarla sí afectaría a la función
-- SECURITY DEFINER `convertir_solicitud`. No aporta seguridad y sí riesgo.


-- ---- 4 · Limpiar políticas anteriores --------------------------------------
-- Se borran por nombre las de schema.sql y las de este script, para que
-- reejecutarlo no acumule duplicados ni deje reglas viejas más laxas.
drop policy if exists fisio_total              on solicitudes_cita;
drop policy if exists pac_ve_sus_solicitudes   on solicitudes_cita;
drop policy if exists pac_crea_solicitud       on solicitudes_cita;
drop policy if exists sol_select               on solicitudes_cita;
drop policy if exists sol_insert               on solicitudes_cita;
drop policy if exists sol_update               on solicitudes_cita;
drop policy if exists sol_delete               on solicitudes_cita;


-- ---- 5 · SELECT -------------------------------------------------------------
-- El fisio ve todas; cada paciente, solo las suyas.
create policy sol_select on solicitudes_cita
  for select to authenticated
  using (es_fisio() or usuario_id = auth.uid());


-- ---- 6 · INSERT -------------------------------------------------------------
-- El paciente solo puede crearlas a su propio nombre y en estado 'nueva':
-- así no puede colarse una ya marcada como 'agendada'.
create policy sol_insert on solicitudes_cita
  for insert to authenticated
  with check (
    es_fisio()
    or (usuario_id = auth.uid() and estado = 'nueva')
  );


-- ---- 7 · UPDATE -------------------------------------------------------------
-- Exclusivo del fisioterapeuta. El WITH CHECK impide que una fila se edite
-- para dejar de ser suya y escaparse del USING.
create policy sol_update on solicitudes_cita
  for update to authenticated
  using (es_fisio())
  with check (es_fisio());


-- ---- 8 · DELETE -------------------------------------------------------------
create policy sol_delete on solicitudes_cita
  for delete to authenticated
  using (es_fisio());


-- ---- 9 · Índices ------------------------------------------------------------
create index if not exists idx_solicitudes_estado  on solicitudes_cita(estado, creado_en desc);
create index if not exists idx_solicitudes_usuario on solicitudes_cita(usuario_id);

commit;


-- ---- 10 · Refrescar la caché de PostgREST ----------------------------------
-- Sin esto, la API sigue devolviendo PGRST205 («Could not find the table
-- 'public.solicitudes_cita' in the schema cache») aunque la tabla exista ya.
-- Es exactamente el error que disparaba el aviso en la app.
notify pgrst, 'reload schema';


-- ============================================================================
-- COMPROBACIÓN · ejecútalo después y revisa la salida
-- ============================================================================

-- ¿Existe la tabla y tiene RLS activa?
select relname        as tabla,
       relrowsecurity as rls_activa
  from pg_class
 where oid = 'public.solicitudes_cita'::regclass;

-- ¿Están las cuatro políticas?  → deben salir 4 filas: SELECT/INSERT/UPDATE/DELETE
select policyname, cmd, roles::text
  from pg_policies
 where schemaname = 'public' and tablename = 'solicitudes_cita'
 order by cmd;

-- ¿Tiene `authenticated` los cuatro privilegios?  → deben salir 4 filas
select privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name   = 'solicitudes_cita'
   and grantee      = 'authenticated'
 order by privilege_type;
