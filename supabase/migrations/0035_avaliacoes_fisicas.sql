-- Avaliação física (Pollock 7 dobras) — nova aba em aluno-detalhe.html (Personal)
-- e app-aluno.html (Aluno, somente leitura). Cada linha é uma fotografia
-- imutável dos dados do aluno naquela data (sexo/idade/peso/dobras), pré-
-- preenchida a partir de anamnese_respostas na hora de criar mas nunca
-- referenciando ela depois — assim, se o peso do aluno mudar na anamnese,
-- avaliações antigas continuam exatamente como foram registradas.
-- altura_cm é só informativa (não entra nas fórmulas de Pollock/Siri), por
-- isso fica opcional; os demais campos usados no cálculo são obrigatórios.
create table avaliacoes_fisicas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  trainer_id uuid not null references trainers(id) on delete cascade,
  data date not null default current_date,
  sexo text not null check (sexo in ('M', 'F')),
  idade int not null check (idade > 0),
  peso_kg numeric not null check (peso_kg > 0),
  altura_cm numeric check (altura_cm > 0),
  dobra_peitoral numeric not null check (dobra_peitoral > 0),
  dobra_axilar_media numeric not null check (dobra_axilar_media > 0),
  dobra_triceps numeric not null check (dobra_triceps > 0),
  dobra_subescapular numeric not null check (dobra_subescapular > 0),
  dobra_supra_iliaca numeric not null check (dobra_supra_iliaca > 0),
  dobra_abdominal numeric not null check (dobra_abdominal > 0),
  dobra_coxa numeric not null check (dobra_coxa > 0),
  observacoes text,
  created_at timestamptz not null default now()
);

alter table avaliacoes_fisicas enable row level security;

create policy "trainer gerencia as avaliações físicas dos seus alunos"
  on avaliacoes_fisicas for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

-- Aluno só lê (mesmo padrão de agendamentos em 0023_agendamentos_visivel_aluno.sql):
-- quem registra a avaliação é sempre o profissional.
create policy "aluno vê suas próprias avaliações físicas"
  on avaliacoes_fisicas for select
  using (exists (
    select 1 from clientes
    where clientes.id = avaliacoes_fisicas.cliente_id
    and clientes.auth_user_id = auth.uid()
  ));
