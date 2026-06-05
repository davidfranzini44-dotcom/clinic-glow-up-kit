
-- 1) employee_settings
create table if not exists public.employee_settings (
  name        text primary key,
  cabin       integer,
  color       text,
  max_clients integer,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

grant select on public.employee_settings to authenticated;
grant insert, update, delete on public.employee_settings to authenticated;
grant all on public.employee_settings to service_role;

alter table public.employee_settings enable row level security;

drop trigger if exists set_updated_at_employee_settings on public.employee_settings;
create trigger set_updated_at_employee_settings before update on public.employee_settings
  for each row execute function public.update_updated_at();

drop policy if exists "Employee settings readable by authenticated" on public.employee_settings;
create policy "Employee settings readable by authenticated"
  on public.employee_settings for select to authenticated using (true);

drop policy if exists "Employee settings write admin only" on public.employee_settings;
create policy "Employee settings write admin only"
  on public.employee_settings for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

-- 2) employee_schedules
create table if not exists public.employee_schedules (
  id              uuid primary key default gen_random_uuid(),
  employee_name   text not null,
  weekday         integer not null check (weekday between 0 and 6),
  works           boolean not null default true,
  start_min       integer,
  end_min         integer,
  lunch_start_min integer,
  lunch_minutes   integer not null default 60,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (employee_name, weekday)
);

grant select on public.employee_schedules to authenticated;
grant insert, update, delete on public.employee_schedules to authenticated;
grant all on public.employee_schedules to service_role;

alter table public.employee_schedules enable row level security;

drop trigger if exists set_updated_at_employee_schedules on public.employee_schedules;
create trigger set_updated_at_employee_schedules before update on public.employee_schedules
  for each row execute function public.update_updated_at();

drop policy if exists "Schedules readable by authenticated" on public.employee_schedules;
create policy "Schedules readable by authenticated"
  on public.employee_schedules for select to authenticated using (true);

drop policy if exists "Schedules write admin only" on public.employee_schedules;
create policy "Schedules write admin only"
  on public.employee_schedules for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

-- 3) employee_time_off
create table if not exists public.employee_time_off (
  id            uuid primary key default gen_random_uuid(),
  employee_name text not null,
  date          date not null,
  reason        text not null default 'off',
  created_at    timestamptz not null default now(),
  created_by    uuid,
  unique (employee_name, date)
);

create index if not exists employee_time_off_date_idx on public.employee_time_off (date);

grant select on public.employee_time_off to authenticated;
grant insert, update, delete on public.employee_time_off to authenticated;
grant all on public.employee_time_off to service_role;

alter table public.employee_time_off enable row level security;

drop policy if exists "Time off readable by authenticated" on public.employee_time_off;
create policy "Time off readable by authenticated"
  on public.employee_time_off for select to authenticated using (true);

drop policy if exists "Time off write admin only" on public.employee_time_off;
create policy "Time off write admin only"
  on public.employee_time_off for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

-- 4) Admin can update any profile
drop policy if exists "Admins update any profile" on public.profiles;
create policy "Admins update any profile"
  on public.profiles for update to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

-- 5) Seed current 4 employees
insert into public.employee_settings (name, cabin, color, max_clients, sort_order) values
  ('Yaira',  2, 'hsl(var(--emp-yaira))',  null, 1),
  ('Belkis', 1, 'hsl(var(--emp-belkis))', null, 2),
  ('Cielo',  1, 'hsl(var(--emp-cielo))',  null, 3),
  ('Lisa',   2, 'hsl(var(--emp-lisa))',   8,    4)
on conflict (name) do nothing;

do $$
declare
  emp record;
  wd  integer;
begin
  for emp in
    select * from (values
      ('Yaira',  540, 1080, 720),
      ('Belkis', 600, 1081, 780),
      ('Cielo',  660, 1200, 720),
      ('Lisa',   720, 1200, 780)
    ) as t(name, s, e, l)
  loop
    for wd in 0..6 loop
      insert into public.employee_schedules
        (employee_name, weekday, works, start_min, end_min, lunch_start_min)
      values
        (emp.name, wd, (wd <> 0), emp.s, emp.e, emp.l)
      on conflict (employee_name, weekday) do nothing;
    end loop;
  end loop;
end $$;
