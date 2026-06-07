
-- 1) Profiles: phone
alter table public.profiles add column if not exists phone text;

-- 2) Per-employee permissions
create table if not exists public.user_permissions (
  user_id        uuid primary key,
  full_agenda    boolean not null default true,
  clients_access text not null default 'read' check (clients_access in ('none','read','edit')),
  sales          boolean not null default false,
  inventory      boolean not null default false,
  reports        boolean not null default false,
  history        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

grant select on public.user_permissions to authenticated;
grant select, insert, update, delete on public.user_permissions to authenticated;
grant all on public.user_permissions to service_role;

alter table public.user_permissions enable row level security;

drop trigger if exists set_updated_at_user_permissions on public.user_permissions;
create trigger set_updated_at_user_permissions before update on public.user_permissions
  for each row execute function public.update_updated_at();

drop policy if exists "Read own permissions or admin" on public.user_permissions;
create policy "Read own permissions or admin"
  on public.user_permissions for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists "Permissions write admin only" on public.user_permissions;
create policy "Permissions write admin only"
  on public.user_permissions for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

insert into public.user_permissions (user_id)
  select id from public.profiles
  on conflict (user_id) do nothing;

-- 3) Staff requests
create table if not exists public.employee_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  employee_name   text,
  kind            text not null check (kind in ('day_off','vacation','late_entry','sick')),
  date            date not null,
  end_date        date,
  new_start_min   integer,
  info            text,
  attachment_path text,
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

grant select, insert, update, delete on public.employee_requests to authenticated;
grant all on public.employee_requests to service_role;

create index if not exists employee_requests_status_idx on public.employee_requests (status, created_at desc);

alter table public.employee_requests enable row level security;

drop trigger if exists set_updated_at_employee_requests on public.employee_requests;
create trigger set_updated_at_employee_requests before update on public.employee_requests
  for each row execute function public.update_updated_at();

drop policy if exists "Requests: insert own" on public.employee_requests;
create policy "Requests: insert own"
  on public.employee_requests for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Requests: read own or admin" on public.employee_requests;
create policy "Requests: read own or admin"
  on public.employee_requests for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists "Requests: admin updates" on public.employee_requests;
create policy "Requests: admin updates"
  on public.employee_requests for update to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists "Requests: cancel own pending" on public.employee_requests;
create policy "Requests: cancel own pending"
  on public.employee_requests for delete to authenticated
  using (user_id = auth.uid() and status = 'pending');

-- 4) Per-date hour overrides
create table if not exists public.employee_date_overrides (
  id            uuid primary key default gen_random_uuid(),
  employee_name text not null,
  date          date not null,
  start_min     integer,
  end_min       integer,
  reason        text,
  created_at    timestamptz not null default now(),
  unique (employee_name, date)
);

grant select, insert, update, delete on public.employee_date_overrides to authenticated;
grant all on public.employee_date_overrides to service_role;

alter table public.employee_date_overrides enable row level security;

drop policy if exists "Overrides readable by authenticated" on public.employee_date_overrides;
create policy "Overrides readable by authenticated"
  on public.employee_date_overrides for select to authenticated using (true);

drop policy if exists "Overrides write admin only" on public.employee_date_overrides;
create policy "Overrides write admin only"
  on public.employee_date_overrides for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

-- 5) Color self-service function
create or replace function public.set_my_color(new_color text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  my_name text;
begin
  select employee_name into my_name from public.profiles where id = auth.uid();
  if my_name is null then
    raise exception 'Tu cuenta no está vinculada a una empleada.';
  end if;
  if exists (
    select 1 from public.employee_settings
    where active and color = new_color and name <> my_name
  ) then
    raise exception 'Ese color ya está en uso por otra empleada.';
  end if;
  update public.employee_settings set color = new_color where name = my_name;
end;
$$;

-- 6) Storage policies for request-files bucket (bucket created via tool)
drop policy if exists "Request files: users upload own" on storage.objects;
create policy "Request files: users upload own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'request-files' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Request files: read own or admin" on storage.objects;
create policy "Request files: read own or admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'request-files'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.has_role(auth.uid(), 'admin'::app_role))
  );
