-- 1) Push subscriptions
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;
alter table public.push_subscriptions enable row level security;
drop policy if exists "Push subs: own rows" on public.push_subscriptions;
create policy "Push subs: own rows"
  on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 2) Push config
create table if not exists public.push_config (
  id             integer primary key,
  vapid_public   text not null,
  vapid_private  text not null,
  webhook_secret text not null,
  function_url   text not null
);
grant all on public.push_config to service_role;
alter table public.push_config enable row level security;

insert into public.push_config (id, vapid_public, vapid_private, webhook_secret, function_url) values (
  1,
  'BNA3FmyrynuTDqmXew9w9UMxWZ1iBLLul6weQPQiQFvk6GABZTeTnDn1lSK4yu6CT-_3g7BRgvzd2-QZyipN_gY',
  'k4NNTukDiTEq_BOnUzMLxKk1vrbKriWJ9tVxJtRUdIs',
  '_8vtGMDySFrzgFJBk_v6bNh_Jutv4mmi',
  'https://urouxurlzshjmocmjptr.supabase.co/functions/v1/send-push'
) on conflict (id) do update set
  vapid_public = excluded.vapid_public,
  vapid_private = excluded.vapid_private,
  webhook_secret = excluded.webhook_secret,
  function_url = excluded.function_url;

-- 3) Push trigger
create extension if not exists pg_net;
create or replace function public.push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg record;
begin
  select * into cfg from public.push_config where id = 1;
  if cfg is not null then
    perform net.http_post(
      url     := cfg.function_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', cfg.webhook_secret),
      body    := jsonb_build_object('record', to_jsonb(new))
    );
  end if;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists trg_push_on_notification on public.notifications;
create trigger trg_push_on_notification
  after insert on public.notifications
  for each row execute function public.push_on_notification();

-- 4) Daily summary
create extension if not exists pg_cron;
create or replace function public.send_daily_summary()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d    date := (now() at time zone 'America/Santo_Domingo')::date;
  att  integer; ns integer; canc integer; wi integer;
  caja numeric; gas numeric;
  adm  record;
  btxt text;
begin
  select
    count(*) filter (where not cancelled and not no_show),
    count(*) filter (where no_show),
    count(*) filter (where cancelled),
    count(*) filter (where walk_in and not cancelled and not no_show)
  into att, ns, canc, wi
  from public.appointments where date = d;

  select coalesce(sum(amount), 0) into caja
  from public.invoice_payments
  where (created_at at time zone 'America/Santo_Domingo')::date = d;

  select coalesce(sum(amount), 0) into gas
  from public.expenses
  where date::date = d or (created_at at time zone 'America/Santo_Domingo')::date = d;

  btxt := coalesce(att,0) || ' atendidas · ' || coalesce(ns,0) || ' no asistieron · '
       || coalesce(canc,0) || ' cancelaron · ' || coalesce(wi,0) || ' sin cita · Caja RD$'
       || to_char(caja, 'FM999,999,990') || ' · Gastos RD$' || to_char(gas, 'FM999,999,990');

  for adm in select distinct user_id from public.user_roles where role = 'admin' loop
    insert into public.notifications (user_id, kind, title, body, link)
    values (adm.user_id, 'daily_summary', 'Resumen del día ' || to_char(d, 'DD/MM'), btxt, 'date:' || d);
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'charm-daily-summary') then
    perform cron.unschedule('charm-daily-summary');
  end if;
  perform cron.schedule('charm-daily-summary', '0 1 * * *', 'select public.send_daily_summary()');
end
$$;

-- 5) Waitlist
create table if not exists public.waitlist (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  client_name text not null,
  phone       text,
  note        text,
  status      text not null default 'pending' check (status in ('pending','called','booked','removed')),
  created_at  timestamptz not null default now(),
  created_by  uuid
);
create index if not exists waitlist_date_idx on public.waitlist (date, status);
grant select, insert, update, delete on public.waitlist to authenticated;
grant all on public.waitlist to service_role;
alter table public.waitlist enable row level security;
drop policy if exists "Waitlist readable by authenticated" on public.waitlist;
create policy "Waitlist readable by authenticated"
  on public.waitlist for select to authenticated using (true);
drop policy if exists "Waitlist write: admin or agenda editors" on public.waitlist;
create policy "Waitlist write: admin or agenda editors"
  on public.waitlist for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role) or public.has_perm(auth.uid(), 'agenda_edit'))
  with check (public.has_role(auth.uid(), 'admin'::app_role) or public.has_perm(auth.uid(), 'agenda_edit'));

-- 6) Vacation allowance
alter table public.employee_settings add column if not exists vacation_days integer not null default 14;