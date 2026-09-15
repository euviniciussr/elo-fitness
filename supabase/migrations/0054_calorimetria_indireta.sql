-- Calorimetria indireta como segunda forma de definir o gasto energético do
-- aluno (alternativa ao cálculo de TMB por fórmula, nunca substituição —
-- o profissional escolhe qual fonte usar). Cada exame é um registro
-- histórico imutável; qual deles está em uso fica marcado em
-- anamnese_respostas (mesmo padrão de "fonte de dado único ativo" já usado
-- pra nível de atividade/objetivo/estado atual).

create table calorimetrias (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  trainer_id uuid not null references trainers(id) on delete cascade,
  data_exame date not null default current_date,
  ger_kcal numeric not null check (ger_kcal > 0),
  vo2 numeric,
  vco2 numeric,
  rq numeric,
  observacoes text,
  created_at timestamptz not null default now()
);

alter table calorimetrias enable row level security;

create policy "trainer gerencia as calorimetrias dos seus alunos"
  on calorimetrias for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

-- Mesmo padrão de avaliacoes_fisicas (0035): aluno só lê, quem registra o
-- exame é sempre o profissional.
create policy "aluno vê suas próprias calorimetrias"
  on calorimetrias for select
  using (exists (
    select 1 from clientes
    where clientes.id = calorimetrias.cliente_id
    and clientes.auth_user_id = auth.uid()
  ));

grant select, insert, update, delete on calorimetrias to authenticated;

-- 'formula' preserva o comportamento atual pra todo aluno já cadastrado —
-- ninguém muda de fonte sem o profissional escolher isso explicitamente.
alter table anamnese_respostas
  add column fonte_gasto_energetico text not null default 'formula' check (fonte_gasto_energetico in ('formula', 'calorimetria')),
  add column calorimetria_id uuid references calorimetrias(id) on delete set null;
