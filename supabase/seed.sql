-- ============================================================================
-- CLIDANFI · Datos mínimos de arranque
--
-- Crea exactamente:
--    · 1 paciente (vinculado a su cuenta de Auth)
--    · 1 cita agendada
--    · 1 rutina de ejercicios activa
--    · 1 sorteo activo
--    · 1 asistencia + 1 pago  → generan el boleto del sorteo y el primer
--                               ingreso del dashboard (bórralos si quieres
--                               arrancar totalmente en cero)
--
-- ----------------------------------------------------------------------------
-- ANTES DE EJECUTAR
-- ----------------------------------------------------------------------------
-- 1. Ejecuta primero supabase/schema.sql
--
-- 2. Crea las DOS cuentas en:  Authentication → Users → Add user
--    (marca "Auto Confirm User" para no tener que verificar el correo)
--
--       fisio@clidanfi.mx     ← el fisioterapeuta
--       paciente@clidanfi.mx  ← el paciente de prueba
--
-- 3. Copia el UUID de cada usuario y pégalo abajo, en v_fisio_uid y v_pac_uid.
--
-- Este script es idempotente: puedes volver a ejecutarlo.
-- ============================================================================

do $$
declare
  ---------------------------------------------------------------------------
  -- ▼▼▼  PEGA AQUÍ LOS UUID DE Authentication → Users  ▼▼▼
  ---------------------------------------------------------------------------
  v_fisio_uid uuid := '00000000-0000-0000-0000-000000000000';
  v_pac_uid   uuid := '00000000-0000-0000-0000-000000000000';
  ---------------------------------------------------------------------------

  v_paciente_id uuid;
  v_rutina_id   uuid;
  v_sorteo_id   uuid;
  v_asist_id    uuid;
begin
  ---------------------------------------------------------------------------
  -- Validaciones: mejor fallar claro que dejar la base a medias
  ---------------------------------------------------------------------------
  if v_fisio_uid = '00000000-0000-0000-0000-000000000000'
     or v_pac_uid = '00000000-0000-0000-0000-000000000000' then
    raise exception 'Falta pegar los UUID de los usuarios (ver instrucciones arriba).';
  end if;

  if not exists (select 1 from auth.users where id = v_fisio_uid) then
    raise exception 'No existe el usuario % en auth.users', v_fisio_uid;
  end if;
  if not exists (select 1 from auth.users where id = v_pac_uid) then
    raise exception 'No existe el usuario % en auth.users', v_pac_uid;
  end if;

  ---------------------------------------------------------------------------
  -- 1 · PERFILES Y ROLES
  --     El trigger handle_new_user ya creó ambos como 'paciente';
  --     aquí promovemos al fisioterapeuta.
  ---------------------------------------------------------------------------
  insert into perfiles (id, rol, nombre)
  values (v_fisio_uid, 'fisio', 'Fisio. Daniela Figueroa')
  on conflict (id) do update set rol = 'fisio', nombre = excluded.nombre;

  insert into perfiles (id, rol, nombre)
  values (v_pac_uid, 'paciente', 'Paciente de Prueba')
  on conflict (id) do update set rol = 'paciente', nombre = excluded.nombre;

  ---------------------------------------------------------------------------
  -- 2 · EL PACIENTE, ligado a su cuenta
  ---------------------------------------------------------------------------
  insert into pacientes (
    usuario_id, nombre, telefono, email, edad, sexo, diagnostico,
    paquete_nombre, paquete_total, paquete_usadas, paquete_vence
  ) values (
    v_pac_uid, 'Paciente de Prueba', '667 000 0000', 'paciente@clidanfi.mx',
    34, 'F', 'Lumbalgia mecánica',
    'Paquete 10 sesiones', 10, 0, now() + interval '60 days'
  )
  on conflict (usuario_id) do update set nombre = excluded.nombre
  returning id into v_paciente_id;

  ---------------------------------------------------------------------------
  -- 3 · 1 CITA agendada para mañana
  ---------------------------------------------------------------------------
  if not exists (select 1 from citas where paciente_id = v_paciente_id) then
    insert into citas (paciente_id, inicia_en, duracion_min, motivo, estado)
    values (v_paciente_id, date_trunc('day', now()) + interval '1 day 10 hours',
            45, 'Sesión de rehabilitación', 'agendada');
  end if;

  ---------------------------------------------------------------------------
  -- 4 · 1 SORTEO activo  (antes de la asistencia: el trigger lo necesita
  --     para poder emitir el boleto)
  ---------------------------------------------------------------------------
  select id into v_sorteo_id from sorteos where titulo = 'Sorteo del mes' limit 1;

  if v_sorteo_id is null then
    insert into sorteos (titulo, premio, descripcion, inicia_en, termina_en, estado, publicado)
    values (
      'Sorteo del mes',
      'Paquete de 3 sesiones de fisioterapia',
      'Acumula un boleto por cada asistencia registrada. ¡Entre más vengas, más oportunidades!',
      date_trunc('day', now()) - interval '15 days',
      date_trunc('day', now()) + interval '15 days' + interval '23 hours 59 minutes',
      'activo', true
    )
    returning id into v_sorteo_id;
  end if;

  ---------------------------------------------------------------------------
  -- 5 · 1 ASISTENCIA
  --     Al insertarla, el trigger `trg_boletos_asistencia`:
  --       · emite 1 boleto del sorteo activo
  --       · descuenta 1 sesión del paquete (queda en 1/10)
  ---------------------------------------------------------------------------
  if not exists (select 1 from asistencias where paciente_id = v_paciente_id) then
    insert into asistencias (paciente_id, asistio_en)
    values (v_paciente_id, now() - interval '2 days')
    returning id into v_asist_id;

    insert into pagos (paciente_id, monto, metodo, concepto, pagado_en)
    values (v_paciente_id, 450, 'Efectivo', 'Sesión de fisioterapia', now() - interval '2 days');
  end if;

  ---------------------------------------------------------------------------
  -- 6 · 1 RUTINA activa con 4 ejercicios
  ---------------------------------------------------------------------------
  if not exists (select 1 from rutinas where paciente_id = v_paciente_id) then
    insert into rutinas (paciente_id, titulo, notas, activa, creado_en)
    values (v_paciente_id, 'Fase 1 · control lumbar',
            'Realizar 5 días a la semana. Suspender si el dolor supera 5/10.',
            true, now() - interval '2 days')
    returning id into v_rutina_id;

    insert into rutina_items (rutina_id, ejercicio_id, orden, series, reps, hold, frecuencia)
    select v_rutina_id, e.id, x.orden, e.sets, e.reps, e.hold, '5 × semana'
      from (values ('ex_07', 0), ('ex_08', 1), ('ex_10', 2), ('ex_21', 3)) as x(ejercicio, orden)
      join ejercicios e on e.id = x.ejercicio;
  end if;

  raise notice 'Semilla lista · paciente=% · sorteo=%', v_paciente_id, v_sorteo_id;
end $$;

-- ============================================================================
-- COMPROBACIÓN
-- ============================================================================
select 'pacientes'   as tabla, count(*) from pacientes
union all select 'citas',        count(*) from citas
union all select 'rutinas',      count(*) from rutinas
union all select 'rutina_items', count(*) from rutina_items
union all select 'sorteos',      count(*) from sorteos
union all select 'boletos',      count(*) from boletos      -- debe ser 1
union all select 'asistencias',  count(*) from asistencias
union all select 'pagos',        count(*) from pagos;
