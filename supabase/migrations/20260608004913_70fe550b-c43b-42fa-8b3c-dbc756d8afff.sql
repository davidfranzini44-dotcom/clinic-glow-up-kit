-- notes on appointments
alter table public.appointments add column if not exists notes text;

-- notify employee when their cita (today/tomorrow) is cancelled in the app
create or replace function public.notify_cancelled_inapp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  emp_user uuid;
  d date;
  w text;
begin
  if uid is null then return new; end if;  -- sync handles its own notifications
  if new.cancelled and not old.cancelled and new.employee is not null then
    d := (now() at time zone 'America/Santo_Domingo')::date;
    if new.date = d then w := 'hoy';
    elsif new.date = d + 1 then w := 'mañana';
    else return new; end if;
    select id into emp_user from public.profiles where employee_name = new.employee limit 1;
    if emp_user is not null and emp_user <> uid then
      insert into public.notifications (user_id, kind, title, body, link)
      values (emp_user, 'cita_cancelada', 'Cita cancelada',
              'Tu cita de ' || w || ' a las ' || new.time || ' fue cancelada — ' || new.client,
              'apt:' || new.id || ':' || new.date);
    end if;
  end if;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists trg_notify_cancelled_inapp on public.appointments;
create trigger trg_notify_cancelled_inapp
  after update on public.appointments
  for each row execute function public.notify_cancelled_inapp();