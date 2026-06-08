create or replace function public.notify_client_arrived()

returns trigger language plpgsql security definer set search_path = public as $$

declare

  actor uuid := auth.uid();

  d date := (now() at time zone 'America/Santo_Domingo')::date;

  w text;

  r record;

begin

  if new.arrived_at is not null and old.arrived_at is null and new.employee is not null then

    w := case when new.date = d then 'hoy' when new.date = d + 1 then 'mañana' else to_char(new.date,'DD/MM') end;

    for r in select id from public.profiles where employee_name = new.employee loop

      if r.id is not null and r.id <> coalesce(actor,'00000000-0000-0000-0000-000000000000'::uuid) then

        insert into public.notifications (user_id, kind, title, body, link)

        values (r.id, 'client_arrived', 'Tu cliente llegó',

                new.client || coalesce(' · Cabina ' || new.cabin, '') || ' · ' || new.time,

                'apt:' || new.id || ':' || new.date);

      end if;

    end loop;

  end if;

  return new;

exception when others then return new;

end; $$;

drop trigger if exists trg_notify_client_arrived on public.appointments;

create trigger trg_notify_client_arrived

  after update on public.appointments

  for each row execute function public.notify_client_arrived();