alter table public.appointments add column if not exists notes text;

drop trigger if exists trg_notify_cancelled_inapp on public.appointments;
drop function if exists public.notify_cancelled_inapp();

create or replace function public.notify_schedule_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  d   date := (now() at time zone 'America/Santo_Domingo')::date;
  w   text;
  tgt uuid;
begin
  if uid is null then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    if new.employee is not null and not new.cancelled then
      w := case when new.date = d then 'hoy' when new.date = d + 1 then 'mañana' else null end;
      if w is not null then
        select id into tgt from public.profiles where employee_name = new.employee limit 1;
        if tgt is not null and tgt <> uid then
          insert into public.notifications (user_id, kind, title, body, link)
          values (tgt, 'cita_nueva', 'Nueva cita asignada',
                  'Se te asignó una cita ' || w || ' a las ' || new.time || ' — ' || new.client,
                  'apt:' || new.id || ':' || new.date);
        end if;
      end if;
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.employee is not null and not old.cancelled then
      w := case when old.date = d then 'hoy' when old.date = d + 1 then 'mañana' else null end;
      if w is not null then
        select id into tgt from public.profiles where employee_name = old.employee limit 1;
        if tgt is not null and tgt <> uid then
          insert into public.notifications (user_id, kind, title, body, link)
          values (tgt, 'cita_eliminada', 'Cita eliminada',
                  'Tu cita de ' || w || ' a las ' || old.time || ' fue eliminada — ' || old.client,
                  'date:' || old.date);
        end if;
      end if;
    end if;
    return old;
  end if;
  if new.employee is distinct from old.employee then
    if new.employee is not null and not new.cancelled then
      w := case when new.date = d then 'hoy' when new.date = d + 1 then 'mañana' else null end;
      if w is not null then
        select id into tgt from public.profiles where employee_name = new.employee limit 1;
        if tgt is not null and tgt <> uid then
          insert into public.notifications (user_id, kind, title, body, link)
          values (tgt, 'cita_nueva', 'Nueva cita asignada',
                  'Se te asignó una cita ' || w || ' a las ' || new.time || ' — ' || new.client,
                  'apt:' || new.id || ':' || new.date);
        end if;
      end if;
    end if;
    if old.employee is not null and not old.cancelled then
      w := case when old.date = d then 'hoy' when old.date = d + 1 then 'mañana' else null end;
      if w is not null then
        select id into tgt from public.profiles where employee_name = old.employee limit 1;
        if tgt is not null and tgt <> uid then
          insert into public.notifications (user_id, kind, title, body, link)
          values (tgt, 'cita_reasignada', 'Cita reasignada',
                  'Tu cita de ' || w || ' a las ' || old.time || ' (' || old.client || ') pasó a otra persona',
                  'date:' || old.date);
        end if;
      end if;
    end if;
    return new;
  end if;
  if new.cancelled and not old.cancelled and new.employee is not null then
    w := case when new.date = d then 'hoy' when new.date = d + 1 then 'mañana' else null end;
    if w is not null then
      select id into tgt from public.profiles where employee_name = new.employee limit 1;
      if tgt is not null and tgt <> uid then
        insert into public.notifications (user_id, kind, title, body, link)
        values (tgt, 'cita_cancelada', 'Cita cancelada',
                'Tu cita de ' || w || ' a las ' || new.time || ' fue cancelada — ' || new.client,
                'apt:' || new.id || ':' || new.date);
      end if;
    end if;
    return new;
  end if;
  if (new.time_mins is distinct from old.time_mins or new.date is distinct from old.date)
     and new.employee is not null and not new.cancelled then
    w := case when new.date = d then 'hoy' when new.date = d + 1 then 'mañana' else null end;
    if w is not null then
      select id into tgt from public.profiles where employee_name = new.employee limit 1;
      if tgt is not null and tgt <> uid then
        insert into public.notifications (user_id, kind, title, body, link)
        values (tgt, 'cita_cambiada', 'Cita cambiada de hora',
                'Tu cita de ' || new.client || ' cambió: ' || w || ' a las ' || new.time,
                'apt:' || new.id || ':' || new.date);
      end if;
    end if;
  end if;
  return new;
exception when others then
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_notify_schedule_change on public.appointments;
create trigger trg_notify_schedule_change
  after insert or update or delete on public.appointments
  for each row execute function public.notify_schedule_change();