-- Limpieza explícita autorizada de los dos expedientes técnicos conocidos.
-- Ejecutar como postgres en SQL Editor; transaccional y repetible.
begin;
do $$
declare
  paciente_demo uuid := 'af352c3f-60be-4d8e-b047-e5bc7863294d';
  paciente_drive uuid := 'd70b597b-a4e8-4d51-abc5-787b3f23c87e';
  cuenta_demo uuid := '67d7b60c-70e7-4976-afbc-baa592a3fe6a';
begin
  if exists(select 1 from pacientes where id = paciente_demo
    and (nombre <> 'Paciente de Prueba' or email <> 'paciente@clidanfi.mx'
      or usuario_id is distinct from cuenta_demo)) then
    raise exception 'El expediente demo no coincide con la identidad verificada';
  end if;
  if exists(select 1 from pacientes where id = paciente_drive
    and (nombre <> 'Prueba Drive' or diagnostico <> 'DATOS FICTICIOS - prueba de respaldo Drive')) then
    raise exception 'El expediente Drive no coincide con la marca técnica';
  end if;
  if exists(select 1 from auth.users where id = cuenta_demo and email <> 'paciente@clidanfi.mx') then
    raise exception 'La cuenta no coincide con el usuario de prueba';
  end if;
  if exists(select 1 from pacientes where usuario_id = cuenta_demo and id <> paciente_demo) then
    raise exception 'La cuenta de prueba tiene otro expediente; revisar antes de borrar';
  end if;
  lock table valoraciones in access exclusive mode;
  alter table valoraciones disable trigger impedir_borrado_valoracion;
  delete from pacientes where id in (paciente_demo, paciente_drive);
  alter table valoraciones enable trigger impedir_borrado_valoracion;
  delete from documentos_versiones where paciente_id in (paciente_demo, paciente_drive);
  delete from valoraciones_versiones where paciente_id in (paciente_demo, paciente_drive);
  delete from auth.users where id = cuenta_demo;
end $$;
commit;
