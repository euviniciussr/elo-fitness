-- accept_convite() sempre inserta uma linha nova em clientes. Mas o personal
-- pode já ter cadastrado esse aluno manualmente antes (adicionar-aluno.html,
-- que cria o registro sem acesso de login nenhum) e só depois mandar o
-- convite pro mesmo e-mail. Sem esse fix, o aceite cria uma segunda linha
-- duplicada: o histórico de treinos/pagamentos fica preso na linha antiga
-- (sem login) enquanto o login do aluno passa a apontar pra uma linha nova
-- e vazia. Agora reaproveita a linha existente (mesmo trainer + email, ainda
-- sem auth_user_id) em vez de duplicar.
create or replace function public.accept_convite(p_token uuid, p_nome text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_convite convites%rowtype;
  v_cliente_id uuid;
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
    insert into clientes (trainer_id, auth_user_id, nome, email, status)
    values (v_convite.trainer_id, auth.uid(), p_nome, v_convite.email, 'ativo')
    returning id into v_cliente_id;
  end if;

  update convites set status = 'aceito', cliente_id = v_cliente_id where id = v_convite.id;

  return v_cliente_id;
end;
$$;
