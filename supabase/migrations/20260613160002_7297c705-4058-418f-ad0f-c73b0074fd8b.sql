create table if not exists public.chore_completions (
  chore_key text primary key,
  date      text not null,
  done      boolean not null default true,
  done_by   text,
  done_at   timestamptz not null default now()
);
create index if not exists chore_completions_date_idx on public.chore_completions (date);

grant select, insert, update, delete on public.chore_completions to authenticated;
grant all on public.chore_completions to service_role;

alter table public.chore_completions enable row level security;

drop policy if exists "chores read"   on public.chore_completions;
drop policy if exists "chores insert" on public.chore_completions;
drop policy if exists "chores update" on public.chore_completions;
drop policy if exists "chores delete" on public.chore_completions;
create policy "chores read"   on public.chore_completions for select to authenticated using (true);
create policy "chores insert" on public.chore_completions for insert to authenticated with check (true);
create policy "chores update" on public.chore_completions for update to authenticated using (true) with check (true);
create policy "chores delete" on public.chore_completions for delete to authenticated using (true);

do $$
begin
  alter publication supabase_realtime add table public.chore_completions;
exception when duplicate_object then null;
end $$;