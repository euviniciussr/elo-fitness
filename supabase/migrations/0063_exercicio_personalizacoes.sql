-- Personalização individual de exercícios da plataforma. O exercício global
-- (exercicios.is_global, migration 0061) continua sendo um registro único,
-- controlado pelo admin. Cada profissional pode sobrepor nome, grupo muscular
-- e vídeo só pro painel dele (e pros alunos dele) numa linha desta tabela —
-- nada é copiado e o registro original nunca é alterado.
--   campo nulo      → herda o valor oficial (atualizações do admin continuam chegando);
--   campo preenchido → vale a versão do profissional.
-- "Restaurar padrão" = apagar a linha. treino_exercicios continua apontando
-- pro mesmo exercicios.id; a personalização é só uma camada de leitura.
create table exercicio_personalizacoes (
  id uuid primary key default gen_random_uuid(),
  exercicio_id uuid not null references exercicios(id) on delete cascade,
  trainer_id uuid not null references trainers(id) on delete cascade,
  nome text,
  categoria text,
  video_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exercicio_id, trainer_id)
);

comment on table exercicio_personalizacoes is
  'Sobreposição por profissional dos campos de um exercício global. Campo nulo = herda o valor oficial de exercicios.';

create index exercicio_personalizacoes_trainer_idx on exercicio_personalizacoes (trainer_id);

alter table exercicio_personalizacoes enable row level security;

-- Profissional lê só as próprias personalizações.
create policy "trainer vê suas personalizações de exercício"
  on exercicio_personalizacoes for select
  using (trainer_id = auth.uid());

-- Cria/edita só em nome próprio, e só sobre exercício global (o particular
-- ele já edita direto em exercicios).
create policy "trainer cria personalização de exercício global"
  on exercicio_personalizacoes for insert
  with check (
    trainer_id = auth.uid()
    and exists (select 1 from trainers where trainers.id = auth.uid())
    and exists (select 1 from exercicios e where e.id = exercicio_id and e.is_global)
  );

create policy "trainer edita suas personalizações de exercício"
  on exercicio_personalizacoes for update
  using (trainer_id = auth.uid())
  with check (
    trainer_id = auth.uid()
    and exists (select 1 from exercicios e where e.id = exercicio_id and e.is_global)
  );

create policy "trainer remove suas personalizações de exercício"
  on exercicio_personalizacoes for delete
  using (trainer_id = auth.uid());

-- Aluno enxerga a personalização do profissional que prescreveu o treino
-- dele, e só dos exercícios que estão nesse treino.
create policy "aluno vê personalização dos exercícios do seu treino"
  on exercicio_personalizacoes for select
  using (exists (
    select 1 from treino_exercicios te
    join treinos tr on tr.id = te.treino_id
    join clientes on clientes.id = tr.cliente_id
    where te.exercicio_id = exercicio_personalizacoes.exercicio_id
      and tr.trainer_id = exercicio_personalizacoes.trainer_id
      and clientes.auth_user_id = auth.uid()
  ));

-- Mesmo bloqueio de onboarding das demais tabelas de treino (0057).
create policy "onboarding: aluno com anamnese pendente bloqueado"
  on exercicio_personalizacoes
  as restrictive for all to authenticated
  using (not (select public.aluno_onboarding_pendente()))
  with check (not (select public.aluno_onboarding_pendente()));
