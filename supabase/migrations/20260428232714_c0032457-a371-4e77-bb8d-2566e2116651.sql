
-- invoices: add customer_email
alter table public.invoices add column if not exists customer_email text;

-- invoice_items: rename + add package fields
alter table public.invoice_items rename column qty to quantity;
alter table public.invoice_items rename column catalog_id to catalog_item_id;
alter table public.invoice_items add column if not exists is_package boolean not null default false;
alter table public.invoice_items add column if not exists package_sessions integer;

-- customer_packages: add invoice_item_id link
alter table public.customer_packages add column if not exists invoice_item_id uuid references public.invoice_items(id) on delete set null;
create index if not exists customer_packages_item_idx on public.customer_packages(invoice_item_id);

-- expenses: rename photo_url -> receipt_url
alter table public.expenses rename column photo_url to receipt_url;

-- cash_closures: explicit denomination + per-method columns
alter table public.cash_closures drop column if exists totals_by_method;
alter table public.cash_closures drop column if exists opening_cash;
alter table public.cash_closures drop column if exists counted_cash;
alter table public.cash_closures drop column if exists expected_cash;
alter table public.cash_closures drop column if exists difference;

alter table public.cash_closures add column if not exists bills_2000 integer not null default 0;
alter table public.cash_closures add column if not exists bills_1000 integer not null default 0;
alter table public.cash_closures add column if not exists bills_500  integer not null default 0;
alter table public.cash_closures add column if not exists bills_200  integer not null default 0;
alter table public.cash_closures add column if not exists bills_100  integer not null default 0;
alter table public.cash_closures add column if not exists bills_50   integer not null default 0;
alter table public.cash_closures add column if not exists coins_25   integer not null default 0;
alter table public.cash_closures add column if not exists coins_10   integer not null default 0;
alter table public.cash_closures add column if not exists coins_5    integer not null default 0;
alter table public.cash_closures add column if not exists coins_1    integer not null default 0;

alter table public.cash_closures add column if not exists cash_counted          numeric(12,2) not null default 0;
alter table public.cash_closures add column if not exists transfers_counted     numeric(12,2) not null default 0;
alter table public.cash_closures add column if not exists azul_counted          numeric(12,2) not null default 0;
alter table public.cash_closures add column if not exists card_terminal_counted numeric(12,2) not null default 0;

alter table public.cash_closures add column if not exists cash_system           numeric(12,2) not null default 0;
alter table public.cash_closures add column if not exists transfers_system      numeric(12,2) not null default 0;
alter table public.cash_closures add column if not exists azul_system           numeric(12,2) not null default 0;
alter table public.cash_closures add column if not exists card_terminal_system  numeric(12,2) not null default 0;

alter table public.cash_closures add column if not exists cash_difference numeric(12,2) not null default 0;
alter table public.cash_closures add column if not exists total_income    numeric(12,2) not null default 0;
alter table public.cash_closures add column if not exists total_expenses  numeric(12,2) not null default 0;
alter table public.cash_closures add column if not exists net_total       numeric(12,2) not null default 0;
alter table public.cash_closures add column if not exists closed_by       text;
