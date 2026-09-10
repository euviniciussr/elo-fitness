-- Troca o token de convite de UUID longo (36 caracteres) pra texto curto
-- (o app agora gera um código de 5 caracteres client-side), pra dar pra
-- montar um link limpo tipo /c/<nome-do-personal>/<codigo> em vez de
-- convite.html?token=<uuid enorme>. `using token::text` preserva qualquer
-- token já emitido antes da migração (continua funcionando como texto).
-- Adiciona também uma constraint de unicidade que não existia antes.
alter table convites alter column token type text using token::text;
alter table convites alter column token drop default;
alter table convites add constraint convites_token_key unique (token);

drop function if exists public.get_convite(uuid);
create or replace function public.get_convite(p_token text)
returns table (email text, status text, trainer_nome text)
language sql
security definer set search_path = public
as $$
  select c.email, c.status, t.nome
  from convites c
  join trainers t on t.id = c.trainer_id
  where c.token = p_token
  limit 1;
$$;
grant execute on function public.get_convite(text) to anon, authenticated;

-- Corpo idêntico ao já em produção (accept_convite com reaproveitamento de
-- cliente existente + checagem de limite do plano) — só troca o tipo do
-- parâmetro p_token de uuid pra text. Peguei a definição direto do banco
-- (pg_get_functiondef) antes de escrever isso, pra não perder nenhuma
-- lógica das migrations 0044/0045/0047.
drop function if exists public.accept_convite(uuid, text);
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

    insert into clientes (trainer_id, auth_user_id, nome, email, status)
    values (v_convite.trainer_id, auth.uid(), coalesce(nullif(p_nome, ''), v_convite.email), v_convite.email, 'ativo')
    returning id into v_cliente_id;
  end if;

  update convites set status = 'aceito', cliente_id = v_cliente_id where id = v_convite.id;

  return v_cliente_id;
end;
$$;
grant execute on function public.accept_convite(text, text) to authenticated;
