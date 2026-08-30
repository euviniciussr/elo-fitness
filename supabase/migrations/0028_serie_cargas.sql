-- Registro de carga utilizada pelo aluno em cada série válida, pra permitir
-- acompanhar progressão de carga ao longo do tempo. Uma linha por
-- (treino_exercicio, série, dia) — o aluno pode editar o valor do dia atual
-- (upsert por essa chave), mas dias anteriores nunca são sobrescritos, o que
-- por si só já forma o histórico de progressão.
-- Nunca aparece pré-preenchido: o app do aluno só usa o registro do dia
-- corrente pra decidir se mostra o campo vazio ou o valor já salvo hoje.

create table serie_cargas (
  id uuid primary key default gen_random_uuid(),
  treino_exercicio_id uuid not null references treino_exercicios(id) on delete cascade,
  cliente_id uuid not null references clientes(id) on delete cascade,
  trainer_id uuid not null references trainers(id) on delete cascade,
  serie_index int not null,
  carga numeric not null,
  data date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (treino_exercicio_id, serie_index, data)
);

create index serie_cargas_treino_exercicio_idx on serie_cargas (treino_exercicio_id, serie_index, data desc);

alter table serie_cargas enable row level security;

create policy "aluno gerencia suas próprias cargas registradas"
  on serie_cargas for all
  using (exists (select 1 from clientes where clientes.id = serie_cargas.cliente_id and clientes.auth_user_id = auth.uid()))
  with check (exists (select 1 from clientes where clientes.id = serie_cargas.cliente_id and clientes.auth_user_id = auth.uid()));

create policy "trainer vê cargas registradas dos seus alunos"
  on serie_cargas for select
  using (trainer_id = auth.uid());
