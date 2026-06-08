-- sign-up screen can read the employee list
drop policy if exists "Employee settings readable by authenticated" on public.employee_settings;
create policy "Employee settings readable"
  on public.employee_settings for select to anon, authenticated using (true);