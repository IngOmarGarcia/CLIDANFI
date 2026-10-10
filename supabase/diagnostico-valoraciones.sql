-- Solo lectura. Ejecutar en SQL Editor; no compartir datos clínicos.
select date_trunc('month', creado_en) as mes, count(*) as valoraciones
from public.valoraciones group by 1 order by 1;
select count(*) as total, min(creado_en) as primera, max(creado_en) as ultima
from public.valoraciones;
select trigger_name, event_manipulation, action_statement
from information_schema.triggers where event_object_schema = 'public'
  and event_object_table in ('valoraciones', 'pacientes');
select schemaname, tablename, policyname, roles, cmd, qual
from pg_policies where tablename in ('valoraciones', 'pacientes');
-- Si existe pg_cron, revisar también: select jobid, schedule, command, active from cron.job;
