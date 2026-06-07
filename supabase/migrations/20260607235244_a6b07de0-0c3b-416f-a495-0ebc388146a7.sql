alter table public.profiles add column if not exists archived boolean not null default false;

create or replace function public.notify_request_reviewed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kind_label text;
begin
  if old.status = 'pending' and new.status in ('approved', 'rejected') then
    kind_label := case new.kind
      when 'day_off' then 'Día libre'
      when 'vacation' then 'Vacaciones'
      when 'late_entry' then 'Entrada tarde'
      when 'sick' then 'Día de enfermedad'
      else new.kind
    end;
    insert into public.notifications (user_id, kind, title, body, link)
    values (
      new.user_id,
      'request_' || new.status,
      case when new.status = 'approved' then 'Solicitud aprobada ✓' else 'Solicitud rechazada' end,
      'Tu solicitud de ' || kind_label || ' (' || to_char(new.date, 'DD/MM') || ') fue '
        || case when new.status = 'approved' then 'aprobada' else 'rechazada' end,
      'profile'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_request_reviewed on public.employee_requests;
create trigger trg_notify_request_reviewed
  after update on public.employee_requests
  for each row execute function public.notify_request_reviewed();