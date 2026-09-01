-- Check individual "série realizada", persistido por dia — mesmo padrão de
-- treino_exercicio_execucoes, mas por série (serie_index), pra o aluno
-- acompanhar quantas séries de um exercício já fez sem perder a conta.
-- Presença da linha = marcada; desmarcar apaga a linha.
create table treino_serie_execucoes (
  id uuid primary key default gen_random_uuid(),
  treino_exercicio_id uuid not null references treino_exercicios(id) on delete cascade,
  serie_index int not null,
  cliente_id uuid not null references clientes(id) on delete cascade,
  trainer_id uuid not null references trainers(id) on delete cascade,
  data date not null default current_date,
  created_at timestamptz not null default now(),
  unique (treino_exercicio_id, serie_index, data)
);

alter table treino_serie_execucoes enable row level security;

create policy "aluno gerencia seus próprios checks de série"
  on treino_serie_execucoes for all
  using (exists (select 1 from clientes where clientes.id = treino_serie_execucoes.cliente_id and clientes.auth_user_id = auth.uid()))
  with check (exists (select 1 from clientes where clientes.id = treino_serie_execucoes.cliente_id and clientes.auth_user_id = auth.uid()));

create policy "trainer vê checks de série dos seus alunos"
  on treino_serie_execucoes for select
  using (trainer_id = auth.uid());
