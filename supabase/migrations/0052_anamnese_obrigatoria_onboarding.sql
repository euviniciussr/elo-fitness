-- Torna a anamnese uma etapa obrigatória de onboarding pra aluno que entra
-- via convite (self-signup) — sem afetar aluno cadastrado manualmente pelo
-- profissional (adicionar-aluno.html), que continua com acesso liberado
-- como sempre foi.

-- Marca se aquele cliente PRECISA concluir a anamnese antes de acessar o
-- app. Só é setado como true no momento em que accept_convite cria uma
-- linha NOVA em clientes (convite puro, sem cadastro manual prévio) — ver
-- alteração da função mais abaixo. Nunca é alterado depois disso.
alter table clientes add column anamnese_obrigatoria boolean not null default false;

-- Escolha explícita do profissional: qual anamnese os alunos dele recebem.
-- Default 'padrao' cobre "nunca personalizou = usa a padrão automaticamente".
alter table trainers add column anamnese_modo text not null default 'padrao' check (anamnese_modo in ('padrao', 'personalizada'));

-- Backfill: aluno que já recebeu convite, já tem login (auth_user_id) e
-- ainda não concluiu a anamnese dinâmica (respondido_em null, seja porque
-- nunca abriu ou porque abriu e não enviou) passa a ser tratado como
-- pendente daqui pra frente. Não apaga nem altera nenhum dado do aluno,
-- só a flag de onboarding. Aluno que já respondeu fica de fora (a
-- subquery com respondido_em not null exclui ele).
update clientes
set anamnese_obrigatoria = true
where auth_user_id is not null
  and not exists (
    select 1 from anamnese_respostas_dinamicas ard
    where ard.cliente_id = clientes.id and ard.respondido_em is not null
  );

-- Recria accept_convite: corpo idêntico ao de 0049_convite_token_curto.sql,
-- só adicionando anamnese_obrigatoria = true no branch que INSERE uma
-- linha nova em clientes (convite puro). O branch que reaproveita uma
-- linha já existente (cadastro manual prévio) não mexe nessa coluna —
-- fica no default false, sem bloqueio, como pedido.
create or replace function public.accept_convite(p_token text, p_nome text)
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

    insert into clientes (trainer_id, auth_user_id, nome, email, status, anamnese_obrigatoria)
    values (v_convite.trainer_id, auth.uid(), coalesce(nullif(p_nome, ''), v_convite.email), v_convite.email, 'ativo', true)
    returning id into v_cliente_id;
  end if;

  update convites set status = 'aceito', cliente_id = v_cliente_id where id = v_convite.id;

  return v_cliente_id;
end;
$$;
grant execute on function public.accept_convite(text, text) to authenticated;
