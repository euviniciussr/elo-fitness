-- accept_convite() não conferia nenhum limite de alunos antes de criar a
-- linha em clientes — só adicionar-aluno.html reforçava
-- planos_assinatura.limite_alunos. Como o convite passa a ser o caminho
-- principal de entrada de alunos, um trainer no plano grátis (até 5) ou no
-- "Até 30 alunos" podia simplesmente mandar convites pra sempre e furar o
-- limite do próprio plano. Só entra em jogo quando cria uma linha nova —
-- reaproveitar uma linha já existente (aluno cadastrado manualmente antes)
-- não aumenta a contagem, então não precisa checar.
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
    and lower(email) = lower(v_convite.email)
    and auth_user_id is null
  limit 1;

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
    values (v_convite.trainer_id, auth.uid(), p_nome, v_convite.email, 'ativo')
    returning id into v_cliente_id;
  end if;

  update convites set status = 'aceito', cliente_id = v_cliente_id where id = v_convite.id;

  return v_cliente_id;
end;
$$;
