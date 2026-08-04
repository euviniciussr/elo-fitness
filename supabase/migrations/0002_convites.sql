-- Funções para o fluxo de convite de aluno (o convidado ainda não tem sessão
-- quando precisa ler o convite, e RLS normal bloquearia isso).

-- Evita que aceitar um convite de aluno também crie uma linha em trainers
-- (o trigger de novo usuário roda pra qualquer signup, inclusive alunos).
create or replace function public.handle_new_trainer()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from convites where email = new.email and status = 'pendente') then
    insert into public.trainers (id, nome, email)
    values (new.id, coalesce(new.raw_user_meta_data->>'nome', ''), new.email);
  end if;
  return new;
end;
$$;

-- Leitura pública (sem sessão) de um convite específico, só o necessário
-- pra mostrar a tela de aceite — não expõe a tabela inteira.
create or replace function public.get_convite(p_token uuid)
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

grant execute on function public.get_convite(uuid) to anon, authenticated;

-- Aceitar o convite: cria o cliente vinculado ao trainer do convite e ao
-- usuário autenticado (auth.uid()), e marca o convite como aceito.
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

  insert into clientes (trainer_id, auth_user_id, nome, email, status)
  values (v_convite.trainer_id, auth.uid(), p_nome, v_convite.email, 'ativo')
  returning id into v_cliente_id;

  update convites set status = 'aceito', cliente_id = v_cliente_id where id = v_convite.id;

  return v_cliente_id;
end;
$$;

grant execute on function public.accept_convite(uuid, text) to authenticated;
