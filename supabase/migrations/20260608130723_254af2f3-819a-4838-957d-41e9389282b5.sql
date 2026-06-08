create or replace function public.apply_signup_role(role_key text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return; end if;
  if role_key = 'secretary' then
    insert into public.user_permissions
      (user_id, full_agenda, clients_access, sales, inventory, reports, history, agenda_edit, caja)
    values (uid, true, 'edit', false, false, true, true, true, true)
    on conflict (user_id) do update set
      full_agenda = true, clients_access = 'edit', sales = false, inventory = false,
      reports = true, history = true, agenda_edit = true, caja = true;
  end if;
end; $$;

grant execute on function public.apply_signup_role(text) to authenticated;