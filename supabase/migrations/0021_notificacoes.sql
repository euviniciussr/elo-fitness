-- Sistema de notificações real (o sino do trainer e do aluno eram só UI
-- mockada, sem tabela nenhuma por trás — "clico e não vai nada").
create table notificacoes (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  cliente_id uuid references clientes(id) on delete cascade,
  destino text not null check (destino in ('trainer', 'aluno')),
  titulo text not null,
  descricao text,
  lida boolean not null default false,
  created_at timestamptz not null default now()
);

alter table notificacoes enable row level security;

create policy "trainer vê e edita suas notificações"
  on notificacoes for all
  using (destino = 'trainer' and trainer_id = auth.uid())
  with check (destino = 'trainer' and trainer_id = auth.uid());

create policy "aluno vê e edita suas notificações"
  on notificacoes for all
  using (destino = 'aluno' and exists (
    select 1 from clientes where clientes.id = notificacoes.cliente_id and clientes.auth_user_id = auth.uid()
  ))
  with check (destino = 'aluno' and exists (
    select 1 from clientes where clientes.id = notificacoes.cliente_id and clientes.auth_user_id = auth.uid()
  ));

-- Aluno pode notificar o próprio trainer (ex.: enviou feedback de treino).
create policy "aluno notifica o próprio trainer"
  on notificacoes for insert
  with check (
    destino = 'trainer'
    and exists (
      select 1 from clientes
      where clientes.id = notificacoes.cliente_id
      and clientes.auth_user_id = auth.uid()
      and clientes.trainer_id = notificacoes.trainer_id
    )
  );

-- Trainer pode notificar seus próprios alunos (ex.: liberou um treino novo).
create policy "trainer notifica seus alunos"
  on notificacoes for insert
  with check (
    destino = 'aluno'
    and trainer_id = auth.uid()
    and exists (select 1 from clientes where clientes.id = notificacoes.cliente_id and clientes.trainer_id = auth.uid())
  );

-- accept_convite (0011) redefinida mais uma vez: além de vincular a conta,
-- agora avisa o trainer que o convite foi aceito.
create or replace function public.accept_convite(p_token uuid, p_nome text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_convite convites%rowtype;
  v_cliente_id uuid;
  v_nome text;
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
      returning id, nome into v_cliente_id, v_nome;
  else
    insert into clientes (trainer_id, auth_user_id, nome, email, status)
    values (v_convite.trainer_id, auth.uid(), p_nome, v_convite.email, 'ativo')
    returning id, nome into v_cliente_id, v_nome;
  end if;

  update convites set status = 'aceito', cliente_id = v_cliente_id where id = v_convite.id;

  insert into notificacoes (trainer_id, cliente_id, destino, titulo)
  values (v_convite.trainer_id, v_cliente_id, 'trainer', coalesce(nullif(v_nome, ''), 'Um aluno') || ' aceitou seu convite');

  return v_cliente_id;
end;
$$;

grant execute on function public.accept_convite(uuid, text) to authenticated;
