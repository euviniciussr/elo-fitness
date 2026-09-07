-- 0039 only routes *new* signups of contabusinessvini@gmail.com into `admins`
-- instead of `trainers`. If that email already signed up before 0039 existed
-- (e.g. via the "Entrar como ADM" quick-access button on login.html before
-- this fix shipped), it's stuck as a stray row in `trainers` — still (again,
-- incorrectly) tied to Savera's trainers.is_admin flag — with no matching
-- row in `admins`, so painel-adm.html would keep rejecting it.
do $$
declare
  v_user_id uuid;
begin
  select id into v_user_id from auth.users where email = 'contabusinessvini@gmail.com';
  if v_user_id is not null then
    insert into public.admins (id, email)
    values (v_user_id, 'contabusinessvini@gmail.com')
    on conflict (id) do nothing;
    delete from public.trainers where id = v_user_id;
  end if;
end $$;
