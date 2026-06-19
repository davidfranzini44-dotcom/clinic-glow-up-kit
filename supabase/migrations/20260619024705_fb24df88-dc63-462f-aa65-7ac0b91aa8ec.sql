alter table public.employee_settings add column if not exists cabins text;

update public.employee_settings set cabins = cabin::text where cabins is null and cabin is not null;