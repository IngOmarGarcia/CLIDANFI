-- ============================================================================
-- CLIDANFI · Esquema de base de datos (Supabase / PostgreSQL)
--
-- Ejecuta este archivo COMPLETO en: Supabase → SQL Editor → New query → Run
-- Es idempotente: puedes volver a ejecutarlo las veces que haga falta.
--
-- Después ejecuta supabase/seed.sql para cargar los datos mínimos.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- 1 · PERFILES Y ROLES
--     Se apoya en auth.users. Cada usuario es 'fisio' o 'paciente'.
--     El rol vive SOLO aquí: el cliente nunca lo decide.
-- ============================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'rol_usuario') then
    create type rol_usuario as enum ('fisio', 'paciente');
  end if;
end $$;

create table if not exists perfiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  rol         rol_usuario not null default 'paciente',
  nombre      text not null default '',
  telefono    text default '',
  avatar_url  text default '',
  creado_en   timestamptz not null default now()
);

-- Helper usado por TODAS las políticas. SECURITY DEFINER para que pueda leer
-- `perfiles` sin quedar atrapado por la RLS de la propia tabla.
create or replace function es_fisio()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from perfiles where id = auth.uid() and rol = 'fisio');
$$;

-- Alta automática de perfil al registrarse. Nace SIEMPRE como 'paciente':
-- promover a 'fisio' es un acto manual y deliberado.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into perfiles (id, nombre, rol)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', ''), 'paciente')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Impide que alguien se auto-promueva editando su propio perfil
create or replace function bloquear_cambio_de_rol()
returns trigger language plpgsql as $$
begin
  if new.rol <> old.rol and not es_fisio() then
    raise exception 'No puedes cambiar tu propio rol';
  end if;
  return new;
end $$;

drop trigger if exists trg_bloquear_rol on perfiles;
create trigger trg_bloquear_rol
  before update on perfiles
  for each row execute function bloquear_cambio_de_rol();

-- ============================================================================
-- 2 · PACIENTES
-- ============================================================================
create table if not exists pacientes (
  id              uuid primary key default gen_random_uuid(),
  usuario_id      uuid unique references auth.users(id) on delete set null,  -- login del paciente
  nombre          text not null,
  telefono        text default '',
  email           text default '',
  edad            int,
  sexo            char(1),
  diagnostico     text default '',
  alergias        text default '',
  avatar_url      text default '',
  paquete_nombre  text default 'Sesión individual',
  paquete_total   int  not null default 1,
  paquete_usadas  int  not null default 0,
  paquete_vence   timestamptz,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now()
);

create index if not exists idx_pacientes_usuario on pacientes(usuario_id);

-- ============================================================================
-- 3 · CITAS
-- ============================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'estado_cita') then
    create type estado_cita as enum ('agendada', 'completada', 'no_asistio', 'cancelada');
  end if;
end $$;

create table if not exists citas (
  id            uuid primary key default gen_random_uuid(),
  paciente_id   uuid not null references pacientes(id) on delete cascade,
  inicia_en     timestamptz not null,
  duracion_min  int not null default 45,
  motivo        text default 'Sesión de rehabilitación',
  estado        estado_cita not null default 'agendada',
  notas         text default '',
  creado_en     timestamptz not null default now()
);

create index if not exists idx_citas_inicia   on citas(inicia_en);
create index if not exists idx_citas_paciente on citas(paciente_id, inicia_en desc);

-- ============================================================================
-- 4 · ASISTENCIAS · el corazón del sistema
-- ============================================================================
create table if not exists asistencias (
  id           uuid primary key default gen_random_uuid(),
  paciente_id  uuid not null references pacientes(id) on delete cascade,
  cita_id      uuid references citas(id) on delete set null,
  asistio_en   timestamptz not null default now(),
  nota         text default '',
  creado_en    timestamptz not null default now()
);

create index if not exists idx_asistencias_paciente on asistencias(paciente_id, asistio_en desc);
create index if not exists idx_asistencias_fecha    on asistencias(asistio_en desc);

-- ============================================================================
-- 5 · PAGOS
-- ============================================================================
create table if not exists pagos (
  id           uuid primary key default gen_random_uuid(),
  paciente_id  uuid not null references pacientes(id) on delete cascade,
  monto        numeric(10,2) not null default 0,
  metodo       text default 'Efectivo',
  concepto     text default 'Sesión de fisioterapia',
  pagado_en    timestamptz not null default now()
);

create index if not exists idx_pagos_fecha on pagos(pagado_en desc);

-- ============================================================================
-- 6 · VALORACIÓN INICIAL DINÁMICA
--     secciones_activas: claves de las secciones encendidas
--     datos:             { seccion: { campo: valor } }
-- ============================================================================
create table if not exists valoraciones (
  id                 uuid primary key default gen_random_uuid(),
  paciente_id        uuid not null references pacientes(id) on delete cascade,
  secciones_activas  text[] not null default '{}',
  datos              jsonb  not null default '{}'::jsonb,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now()
);

create index if not exists idx_valoraciones_paciente on valoraciones(paciente_id, creado_en desc);

-- ============================================================================
-- 7 · NOTAS DE EVOLUCIÓN + ADJUNTOS
--     adjuntos: [{ id, url, ruta, titulo, creado_en }] → Storage
-- ============================================================================
create table if not exists notas (
  id           uuid primary key default gen_random_uuid(),
  paciente_id  uuid not null references pacientes(id) on delete cascade,
  tipo         text not null default 'evolucion',
  texto        text not null,
  eva          int check (eva between 0 and 10),
  adjuntos     jsonb not null default '[]'::jsonb,
  creado_en    timestamptz not null default now()
);

create index if not exists idx_notas_paciente on notas(paciente_id, creado_en desc);

-- ============================================================================
-- 8 · CATÁLOGO DE EJERCICIOS + RUTINAS
-- ============================================================================
create table if not exists ejercicios (
  id           text primary key,
  nombre       text not null,
  categoria    text not null,
  descripcion  text default '',
  cue          text default '',
  image_url    text default '',
  sets         int default 3,
  reps         int default 10,
  hold         int default 0,
  activo       boolean not null default true
);

create table if not exists rutinas (
  id           uuid primary key default gen_random_uuid(),
  paciente_id  uuid not null references pacientes(id) on delete cascade,
  titulo       text not null default 'Rutina',
  notas        text default '',
  activa       boolean not null default true,
  creado_en    timestamptz not null default now()
);

create index if not exists idx_rutinas_paciente on rutinas(paciente_id, creado_en desc);

create table if not exists rutina_items (
  id           uuid primary key default gen_random_uuid(),
  rutina_id    uuid not null references rutinas(id) on delete cascade,
  ejercicio_id text not null references ejercicios(id),
  orden        int  not null default 0,
  series       int  not null default 3,
  reps         int  not null default 10,
  hold         int  not null default 0,
  frecuencia   text not null default 'Diario',
  nota         text default ''
);

create index if not exists idx_rutina_items on rutina_items(rutina_id, orden);

-- Solo una rutina activa por paciente
create or replace function una_rutina_activa()
returns trigger language plpgsql as $$
begin
  update rutinas set activa = false
    where paciente_id = new.paciente_id and id <> new.id and activa;
  return new;
end $$;

drop trigger if exists trg_una_rutina_activa on rutinas;
create trigger trg_una_rutina_activa
  after insert or update of activa on rutinas
  for each row when (new.activa) execute function una_rutina_activa();

-- ============================================================================
-- 9 · PROMOCIONES
-- ============================================================================
create table if not exists promociones (
  id           uuid primary key default gen_random_uuid(),
  titulo       text not null,
  descripcion  text default '',
  etiqueta     text default 'Promoción',
  color        text default 'brand',
  image_url    text default '',
  desde        timestamptz not null default now(),
  hasta        timestamptz not null,
  activa       boolean not null default true,
  creado_en    timestamptz not null default now()
);

-- ============================================================================
-- 10 · SORTEOS Y BOLETOS
-- ============================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'estado_sorteo') then
    create type estado_sorteo as enum ('activo', 'sorteado', 'cerrado');
  end if;
end $$;

create table if not exists sorteos (
  id                   uuid primary key default gen_random_uuid(),
  titulo               text not null,
  premio               text not null,
  descripcion          text default '',
  inicia_en            timestamptz not null,
  termina_en           timestamptz not null,
  estado               estado_sorteo not null default 'activo',
  publicado            boolean not null default true,
  ganador_paciente_id  uuid references pacientes(id) on delete set null,
  ganador_boleto       text,
  sorteado_en          timestamptz,
  creado_en            timestamptz not null default now(),
  constraint rango_valido check (termina_en >= inicia_en)
);

create table if not exists boletos (
  id             uuid primary key default gen_random_uuid(),
  sorteo_id      uuid not null references sorteos(id) on delete cascade,
  paciente_id    uuid not null references pacientes(id) on delete cascade,
  asistencia_id  uuid references asistencias(id) on delete cascade,
  codigo         text not null,
  creado_en      timestamptz not null default now(),
  -- 1 boleto por asistencia y sorteo: la idempotencia la garantiza la BD
  unique (sorteo_id, asistencia_id)
);

create index if not exists idx_boletos_sorteo   on boletos(sorteo_id);
create index if not exists idx_boletos_paciente on boletos(paciente_id, sorteo_id);

create or replace function generar_codigo_boleto()
returns text language plpgsql as $$
declare letras text := 'ABCDEFGHJKLMNPQRSTUVWXYZ'; res text := '';
begin
  for i in 1..3 loop
    res := res || substr(letras, floor(random() * length(letras) + 1)::int, 1);
  end loop;
  return res || '-' || lpad(floor(random() * 9000 + 1000)::text, 4, '0');
end $$;

-- ----------------------------------------------------------------------------
-- TRIGGER CLAVE: 1 boleto automático por asistencia en cada sorteo vigente,
-- y descuento de la sesión del paquete.
-- ----------------------------------------------------------------------------
create or replace function emitir_boletos_por_asistencia()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into boletos (sorteo_id, paciente_id, asistencia_id, codigo, creado_en)
  select s.id, new.paciente_id, new.id, generar_codigo_boleto(), new.asistio_en
    from sorteos s
   where s.estado = 'activo'
     and new.asistio_en between s.inicia_en and s.termina_en
  on conflict (sorteo_id, asistencia_id) do nothing;

  update pacientes
     set paquete_usadas = least(paquete_total, paquete_usadas + 1)
   where id = new.paciente_id and paquete_total > 0;

  return new;
end $$;

drop trigger if exists trg_boletos_asistencia on asistencias;
create trigger trg_boletos_asistencia
  after insert on asistencias
  for each row execute function emitir_boletos_por_asistencia();

-- ----------------------------------------------------------------------------
-- Recalcula los boletos si cambian las fechas de un sorteo
-- ----------------------------------------------------------------------------
create or replace function sincronizar_boletos(p_sorteo uuid)
returns table (creados int, eliminados int)
language plpgsql security definer set search_path = public as $$
declare v_creados int; v_eliminados int; s sorteos%rowtype;
begin
  if not es_fisio() then raise exception 'Solo el fisioterapeuta puede sincronizar boletos'; end if;

  select * into s from sorteos where id = p_sorteo;
  if not found then raise exception 'Sorteo no encontrado'; end if;

  with ins as (
    insert into boletos (sorteo_id, paciente_id, asistencia_id, codigo, creado_en)
    select s.id, a.paciente_id, a.id, generar_codigo_boleto(), a.asistio_en
      from asistencias a
     where a.asistio_en between s.inicia_en and s.termina_en
    on conflict (sorteo_id, asistencia_id) do nothing
    returning 1
  ) select count(*)::int into v_creados from ins;

  with del as (
    delete from boletos b
     using asistencias a
     where b.sorteo_id = s.id
       and b.asistencia_id = a.id
       and a.asistio_en not between s.inicia_en and s.termina_en
    returning 1
  ) select count(*)::int into v_eliminados from del;

  return query select v_creados, v_eliminados;
end $$;

-- ----------------------------------------------------------------------------
-- Sorteo: elige un boleto al azar. Probabilidad proporcional a las asistencias.
-- ----------------------------------------------------------------------------
create or replace function realizar_sorteo(p_sorteo uuid)
returns table (paciente_id uuid, nombre text, codigo text, total_boletos bigint)
language plpgsql security definer set search_path = public as $$
declare b boletos%rowtype; v_total bigint;
begin
  if not es_fisio() then raise exception 'Solo el fisioterapeuta puede sortear'; end if;

  select count(*) into v_total from boletos where sorteo_id = p_sorteo;
  if v_total = 0 then raise exception 'No hay boletos emitidos para este sorteo'; end if;

  select * into b from boletos where sorteo_id = p_sorteo order by random() limit 1;

  update sorteos
     set ganador_paciente_id = b.paciente_id,
         ganador_boleto      = b.codigo,
         sorteado_en         = now(),
         estado              = 'sorteado',
         publicado           = false          -- el fisio decide cuándo publicar
   where id = p_sorteo;

  return query
    select b.paciente_id, p.nombre, b.codigo, v_total
      from pacientes p where p.id = b.paciente_id;
end $$;

-- ============================================================================
-- 11 · VISTA: pacientes ordenados por última asistencia
--      security_invoker = las políticas RLS de `pacientes` siguen aplicando
--      a quien consulte la vista. Sin esto, la vista filtraría de más.
-- ============================================================================
drop view if exists pacientes_ordenados;
create view pacientes_ordenados with (security_invoker = true) as
select
  p.*,
  ua.ultima_asistencia,
  coalesce(ua.total_visitas, 0)                   as total_visitas,
  greatest(p.paquete_total - p.paquete_usadas, 0) as paquete_restantes
from pacientes p
left join lateral (
  select max(a.asistio_en) as ultima_asistencia, count(*) as total_visitas
    from asistencias a where a.paciente_id = p.id
) ua on true
order by ua.ultima_asistencia desc nulls last, p.nombre;

-- ============================================================================
-- 12 · INGRESOS POR DÍA (gráfica del dashboard)
-- ============================================================================
create or replace function ingresos_por_dia(p_desde date, p_hasta date)
returns table (dia date, total numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_fisio() then raise exception 'Solo el fisioterapeuta puede consultar ingresos'; end if;

  return query
    select d::date as dia, coalesce(sum(pg.monto), 0) as total
      from generate_series(p_desde, p_hasta, interval '1 day') d
      left join pagos pg on pg.pagado_en::date = d::date
     group by d
     order by d;
end $$;

-- ============================================================================
-- 13 · ROW LEVEL SECURITY
--      · El fisioterapeuta: acceso total.
--      · El paciente: SOLO lo suyo, y solo lectura.
-- ============================================================================
alter table perfiles     enable row level security;
alter table pacientes    enable row level security;
alter table citas        enable row level security;
alter table asistencias  enable row level security;
alter table pagos        enable row level security;
alter table valoraciones enable row level security;
alter table notas        enable row level security;
alter table ejercicios   enable row level security;
alter table rutinas      enable row level security;
alter table rutina_items enable row level security;
alter table promociones  enable row level security;
alter table sorteos      enable row level security;
alter table boletos      enable row level security;

-- ---- Perfiles --------------------------------------------------------------
drop policy if exists perfil_propio on perfiles;
create policy perfil_propio on perfiles for select using (id = auth.uid() or es_fisio());

drop policy if exists perfil_editar on perfiles;
create policy perfil_editar on perfiles for update using (id = auth.uid()) with check (id = auth.uid());

-- ---- El fisio manda en todo -------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['pacientes','citas','asistencias','pagos','valoraciones',
                           'notas','ejercicios','rutinas','rutina_items','promociones',
                           'sorteos','boletos']
  loop
    execute format('drop policy if exists fisio_total on %I;', t);
    execute format(
      'create policy fisio_total on %I for all to authenticated using (es_fisio()) with check (es_fisio());', t);
  end loop;
end $$;

-- ---- Lecturas del paciente: SIEMPRE ancladas a pacientes.usuario_id --------
-- Helper: ¿este paciente_id pertenece al usuario autenticado?
create or replace function es_mi_expediente(p_paciente uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from pacientes where id = p_paciente and usuario_id = auth.uid());
$$;

drop policy if exists pac_ve_su_ficha on pacientes;
create policy pac_ve_su_ficha on pacientes for select to authenticated
  using (usuario_id = auth.uid());

drop policy if exists pac_ve_sus_citas on citas;
create policy pac_ve_sus_citas on citas for select to authenticated
  using (es_mi_expediente(paciente_id));

drop policy if exists pac_ve_sus_asistencias on asistencias;
create policy pac_ve_sus_asistencias on asistencias for select to authenticated
  using (es_mi_expediente(paciente_id));

drop policy if exists pac_ve_sus_rutinas on rutinas;
create policy pac_ve_sus_rutinas on rutinas for select to authenticated
  using (es_mi_expediente(paciente_id));

drop policy if exists pac_ve_sus_items on rutina_items;
create policy pac_ve_sus_items on rutina_items for select to authenticated
  using (exists (select 1 from rutinas r
                  where r.id = rutina_items.rutina_id and es_mi_expediente(r.paciente_id)));

drop policy if exists pac_ve_sus_boletos on boletos;
create policy pac_ve_sus_boletos on boletos for select to authenticated
  using (es_mi_expediente(paciente_id));

-- Expediente clínico y económico del propio paciente
drop policy if exists pac_ve_sus_valoraciones on valoraciones;
create policy pac_ve_sus_valoraciones on valoraciones for select to authenticated
  using (es_mi_expediente(paciente_id));

drop policy if exists pac_ve_sus_notas on notas;
create policy pac_ve_sus_notas on notas for select to authenticated
  using (es_mi_expediente(paciente_id));

drop policy if exists pac_ve_sus_pagos on pagos;
create policy pac_ve_sus_pagos on pagos for select to authenticated
  using (es_mi_expediente(paciente_id));

-- ---- Contenido común -------------------------------------------------------
drop policy if exists todos_ven_ejercicios on ejercicios;
create policy todos_ven_ejercicios on ejercicios for select to authenticated using (activo);

drop policy if exists todos_ven_promos on promociones;
create policy todos_ven_promos on promociones for select to authenticated using (activa);

-- Del sorteo publicado el paciente ve las bases y el ganador, nada más.
drop policy if exists todos_ven_sorteos on sorteos;
create policy todos_ven_sorteos on sorteos for select to authenticated using (publicado);

-- NOTA IMPORTANTE
-- El rol 'paciente' solo tiene permisos de LECTURA en todo el expediente
-- clínico. Su única escritura permitida es crear solicitudes de cita
-- (tabla `solicitudes_cita`, sección 16). Cualquier otra escritura desde su
-- sesión es rechazada por el servidor aunque se manipule el JavaScript.

-- ============================================================================
-- 14 · STORAGE (fotos de pruebas y de ejercicios)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('evidencias', 'evidencias', false),
       ('ejercicios', 'ejercicios', true)
on conflict (id) do nothing;

drop policy if exists "fisio sube evidencias" on storage.objects;
create policy "fisio sube evidencias" on storage.objects for insert
  to authenticated with check (bucket_id = 'evidencias' and es_fisio());

drop policy if exists "fisio lee evidencias" on storage.objects;
create policy "fisio lee evidencias" on storage.objects for select
  to authenticated using (bucket_id = 'evidencias' and es_fisio());

drop policy if exists "fisio borra evidencias" on storage.objects;
create policy "fisio borra evidencias" on storage.objects for delete
  to authenticated using (bucket_id = 'evidencias' and es_fisio());

drop policy if exists "todos leen ejercicios" on storage.objects;
create policy "todos leen ejercicios" on storage.objects for select
  using (bucket_id = 'ejercicios');

-- ============================================================================
-- 15 · CATÁLOGO DE EJERCICIOS
--      Debe existir antes de crear rutinas (rutina_items lo referencia).
-- ============================================================================
insert into ejercicios (id, nombre, categoria, descripcion, cue, sets, reps, hold) values
  ('ex_01','Retracción cervical (chin tuck)','Cervical','Lleva el mentón hacia atrás formando "doble papada" sin inclinar la cabeza.','Mirada al frente. No fuerces.',3,10,5),
  ('ex_02','Rotación cervical activa','Cervical','Gira la cabeza lentamente a un lado hasta sentir tensión suave, regresa al centro.','Hombros relajados, sin subirlos.',2,12,3),
  ('ex_03','Estiramiento de trapecio superior','Cervical','Inclina la oreja hacia el hombro ayudándote con la mano contraria.','Hombro contrario abajo.',2,3,30),
  ('ex_04','Rotación externa con banda','Hombro','Codo pegado al costado a 90°, gira el antebrazo hacia afuera contra la banda.','Rollito de toalla bajo el codo.',3,12,2),
  ('ex_05','Péndulo de Codman','Hombro','Inclinado hacia adelante, deja colgar el brazo y dibuja círculos suaves.','El movimiento nace del tronco.',2,15,0),
  ('ex_06','Elevación escapular en pared','Hombro','Desliza los antebrazos por la pared elevando los brazos sin despegar la espalda.','No arquees la lumbar.',3,10,2),
  ('ex_07','Puente de glúteo','Lumbar','Boca arriba con rodillas dobladas, eleva la cadera apretando glúteos.','Ombligo hacia adentro. No hiperextiendas.',3,15,3),
  ('ex_08','Gato – camello','Lumbar','En cuatro puntos, alterna arqueo y redondeo de la columna.','Movimiento lento y respirado.',2,12,2),
  ('ex_09','Estiramiento en flexión (rodillas al pecho)','Lumbar','Boca arriba, abraza ambas rodillas acercándolas al pecho.','Zona lumbar pegada al piso.',2,3,30),
  ('ex_10','Bird-dog','Core','En cuatro puntos, extiende brazo y pierna contrarios manteniendo el tronco quieto.','Imagina un vaso de agua en la espalda.',3,10,5),
  ('ex_11','Plancha frontal','Core','Apoyo en antebrazos y puntas de pies, cuerpo en línea recta.','Glúteos apretados, cadera neutra.',3,1,30),
  ('ex_12','Plancha lateral con rodillas','Core','De lado, apoya antebrazo y rodillas y eleva la cadera.','Hombro alineado sobre el codo.',3,1,20),
  ('ex_13','Abducción de cadera en decúbito lateral','Cadera','Acostado de lado, eleva la pierna superior recta.','Sin rotar la pelvis hacia atrás.',3,15,2),
  ('ex_14','Concha (clamshell) con banda','Cadera','De lado con rodillas flexionadas, separa las rodillas contra la banda.','Pies juntos todo el tiempo.',3,12,2),
  ('ex_15','Sentadilla en pared','Rodilla','Espalda apoyada en la pared, desliza hasta 60° de flexión y sostén.','Rodillas alineadas con los pies.',3,8,15),
  ('ex_16','Extensión de rodilla en silla','Rodilla','Sentado, estira la rodilla hasta la horizontal y baja controlado.','Aprieta el cuádriceps arriba.',3,15,3),
  ('ex_17','Step-up en escalón','Rodilla','Sube y baja de un escalón controlando la rodilla de apoyo.','Sin dejar caer la rodilla hacia adentro.',3,12,0),
  ('ex_18','Elevación de talones','Tobillo','De pie, sube sobre las puntas de los pies y baja lento.','Bajada en 3 segundos.',3,15,2),
  ('ex_19','Dorsiflexión con banda','Tobillo','Sentado, jala la punta del pie hacia ti contra la resistencia.','Solo mueve el tobillo.',3,15,2),
  ('ex_20','Equilibrio unipodal','Tobillo','Mantén el equilibrio sobre un pie con apoyo cercano por seguridad.','Progresa cerrando los ojos.',3,3,30),
  ('ex_21','Estiramiento de isquiotibiales','Movilidad','Pierna estirada sobre una superficie baja, inclina el tronco desde la cadera.','Espalda recta, no redondees.',2,3,30),
  ('ex_22','Rotación torácica en cuadrupedia','Movilidad','Mano en la nuca, abre el codo hacia el techo rotando el tórax.','La cadera no se mueve.',2,10,3)
on conflict (id) do update set
  nombre = excluded.nombre, categoria = excluded.categoria,
  descripcion = excluded.descripcion, cue = excluded.cue;

-- ============================================================================
-- 16 · AUTORREGISTRO PÚBLICO
--
--     Cualquier persona puede crear su cuenta desde la pantalla de acceso.
--     Nace siempre como 'paciente' (trigger handle_new_user, sección 1).
--
--     Si el correo ya existía en `pacientes` porque el fisioterapeuta la dio
--     de alta antes, su cuenta nueva se VINCULA al expediente existente en
--     lugar de crear un duplicado.
-- ============================================================================

-- Búsqueda por correo sin distinguir mayúsculas
create index if not exists idx_pacientes_email_lower on pacientes (lower(email));

/* ----------------------------------------------------------------------------
   ⚠ SEGURIDAD — LEER ANTES DE DESPLEGAR

   Vincular por correo significa que quien controle una dirección accede al
   expediente asociado a ella. Por eso este trigger SOLO actúa cuando el correo
   está confirmado (`email_confirmed_at is not null`).

   En Supabase → Authentication → Providers → Email, la opción
   «Confirm email» DEBE quedar ACTIVADA. Si la desactivas, cualquiera podría
   reclamar la historia clínica de otra persona con solo escribir su correo.
   ---------------------------------------------------------------------------- */
create or replace function vincular_expediente_por_correo()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_paciente uuid;
begin
  if new.email_confirmed_at is null or new.email is null then
    return new;
  end if;

  -- Un solo expediente: el más antiguo sin cuenta con ese correo.
  -- (pacientes.usuario_id es UNIQUE, así que nunca se vinculan dos.)
  select id into v_paciente
    from pacientes
   where usuario_id is null
     and lower(email) = lower(new.email)
   order by creado_en
   limit 1;

  if v_paciente is not null then
    update pacientes set usuario_id = new.id where id = v_paciente;
    raise notice 'Expediente % vinculado a la cuenta %', v_paciente, new.id;
  end if;

  return new;
end $$;

drop trigger if exists trg_vincular_expediente on auth.users;
create trigger trg_vincular_expediente
  after insert or update of email_confirmed_at on auth.users
  for each row execute function vincular_expediente_por_correo();

-- ============================================================================
-- 17 · SOLICITUDES DE CITA
--     Lo que envía quien se registra por su cuenta y todavía no tiene
--     expediente. Es la ÚNICA tabla donde un paciente puede escribir.
-- ============================================================================
create table if not exists solicitudes_cita (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null references auth.users(id) on delete cascade,
  nombre        text not null,
  telefono      text default '',
  email         text default '',
  motivo        text default '',
  preferencia   text default '',
  estado        text not null default 'nueva'
                check (estado in ('nueva', 'contactada', 'agendada', 'descartada')),
  nota_interna  text default '',
  paciente_id   uuid references pacientes(id) on delete set null,
  creado_en     timestamptz not null default now()
);

create index if not exists idx_solicitudes_estado on solicitudes_cita(estado, creado_en desc);
create index if not exists idx_solicitudes_usuario on solicitudes_cita(usuario_id);

alter table solicitudes_cita enable row level security;

drop policy if exists fisio_total on solicitudes_cita;
create policy fisio_total on solicitudes_cita for all to authenticated
  using (es_fisio()) with check (es_fisio());

drop policy if exists pac_ve_sus_solicitudes on solicitudes_cita;
create policy pac_ve_sus_solicitudes on solicitudes_cita for select to authenticated
  using (usuario_id = auth.uid());

-- Única escritura permitida al paciente, y solo a su propio nombre.
drop policy if exists pac_crea_solicitud on solicitudes_cita;
create policy pac_crea_solicitud on solicitudes_cita for insert to authenticated
  with check (usuario_id = auth.uid() and estado = 'nueva');

/* ----------------------------------------------------------------------------
   Convierte una solicitud en expediente. Solo el fisioterapeuta.
   Si el correo ya tenía expediente sin cuenta, lo reutiliza en vez de duplicar.
   ---------------------------------------------------------------------------- */
create or replace function convertir_solicitud(p_solicitud uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare s solicitudes_cita%rowtype; v_paciente uuid;
begin
  if not es_fisio() then raise exception 'Solo el fisioterapeuta puede convertir solicitudes'; end if;

  select * into s from solicitudes_cita where id = p_solicitud;
  if not found then raise exception 'Solicitud no encontrada'; end if;

  -- ¿ya tiene expediente esa cuenta?
  select id into v_paciente from pacientes where usuario_id = s.usuario_id limit 1;

  -- ¿o hay uno con su correo, todavía sin cuenta?
  if v_paciente is null and coalesce(s.email, '') <> '' then
    select id into v_paciente
      from pacientes
     where usuario_id is null and lower(email) = lower(s.email)
     order by creado_en limit 1;

    if v_paciente is not null then
      update pacientes set usuario_id = s.usuario_id where id = v_paciente;
    end if;
  end if;

  -- si no existía, se crea
  if v_paciente is null then
    insert into pacientes (usuario_id, nombre, telefono, email, diagnostico)
    values (s.usuario_id, s.nombre, s.telefono, s.email, s.motivo)
    returning id into v_paciente;
  end if;

  update solicitudes_cita
     set estado = 'agendada', paciente_id = v_paciente
   where id = p_solicitud;

  return v_paciente;
end $$;

-- ============================================================================
-- 18 · CONFIGURACIÓN DE LA CLÍNICA (marca blanca)
--
--     Fila ÚNICA (`check (id = 1)`): esta instancia atiende a una sola
--     clínica. Aquí vive lo que cambia al vender la aplicación a otra:
--     el logo, el nombre y el lema.
--
--     `perfiles.nombre` sigue siendo la fuente del nombre del fisioterapeuta;
--     no se duplica aquí.
-- ============================================================================
create table if not exists configuracion (
  id             int primary key default 1 check (id = 1),
  clinica        text not null default 'CLIDANFI',
  lema           text not null default 'Fisioterapia y rehabilitación',
  logo_url       text default '',
  logo_ruta      text default '',
  precio_sesion  numeric(10,2) not null default 450,
  actualizado_en timestamptz not null default now()
);

-- La fila nace con los valores por defecto: la app nunca tiene que crearla.
insert into configuracion (id) values (1) on conflict (id) do nothing;

alter table configuracion enable row level security;

/* La pantalla de acceso muestra el logo ANTES de iniciar sesión, así que la
   lectura debe alcanzar también al rol `anon`. Lo que se expone es lo mismo
   que antes estaba escrito a mano en index.html: marca pública, no datos
   clínicos. La escritura sigue siendo exclusiva del fisioterapeuta. */
drop policy if exists config_lectura_publica on configuracion;
create policy config_lectura_publica on configuracion for select
  to anon, authenticated using (true);

drop policy if exists config_edita_fisio on configuracion;
create policy config_edita_fisio on configuracion for all to authenticated
  using (es_fisio()) with check (es_fisio());

/* ----------------------------------------------------------------------------
   PRIVILEGIOS POR COLUMNA

   La RLS es por FILA: no sabe distinguir columnas, y aquí conviven la marca
   (pública por necesidad) con `precio_sesion` y `logo_ruta`, que no tienen por
   qué salir a un visitante sin cuenta. Eso lo resuelven los privilegios de
   columna de PostgreSQL, no una política.

   `id` entra en la lista porque el cliente filtra por él (.eq('id', 1)) y
   filtrar exige privilegio de lectura sobre esa columna.

   ⚠ Al restringir `anon` a estas columnas, un `select *` desde la pantalla de
   acceso daría «permission denied». Por eso js/api.js pide siempre la lista
   explícita de columnas. Si tocas una, toca la otra.
   ---------------------------------------------------------------------------- */
revoke all on configuracion from anon;
grant select (id, clinica, lema, logo_url) on configuracion to anon;

-- Quien ha iniciado sesión sí ve la tabla entera; la RLS de arriba decide
-- quién puede además escribirla.
grant select, insert, update on configuracion to authenticated;

-- ---- Bucket del logo -------------------------------------------------------
-- Público por el mismo motivo que la tabla: el login lo pide sin sesión.
insert into storage.buckets (id, name, public)
values ('marca', 'marca', true)
on conflict (id) do nothing;

drop policy if exists "todos leen marca" on storage.objects;
create policy "todos leen marca" on storage.objects for select
  using (bucket_id = 'marca');

drop policy if exists "fisio sube marca" on storage.objects;
create policy "fisio sube marca" on storage.objects for insert
  to authenticated with check (bucket_id = 'marca' and es_fisio());

drop policy if exists "fisio borra marca" on storage.objects;
create policy "fisio borra marca" on storage.objects for delete
  to authenticated using (bucket_id = 'marca' and es_fisio());

-- ============================================================================
-- LISTO. Siguiente paso: supabase/seed.sql
-- ============================================================================
