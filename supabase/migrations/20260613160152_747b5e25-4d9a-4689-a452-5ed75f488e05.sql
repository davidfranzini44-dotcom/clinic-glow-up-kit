create table if not exists public.chore_overrides (
  chore_key   text primary key,
  date        text not null,
  to_employee text not null,
  updated_at  timestamptz not null default now()
);
create index if not exists chore_overrides_date_idx on public.chore_overrides (date);
grant select, insert, update, delete on public.chore_overrides to authenticated;
grant all on public.chore_overrides to service_role;
alter table public.chore_overrides enable row level security;
drop policy if exists "chore_ov read"   on public.chore_overrides;
drop policy if exists "chore_ov insert" on public.chore_overrides;
drop policy if exists "chore_ov update" on public.chore_overrides;
drop policy if exists "chore_ov delete" on public.chore_overrides;
create policy "chore_ov read"   on public.chore_overrides for select to authenticated using (true);
create policy "chore_ov insert" on public.chore_overrides for insert to authenticated with check (true);
create policy "chore_ov update" on public.chore_overrides for update to authenticated using (true) with check (true);
create policy "chore_ov delete" on public.chore_overrides for delete to authenticated using (true);

create table if not exists public.chore_transfer_requests (
  id            uuid primary key default gen_random_uuid(),
  chore_key     text not null,
  chore_date    text not null,
  chore_label   text,
  from_employee text not null,
  to_employee   text not null,
  requested_by  uuid not null,
  status        text not null default 'pending',
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists chore_tr_status_idx on public.chore_transfer_requests (status);
create index if not exists chore_tr_to_idx     on public.chore_transfer_requests (to_employee);
create index if not exists chore_tr_by_idx     on public.chore_transfer_requests (requested_by);
grant select, insert, update, delete on public.chore_transfer_requests to authenticated;
grant all on public.chore_transfer_requests to service_role;
alter table public.chore_transfer_requests enable row level security;
drop policy if exists "chore_tr read"   on public.chore_transfer_requests;
drop policy if exists "chore_tr insert" on public.chore_transfer_requests;
drop policy if exists "chore_tr update" on public.chore_transfer_requests;
create policy "chore_tr read"   on public.chore_transfer_requests for select to authenticated using (true);
create policy "chore_tr insert" on public.chore_transfer_requests for insert to authenticated with check (requested_by = auth.uid());
create policy "chore_tr update" on public.chore_transfer_requests for update to authenticated using (true) with check (true);

create or replace function public.notify_chore_transfer_new()
returns trigger language plpgsql security definer set search_path = public as $$
declare p record;
begin
  for p in select id from public.profiles where employee_name = new.to_employee loop
    if p.id <> new.requested_by then
      insert into public.notifications (user_id, kind, title, body, link)
      values (p.id, 'chore_transfer',
        'Tarea transferida a ti',
        coalesce(new.from_employee, 'Alguien') || ' te pide cubrir: ' || coalesce(new.chore_label, 'una tarea') || ' (' || new.chore_date || ')',
        'swaps');
    end if;
  end loop;
  return new;
exception when others then return new;
end $$;
drop trigger if exists trg_notify_chore_transfer_new on public.chore_transfer_requests;
create trigger trg_notify_chore_transfer_new after insert on public.chore_transfer_requests
  for each row execute function public.notify_chore_transfer_new();

create or replace function public.notify_chore_transfer_reviewed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'pending' and new.status in ('approved', 'rejected') then
    insert into public.notifications (user_id, kind, title, body, link)
    values (new.requested_by, 'chore_transfer_' || new.status,
      case when new.status = 'approved' then 'Transferencia aprobada ✓' else 'Transferencia rechazada' end,
      'Tu transferencia de ' || coalesce(new.chore_label, 'tarea') || ' (' || new.chore_date || ') fue '
        || case when new.status = 'approved' then 'aprobada' else 'rechazada' end || '.',
      'swaps');
  end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists trg_notify_chore_transfer_reviewed on public.chore_transfer_requests;
create trigger trg_notify_chore_transfer_reviewed after update on public.chore_transfer_requests
  for each row execute function public.notify_chore_transfer_reviewed();

do $$ begin alter publication supabase_realtime add table public.chore_overrides; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.chore_transfer_requests; exception when duplicate_object then null; end $$;