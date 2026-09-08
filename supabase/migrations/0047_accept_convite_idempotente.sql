-- Bug real reportado: aluna aceitou convite normalmente (cliente criado
-- certinho, com nome, treino, avaliação), mas em algum momento depois
-- accept_convite() rodou de novo pra esse mesmo auth.uid() (reabrir o link
-- do convite com sessão já ativa, ou o personal gerar um segundo convite
-- pro mesmo e-mail depois que ela já tinha aceitado o primeiro) — e como o
-- reaproveitamento de linha (migration 0044) só procura cliente com
-- `auth_user_id is null`, a segunda chamada não encontra a linha já
-- vinculada e cria uma SEGUNDA linha em clientes pro mesmo aluno. Pior:
-- convite.html chama accept_convite com `session.user.user_metadata?.nome
-- || ''` nesse caminho de "sessão já ativa" — se vier vazio, a linha nova
-- entra sem nome (o "?" sem nome na lista de alunos do personal).
--
-- Fix: 1) procura primeiro por um cliente já vinculado a esse auth.uid()
-- dentro do mesmo trainer, antes de procurar por e-mail — torna a função
-- idempotente pra qualquer chamada repetida, não só a original. 2) nunca
-- insere nome vazio — usa o e-mail do convite como fallback, igual ao
-- fallback que a atualização (branch de reaproveitar linha) já tinha.
--
-- NÃO apaga nem mexe em nenhuma linha já duplicada existente — isso
-- precisa de limpeza manual pontual (ver instruções passadas fora deste
-- arquivo). Esta migration só corrige o comportamento daqui pra frente.
create or replace function public.accept_convite(p_token uuid, p_nome text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_convite convites%rowtype;
  v_cliente_id uuid;
  v_limite int;
  v_atual int;
begin
  select * into v_convite from convites where token = p_token and status = 'pendente';
  if not found then
    raise exception 'Convite inválido ou já utilizado.';
  end if;

  select id into v_cliente_id
  from clientes
  where trainer_id = v_convite.trainer_id
    and auth_user_id = auth.uid()
  limit 1;

  if v_cliente_id is null then
    select id into v_cliente_id
    from clientes
    where trainer_id = v_convite.trainer_id
      and lower(email) = lower(v_convite.email)
      and auth_user_id is null
    limit 1;
  end if;

  if v_cliente_id is not null then
    update clientes
    set auth_user_id = auth.uid(),
        nome = coalesce(nullif(p_nome, ''), nome),
        status = 'ativo'
    where id = v_cliente_id;
  else
    select pa.limite_alunos into v_limite
    from trainers t
    left join planos_assinatura pa on pa.id = t.plano_id
    where t.id = v_convite.trainer_id;

    if v_limite is not null then
      select count(*) into v_atual from clientes where trainer_id = v_convite.trainer_id;
      if v_atual >= v_limite then
        raise exception 'Seu personal atingiu o limite de alunos do plano atual — peça pra ele fazer upgrade antes de você continuar.';
      end if;
    end if;

    insert into clientes (trainer_id, auth_user_id, nome, email, status)
    values (v_convite.trainer_id, auth.uid(), coalesce(nullif(p_nome, ''), v_convite.email), v_convite.email, 'ativo')
    returning id into v_cliente_id;
  end if;

  update convites set status = 'aceito', cliente_id = v_cliente_id where id = v_convite.id;

  return v_cliente_id;
end;
$$;
