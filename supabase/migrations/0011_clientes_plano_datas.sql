-- Datas comerciais do plano do cliente (distintas de treinos.data_inicio/data_expiracao,
-- que são do programa de treino, não do contrato comercial).
alter table clientes add column if not exists plano_data_inicio date;
alter table clientes add column if not exists plano_data_expiracao date;

-- Cadastro manual de aluno (fora do fluxo de convite) já cria a linha em `clientes`
-- antes de o aluno ter conta. Quando o convite pra esse cliente for aceito, o
-- accept_convite precisa vincular a MESMA linha (via convites.cliente_id) em vez de
-- sempre inserir uma nova — senão duplica o cadastro.
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

  if v_convite.cliente_id is not null then
    update clientes
      set auth_user_id = auth.uid(),
          nome = coalesce(nullif(p_nome, ''), nome)
      where id = v_convite.cliente_id
      returning id into v_cliente_id;
  else
    insert into clientes (trainer_id, auth_user_id, nome, email, status)
    values (v_convite.trainer_id, auth.uid(), p_nome, v_convite.email, 'ativo')
    returning id into v_cliente_id;
  end if;

  update convites set status = 'aceito', cliente_id = v_cliente_id where id = v_convite.id;

  return v_cliente_id;
end;
$$;

grant execute on function public.accept_convite(uuid, text) to authenticated;
