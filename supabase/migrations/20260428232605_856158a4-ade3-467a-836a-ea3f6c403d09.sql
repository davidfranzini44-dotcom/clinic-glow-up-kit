
-- ═══════════════════════════════════════════════════════════════════════
-- CHARM v2: CRM + Sales + Inventory
-- ═══════════════════════════════════════════════════════════════════════

-- Helper: shared updated_at trigger fn (idempotent)
create or replace function public.update_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─── 1. CUSTOMERS ──────────────────────────────────────────────────────
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  source text default 'manual',
  birthday date,
  address text,
  notes text,
  allergies text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customers_name_idx on public.customers (lower(name));

drop trigger if exists set_updated_at_customers on public.customers;
create trigger set_updated_at_customers before update on public.customers
  for each row execute function public.update_updated_at();

alter table public.customers enable row level security;

create policy "Customers readable by authenticated"
  on public.customers for select to authenticated using (true);
create policy "Customers insertable by authenticated"
  on public.customers for insert to authenticated with check (true);
create policy "Customers updatable by authenticated"
  on public.customers for update to authenticated using (true) with check (true);
create policy "Customers deletable by admin"
  on public.customers for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));

-- ─── 2. CATALOG ────────────────────────────────────────────────────────
create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('service','product','package')),
  name text not null,
  price numeric(12,2) not null default 0,
  sessions integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists set_updated_at_catalog on public.catalog_items;
create trigger set_updated_at_catalog before update on public.catalog_items
  for each row execute function public.update_updated_at();

alter table public.catalog_items enable row level security;
create policy "Catalog readable by authenticated"
  on public.catalog_items for select to authenticated using (true);
create policy "Catalog write admin only"
  on public.catalog_items for all to authenticated
  using (public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_role(auth.uid(),'admin'::app_role));

-- ─── 3. INVOICES ───────────────────────────────────────────────────────
create sequence if not exists public.invoice_number_seq start 1001;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number integer not null unique default nextval('public.invoice_number_seq'),
  date date not null default current_date,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text,
  customer_phone text,
  sold_by text,
  subtotal numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  status text not null default 'paid' check (status in ('paid','partial','voided')),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter sequence public.invoice_number_seq owned by public.invoices.invoice_number;
create index if not exists invoices_date_idx on public.invoices(date);
create index if not exists invoices_customer_idx on public.invoices(customer_id);

drop trigger if exists set_updated_at_invoices on public.invoices;
create trigger set_updated_at_invoices before update on public.invoices
  for each row execute function public.update_updated_at();

alter table public.invoices enable row level security;
create policy "Invoices readable by authenticated"
  on public.invoices for select to authenticated using (true);
create policy "Invoices write admin only"
  on public.invoices for all to authenticated
  using (public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_role(auth.uid(),'admin'::app_role));

-- ─── 4. INVOICE ITEMS ──────────────────────────────────────────────────
create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  catalog_id uuid references public.catalog_items(id) on delete set null,
  name text not null,
  qty numeric(10,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists invoice_items_invoice_idx on public.invoice_items(invoice_id);

alter table public.invoice_items enable row level security;
create policy "Invoice items readable by authenticated"
  on public.invoice_items for select to authenticated using (true);
create policy "Invoice items write admin only"
  on public.invoice_items for all to authenticated
  using (public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_role(auth.uid(),'admin'::app_role));

-- ─── 5. INVOICE PAYMENTS ───────────────────────────────────────────────
create table if not exists public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  method text not null check (method in ('cash','transfer','azul','card_terminal')),
  amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists invoice_payments_invoice_idx on public.invoice_payments(invoice_id);

alter table public.invoice_payments enable row level security;
create policy "Invoice payments readable by authenticated"
  on public.invoice_payments for select to authenticated using (true);
create policy "Invoice payments write admin only"
  on public.invoice_payments for all to authenticated
  using (public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_role(auth.uid(),'admin'::app_role));

-- ─── 6. CUSTOMER PACKAGES ──────────────────────────────────────────────
create table if not exists public.customer_packages (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  package_name text not null,
  total_sessions integer not null default 1,
  used_sessions integer not null default 0,
  purchased_date date not null default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customer_packages_customer_idx on public.customer_packages(customer_id);

drop trigger if exists set_updated_at_customer_packages on public.customer_packages;
create trigger set_updated_at_customer_packages before update on public.customer_packages
  for each row execute function public.update_updated_at();

alter table public.customer_packages enable row level security;
create policy "Customer packages readable by authenticated"
  on public.customer_packages for select to authenticated using (true);
create policy "Customer packages write admin only"
  on public.customer_packages for all to authenticated
  using (public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_role(auth.uid(),'admin'::app_role));

-- ─── 7. EXPENSES ───────────────────────────────────────────────────────
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  category text,
  description text,
  amount numeric(12,2) not null default 0,
  photo_url text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists expenses_date_idx on public.expenses(date);

alter table public.expenses enable row level security;
create policy "Expenses readable by authenticated"
  on public.expenses for select to authenticated using (true);
create policy "Expenses write admin only"
  on public.expenses for all to authenticated
  using (public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_role(auth.uid(),'admin'::app_role));

-- ─── 8. CASH CLOSURES ──────────────────────────────────────────────────
create table if not exists public.cash_closures (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  opening_cash numeric(12,2) not null default 0,
  counted_cash numeric(12,2) not null default 0,
  expected_cash numeric(12,2) not null default 0,
  difference numeric(12,2) not null default 0,
  totals_by_method jsonb not null default '{}'::jsonb,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists cash_closures_date_idx on public.cash_closures(date);

alter table public.cash_closures enable row level security;
create policy "Cash closures readable by authenticated"
  on public.cash_closures for select to authenticated using (true);
create policy "Cash closures write admin only"
  on public.cash_closures for all to authenticated
  using (public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_role(auth.uid(),'admin'::app_role));

-- ─── 9. APPOINTMENT NOTES ──────────────────────────────────────────────
create table if not exists public.appointment_notes (
  id uuid primary key default gen_random_uuid(),
  appointment_id text not null unique references public.appointments(id) on delete cascade,
  treatments text default '',
  observations text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists appointment_notes_apt_idx on public.appointment_notes(appointment_id);

drop trigger if exists set_updated_at_appointment_notes on public.appointment_notes;
create trigger set_updated_at_appointment_notes before update on public.appointment_notes
  for each row execute function public.update_updated_at();

alter table public.appointment_notes enable row level security;
create policy "Appointment notes readable by authenticated"
  on public.appointment_notes for select to authenticated using (true);
create policy "Appointment notes insertable by authenticated"
  on public.appointment_notes for insert to authenticated with check (true);
create policy "Appointment notes updatable by authenticated"
  on public.appointment_notes for update to authenticated using (true) with check (true);
create policy "Appointment notes deletable by admin"
  on public.appointment_notes for delete to authenticated
  using (public.has_role(auth.uid(),'admin'::app_role));

-- ─── 10. INVENTORY ITEMS ───────────────────────────────────────────────
create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  sku text,
  name text not null,
  unit text,
  category text,
  stock numeric(10,2) not null default 0,
  cost_per_unit numeric(10,2) not null default 0,
  min_stock numeric(10,2) not null default 0,
  per_client_rate numeric(10,6) not null default 0,
  supplier text,
  supplier_phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists inventory_sku_idx on public.inventory_items(sku);

drop trigger if exists set_updated_at_inventory on public.inventory_items;
create trigger set_updated_at_inventory before update on public.inventory_items
  for each row execute function public.update_updated_at();

alter table public.inventory_items enable row level security;
create policy "Inventory items readable by authenticated"
  on public.inventory_items for select to authenticated using (true);
create policy "Inventory items write admin only"
  on public.inventory_items for all to authenticated
  using (public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_role(auth.uid(),'admin'::app_role));

-- ─── 11. INVENTORY MOVEMENTS ───────────────────────────────────────────
create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  item_id uuid references public.inventory_items(id) on delete cascade,
  item_name text not null,
  sku text,
  type text not null check (type in ('in','out','adjust')),
  qty numeric(10,2) not null,
  previous_stock numeric(10,2),
  new_stock numeric(10,2),
  notes text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists inventory_mov_date_idx on public.inventory_movements(date);
create index if not exists inventory_mov_item_idx on public.inventory_movements(item_id);

alter table public.inventory_movements enable row level security;
create policy "Inventory movements readable by authenticated"
  on public.inventory_movements for select to authenticated using (true);
create policy "Inventory movements write admin only"
  on public.inventory_movements for all to authenticated
  using (public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_role(auth.uid(),'admin'::app_role));

-- ─── REALTIME ──────────────────────────────────────────────────────────
do $$
begin
  begin
    alter publication supabase_realtime add table public.appointment_notes;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.inventory_items;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.inventory_movements;
  exception when duplicate_object then null;
  end;
end $$;
