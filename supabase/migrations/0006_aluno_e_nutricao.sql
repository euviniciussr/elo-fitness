-- Perfil do aluno com abas (Dieta, Cardio, Anamnese, Fotos, Feedback,
-- Agendamentos) + módulo de Nutrição no Acervo (Alimentos, Fórmulas,
-- Refeições pré-definidas, Cardápios/Minhas Dietas).
--
-- Padrão de RLS seguido (igual ao resto do schema):
--   - treinador: "for all" via trainer_id = auth.uid()
--   - aluno: policies adicionais só nas tabelas que ele também usa,
--     via join em clientes.auth_user_id = auth.uid()
--
-- Tabelas criadas via SQL cru não herdam GRANTs automáticos do Table Editor
-- (lição já registrada no projeto) — por isso todo GRANT abaixo é explícito.

create table dietas (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  cliente_id uuid references clientes(id) on delete set null,
  nome text not null,
  meta_calorica text,
  refeicoes jsonb not null default '[]',
  observacoes text,
  created_at timestamptz not null default now()
);

create table cardio_protocolos (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  cliente_id uuid not null references clientes(id) on delete cascade,
  tipo text,
  duracao_min int,
  frequencia_semanal int,
  intensidade text,
  observacoes text,
  created_at timestamptz not null default now()
);

create table anamnese_respostas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null unique references clientes(id) on delete cascade,
  trainer_id uuid not null references trainers(id) on delete cascade,
  objetivo text,
  nivel text,
  idade int,
  altura_cm int,
  peso_kg numeric,
  lesoes text,
  medicamentos text,
  restricoes text,
  respondido_em timestamptz not null default now()
);

create table fotos_evolucao (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  trainer_id uuid not null references trainers(id) on delete cascade,
  url text not null,
  tipo text not null default 'evolucao' check (tipo in ('inicial', 'evolucao')),
  created_at timestamptz not null default now()
);

create table feedbacks_treino (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  trainer_id uuid not null references trainers(id) on delete cascade,
  humor text,
  rpe int,
  comentario text,
  created_at timestamptz not null default now()
);

create table agendamentos (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  cliente_id uuid references clientes(id) on delete cascade,
  titulo text not null,
  tipo text,
  data_lembrete date not null,
  concluido boolean not null default false,
  observacoes text,
  created_at timestamptz not null default now()
);

create table alimentos (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  nome text not null,
  categoria text,
  kcal numeric,
  proteina_g numeric,
  carboidrato_g numeric,
  gordura_g numeric,
  fibra_g numeric,
  sodio_mg numeric,
  created_at timestamptz not null default now()
);

create table formulas_alimentares (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  nome text not null,
  descricao text,
  composicao jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table refeicoes_predefinidas (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  nome text not null,
  itens jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- RLS -------------------------------------------------------------------

alter table dietas enable row level security;
alter table cardio_protocolos enable row level security;
alter table anamnese_respostas enable row level security;
alter table fotos_evolucao enable row level security;
alter table feedbacks_treino enable row level security;
alter table agendamentos enable row level security;
alter table alimentos enable row level security;
alter table formulas_alimentares enable row level security;
alter table refeicoes_predefinidas enable row level security;

create policy "trainer vê e edita suas dietas"
  on dietas for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

create policy "aluno vê as dietas atribuídas a ele"
  on dietas for select
  using (exists (
    select 1 from clientes
    where clientes.id = dietas.cliente_id
    and clientes.auth_user_id = auth.uid()
  ));

create policy "trainer vê e edita os protocolos de cardio"
  on cardio_protocolos for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

create policy "aluno vê seu protocolo de cardio"
  on cardio_protocolos for select
  using (exists (
    select 1 from clientes
    where clientes.id = cardio_protocolos.cliente_id
    and clientes.auth_user_id = auth.uid()
  ));

create policy "trainer vê a anamnese dos seus alunos"
  on anamnese_respostas for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

create policy "aluno preenche e vê sua própria anamnese"
  on anamnese_respostas for all
  using (exists (
    select 1 from clientes
    where clientes.id = anamnese_respostas.cliente_id
    and clientes.auth_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from clientes
    where clientes.id = anamnese_respostas.cliente_id
    and clientes.auth_user_id = auth.uid()
  ));

create policy "trainer vê as fotos dos seus alunos"
  on fotos_evolucao for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

create policy "aluno envia e vê suas próprias fotos"
  on fotos_evolucao for all
  using (exists (
    select 1 from clientes
    where clientes.id = fotos_evolucao.cliente_id
    and clientes.auth_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from clientes
    where clientes.id = fotos_evolucao.cliente_id
    and clientes.auth_user_id = auth.uid()
  ));

create policy "trainer vê os feedbacks dos seus alunos"
  on feedbacks_treino for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

create policy "aluno envia e vê seus próprios feedbacks"
  on feedbacks_treino for all
  using (exists (
    select 1 from clientes
    where clientes.id = feedbacks_treino.cliente_id
    and clientes.auth_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from clientes
    where clientes.id = feedbacks_treino.cliente_id
    and clientes.auth_user_id = auth.uid()
  ));

-- Agendamentos são só do treinador — não existe policy de aluno de propósito.
create policy "trainer vê e edita seus agendamentos"
  on agendamentos for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

create policy "trainer vê e edita seus alimentos"
  on alimentos for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

create policy "trainer vê e edita suas fórmulas"
  on formulas_alimentares for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

create policy "trainer vê e edita suas refeições predefinidas"
  on refeicoes_predefinidas for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

-- GRANTs ------------------------------------------------------------------

grant select, insert, update, delete on
  dietas, cardio_protocolos, anamnese_respostas, fotos_evolucao,
  feedbacks_treino, agendamentos, alimentos, formulas_alimentares,
  refeicoes_predefinidas
to authenticated;

-- Storage: fotos de evolução -----------------------------------------------
-- Bucket privado; caminho dos arquivos é "<cliente_id>/<arquivo>", então as
-- policies conferem o dono do cliente pelo primeiro segmento do path.

insert into storage.buckets (id, name, public)
values ('fotos-evolucao', 'fotos-evolucao', false)
on conflict (id) do nothing;

create policy "trainer lê e gerencia fotos dos seus alunos"
  on storage.objects for all
  using (
    bucket_id = 'fotos-evolucao'
    and exists (
      select 1 from clientes
      where clientes.id::text = (storage.foldername(name))[1]
      and clientes.trainer_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'fotos-evolucao'
    and exists (
      select 1 from clientes
      where clientes.id::text = (storage.foldername(name))[1]
      and clientes.trainer_id = auth.uid()
    )
  );

create policy "aluno lê e envia suas próprias fotos"
  on storage.objects for all
  using (
    bucket_id = 'fotos-evolucao'
    and exists (
      select 1 from clientes
      where clientes.id::text = (storage.foldername(name))[1]
      and clientes.auth_user_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'fotos-evolucao'
    and exists (
      select 1 from clientes
      where clientes.id::text = (storage.foldername(name))[1]
      and clientes.auth_user_id = auth.uid()
    )
  );
