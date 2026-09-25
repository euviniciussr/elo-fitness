-- Cadastro de aluno e cadastro de personal separados, na mesma conta de
-- login (o Supabase não deixa dois usuários com o mesmo e-mail):
--
-- - Cadastro de personal = linha em trainers (como sempre).
-- - Cadastro de aluno    = linha em contas_aluno (nova) OU vínculo em
--   clientes.auth_user_id (aluno de algum personal).
--
-- O login pergunta primeiro "aluno ou personal". Ter um cadastro não libera
-- o outro: quem escolhe um papel que ainda não tem cai numa tela pra fazer
-- esse cadastro (criar_cadastro_personal / criar_cadastro_aluno). Nada de
-- privilégio novo aqui — virar personal já era autocadastro aberto (0058).
--
-- "Sou meu próprio personal": personal que cria o cadastro de aluno pode
-- se vincular ao próprio painel (clientes.trainer_id = auth_user_id =
-- ele mesmo) pra alimentar os próprios dados de treino/dieta.

create table public.contas_aluno (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nome text,
  created_at timestamptz not null default now()
);
alter table public.contas_aluno enable row level security;
create policy "contas_aluno: dono lê" on public.contas_aluno
  for select to authenticated using (user_id = auth.uid());
-- Escrita só pelas funções security definer abaixo.

-- Backfill: quem não é personal se cadastrou como aluno (0058: sem tipo =
-- aluno), e quem já está vinculado como aluno de alguém.
insert into public.contas_aluno (user_id, nome)
select u.id, coalesce(u.raw_user_meta_data->>'nome', '')
from auth.users u
where not exists (select 1 from public.trainers t where t.id = u.id)
   or exists (select 1 from public.clientes c where c.auth_user_id = u.id)
on conflict (user_id) do nothing;

create or replace function public.handle_new_trainer()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if coalesce(new.raw_user_meta_data->>'tipo', '') = 'personal' then
    insert into public.trainers (id, nome, email, status_assinatura, trial_termina_em)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'nome', new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
      new.email, 'trial', current_date + 14
    )
    on conflict (id) do nothing;
  else
    insert into public.contas_aluno (user_id, nome)
    values (new.id, coalesce(new.raw_user_meta_data->>'nome', ''))
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

-- Quais cadastros a conta logada tem. "vinculado" = já é aluno de algum
-- personal (tem linha em clientes).
create or replace function public.meus_cadastros()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'personal', exists (select 1 from trainers where id = auth.uid()),
    'aluno', exists (select 1 from contas_aluno where user_id = auth.uid())
             or exists (select 1 from clientes where auth_user_id = auth.uid()),
    'vinculado', exists (select 1 from clientes where auth_user_id = auth.uid())
  );
$$;
revoke execute on function public.meus_cadastros() from public, anon;
grant execute on function public.meus_cadastros() to authenticated;

create or replace function public.criar_cadastro_personal(p_nome text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_user auth.users;
begin
  select * into v_user from auth.users where id = auth.uid();
  if v_user.id is null then
    raise exception 'Faça login primeiro.';
  end if;
  insert into trainers (id, nome, email, status_assinatura, trial_termina_em)
  values (
    v_user.id,
    coalesce(nullif(btrim(p_nome), ''), v_user.raw_user_meta_data->>'nome', ''),
    v_user.email, 'trial', current_date + 14
  )
  on conflict (id) do nothing;
end;
$$;
revoke execute on function public.criar_cadastro_personal(text) from public, anon;
grant execute on function public.criar_cadastro_personal(text) to authenticated;

create or replace function public.criar_cadastro_aluno(p_nome text, p_proprio_personal boolean default false)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_user auth.users;
  v_nome text;
  v_limite int;
  v_atual int;
begin
  select * into v_user from auth.users where id = auth.uid();
  if v_user.id is null then
    raise exception 'Faça login primeiro.';
  end if;
  v_nome := coalesce(nullif(btrim(p_nome), ''), v_user.raw_user_meta_data->>'nome', v_user.email);

  insert into contas_aluno (user_id, nome) values (v_user.id, v_nome)
  on conflict (user_id) do nothing;

  if coalesce(p_proprio_personal, false)
     and not exists (select 1 from clientes where auth_user_id = v_user.id) then
    if not exists (select 1 from trainers where id = v_user.id) then
      raise exception 'Faça seu cadastro de personal antes de se vincular a você mesmo.';
    end if;

    select pa.limite_alunos into v_limite
    from trainers t left join planos_assinatura pa on pa.id = t.plano_id
    where t.id = v_user.id;
    if v_limite is not null then
      select count(*) into v_atual from clientes where trainer_id = v_user.id;
      if v_atual >= v_limite then
        raise exception 'Você atingiu o limite de alunos do seu plano — faça upgrade pra se adicionar como aluno.';
      end if;
    end if;

    insert into clientes (trainer_id, auth_user_id, nome, email, status, origem_cadastro)
    values (v_user.id, v_user.id, v_nome, v_user.email, 'ativo', 'manual');
  end if;
end;
$$;
revoke execute on function public.criar_cadastro_aluno(text, boolean) from public, anon;
grant execute on function public.criar_cadastro_aluno(text, boolean) to authenticated;
