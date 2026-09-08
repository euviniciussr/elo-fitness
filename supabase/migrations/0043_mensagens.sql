-- Chat direto entre trainer e aluno. "Mensagens" já existia como tela
-- visual em app-aluno.html (e o "Não lida" em dashboard.html) mas nunca
-- foi ligada a nada real — nem tabela existia. `notificacoes` não serve
-- pra isso: é aviso de uma via (lida/não lida), não uma conversa.
create table mensagens (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  cliente_id uuid not null references clientes(id) on delete cascade,
  remetente text not null check (remetente in ('trainer', 'aluno')),
  texto text not null,
  lida boolean not null default false,
  created_at timestamptz not null default now()
);
alter table mensagens enable row level security;

create policy "trainer vê e edita mensagens dos seus alunos"
  on mensagens for all
  using (trainer_id = auth.uid());

create policy "aluno vê mensagens da própria conversa"
  on mensagens for select
  using (exists (
    select 1 from clientes
    where clientes.id = mensagens.cliente_id
    and clientes.auth_user_id = auth.uid()
  ));

create policy "aluno envia mensagem pro próprio trainer"
  on mensagens for insert
  with check (
    remetente = 'aluno'
    and exists (
      select 1 from clientes
      where clientes.id = mensagens.cliente_id
      and clientes.auth_user_id = auth.uid()
      and clientes.trainer_id = mensagens.trainer_id
    )
  );
