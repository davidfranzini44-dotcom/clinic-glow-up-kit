-- 1) New permission flags
alter table public.user_permissions add column if not exists agenda_edit boolean not null default false;
alter table public.user_permissions add column if not exists caja boolean not null default false;
alter table public.user_permissions alter column reports set default true;
update public.user_permissions set reports = true;

-- 2) Permission helper for RLS
create or replace function public.has_perm(_user_id uuid, _perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case _perm
    when 'agenda_edit' then coalesce((select agenda_edit from public.user_permissions where user_id = _user_id), false)
    when 'caja'        then coalesce((select caja        from public.user_permissions where user_id = _user_id), false)
    else false
  end;
$$;

-- 3) Agenda editing for secretaries
drop policy if exists "Agenda editors insert appointments" on public.appointments;
create policy "Agenda editors insert appointments"
  on public.appointments for insert to authenticated
  with check (public.has_perm(auth.uid(), 'agenda_edit'));

drop policy if exists "Agenda editors update appointments" on public.appointments;
create policy "Agenda editors update appointments"
  on public.appointments for update to authenticated
  using (public.has_perm(auth.uid(), 'agenda_edit'))
  with check (public.has_perm(auth.uid(), 'agenda_edit'));

drop policy if exists "Agenda editors delete appointments" on public.appointments;
create policy "Agenda editors delete appointments"
  on public.appointments for delete to authenticated
  using (public.has_perm(auth.uid(), 'agenda_edit'));

-- 4) Caja: expenses + cash closures
drop policy if exists "Caja writes expenses" on public.expenses;
create policy "Caja writes expenses"
  on public.expenses for all to authenticated
  using (public.has_perm(auth.uid(), 'caja'))
  with check (public.has_perm(auth.uid(), 'caja'));

drop policy if exists "Caja writes cash closures" on public.cash_closures;
create policy "Caja writes cash closures"
  on public.cash_closures for all to authenticated
  using (public.has_perm(auth.uid(), 'caja'))
  with check (public.has_perm(auth.uid(), 'caja'));

-- 5) Client arrival
alter table public.appointments add column if not exists arrived_at timestamptz;

create or replace function public.notify_client_arrived()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  emp_user uuid;
begin
  if new.arrived_at is not null and old.arrived_at is null and new.employee is not null then
    select id into emp_user from public.profiles where employee_name = new.employee limit 1;
    if emp_user is not null then
      insert into public.notifications (user_id, kind, title, body, link)
      values (
        emp_user,
        'client_arrived',
        'Tu cliente llegó',
        new.client || coalesce(' · Cabina ' || new.cabin, ''),
        'apt:' || new.id || ':' || new.date
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_client_arrived on public.appointments;
create trigger trg_notify_client_arrived
  after update on public.appointments
  for each row execute function public.notify_client_arrived();