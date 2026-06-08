create table if not exists public.activity_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  user_name  text not null default '—',
  table_name text not null,
  action     text not null,
  summary    text not null,
  created_at timestamptz not null default now()
);
create index if not exists activity_log_created_idx on public.activity_log (created_at desc);
create index if not exists activity_log_user_idx on public.activity_log (user_id, created_at desc);

grant select on public.activity_log to authenticated;
grant all on public.activity_log to service_role;

alter table public.activity_log enable row level security;

drop policy if exists "Activity log: admin read" on public.activity_log;
create policy "Activity log: admin read"
  on public.activity_log for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));

create or replace function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  uname text;
  j     jsonb := to_jsonb(coalesce(new, old));
  jo    jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  summ  text;
begin
  if uid is null then return coalesce(new, old); end if;

  if tg_table_name = 'appointments' and tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'employee' - 'cabin' - 'updated_at' - 'swap_locked' - 'changed' - 'dnsuite_synced_at')
       = (jo - 'employee' - 'cabin' - 'updated_at' - 'swap_locked' - 'changed' - 'dnsuite_synced_at') then
      return new;
    end if;
  end if;

  select coalesce(display_name, employee_name) into uname from public.profiles where id = uid;

  summ := case tg_table_name
    when 'appointments' then
      case
        when tg_op = 'INSERT' then 'Creó cita: ' || coalesce(j->>'client','') || ' · ' || coalesce(j->>'date','')
        when tg_op = 'DELETE' then 'Eliminó cita: ' || coalesce(j->>'client','') || ' · ' || coalesce(j->>'date','')
        when (j->>'arrived_at') is distinct from (jo->>'arrived_at') and j->>'arrived_at' is not null
          then 'Confirmó llegada: ' || coalesce(j->>'client','') || ' · ' || coalesce(j->>'date','')
        when (j->>'cancelled') is distinct from (jo->>'cancelled') and (j->>'cancelled')::boolean
          then 'Marcó cancelada: ' || coalesce(j->>'client','') || ' · ' || coalesce(j->>'date','')
        when (j->>'no_show') is distinct from (jo->>'no_show') and (j->>'no_show')::boolean
          then 'Marcó no asistió: ' || coalesce(j->>'client','') || ' · ' || coalesce(j->>'date','')
        else 'Editó cita: ' || coalesce(j->>'client','') || ' · ' || coalesce(j->>'date','')
      end
    when 'employee_requests' then
      case when tg_op = 'INSERT'
        then 'Creó solicitud: ' || coalesce(j->>'kind','') || ' · ' || coalesce(j->>'date','')
        else 'Solicitud ' || coalesce(j->>'status','') || ': ' || coalesce(j->>'kind','') || ' · ' || coalesce(j->>'date','')
      end
    when 'employee_time_off' then
      (case when tg_op = 'DELETE' then 'Quitó día libre: ' else 'Marcó libre: ' end)
        || coalesce(j->>'employee_name','') || ' · ' || coalesce(j->>'date','')
    when 'expenses' then
      (case tg_op when 'INSERT' then 'Registró gasto' when 'DELETE' then 'Eliminó gasto' else 'Editó gasto' end)
        || ' RD$' || coalesce(j->>'amount','')
    when 'cash_closures' then 'Cierre de caja · ' || coalesce(j->>'date','')
    when 'user_permissions' then 'Cambió permisos de un usuario'
    when 'employee_settings' then 'Editó empleada: ' || coalesce(j->>'name','')
    when 'waitlist' then 'Lista de espera (' || coalesce(j->>'status','') || '): ' || coalesce(j->>'client_name','')
    else tg_table_name || ' · ' || tg_op
  end;

  insert into public.activity_log (user_id, user_name, table_name, action, summary)
  values (uid, coalesce(uname, '—'), tg_table_name, tg_op, summ);

  return coalesce(new, old);
exception when others then
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['appointments','employee_requests','employee_time_off','expenses','cash_closures','user_permissions','employee_settings','waitlist']
  loop
    execute format('drop trigger if exists trg_log_activity on public.%I', t);
    execute format('create trigger trg_log_activity after insert or update or delete on public.%I for each row execute function public.log_activity()', t);
  end loop;
end $$;