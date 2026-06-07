alter table public.appointments add column if not exists source        text not null default 'manual';
alter table public.appointments add column if not exists dnsuite_id    text;
alter table public.appointments add column if not exists service_name  text;
alter table public.appointments add column if not exists client_phone  text;
alter table public.appointments add column if not exists pending_amount numeric;
alter table public.appointments add column if not exists dnsuite_synced_at timestamptz;

create unique index if not exists appointments_dnsuite_id_key
  on public.appointments (dnsuite_id) where dnsuite_id is not null;

create table if not exists public.dnsuite_config (
  id           integer primary key default 1,
  tenant_id    text not null,
  sucursal_id  text not null,
  webhook_secret text not null,
  enabled      boolean not null default true,
  horizon_days integer not null default 21,
  last_run_at  timestamptz,
  last_result  text,
  updated_at   timestamptz not null default now()
);

grant select, insert, update, delete on public.dnsuite_config to authenticated;
grant all on public.dnsuite_config to service_role;

alter table public.dnsuite_config enable row level security;

drop policy if exists "DNSuite config: admin read" on public.dnsuite_config;
create policy "DNSuite config: admin read"
  on public.dnsuite_config for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists "DNSuite config: admin write" on public.dnsuite_config;
create policy "DNSuite config: admin write"
  on public.dnsuite_config for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

insert into public.dnsuite_config (id, tenant_id, sucursal_id, webhook_secret)
  values (1, 'Ssg0PWfZAWI7hub9hwJJ', '1', encode(gen_random_bytes(18), 'hex'))
  on conflict (id) do nothing;

create extension if not exists pg_net;
create extension if not exists pg_cron;

create or replace function public.run_dnsuite_sync()
returns void language plpgsql security definer set search_path = public as $$
declare cfg record;
begin
  select * into cfg from public.dnsuite_config where id = 1 and enabled;
  if cfg is null then return; end if;
  perform net.http_post(
    url := 'https://urouxurlzshjmocmjptr.supabase.co/functions/v1/dnsuite-sync',
    headers := jsonb_build_object('Content-Type','application/json','x-sync-secret', cfg.webhook_secret),
    body := jsonb_build_object('trigger','cron')
  );
end; $$;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'charm-dnsuite-sync') then
    perform cron.unschedule('charm-dnsuite-sync');
  end if;
  perform cron.schedule('charm-dnsuite-sync', '*/15 * * * *', 'select public.run_dnsuite_sync()');
end $$;