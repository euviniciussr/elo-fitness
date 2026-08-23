-- Favoritos e recentes (Partes 20/21) — não existia nenhum padrão de
-- "favoritar"/"usado recentemente" no projeto até agora. Guarda uma
-- referência opcional a `alimentos.id` (quando o item já foi promovido pra
-- base do treinador) + um snapshot leve (nome/macros) pra favoritar/
-- registrar uso de um resultado ainda não promovido (ex.: um produto
-- FatSecret que o treinador só quer favoritar, sem "importar").
--
-- `source_id` é SEMPRE preenchido pela aplicação (pra TBCA/FATSECRET é o
-- id na fonte; pra APP é o próprio `alimentos.id` em texto) — isso mantém
-- a identidade do item num único índice único simples, upsertável direto
-- via `supabaseClient...upsert(payload, {onConflict:'trainer_id,source,source_id'})`
-- sem precisar de índice parcial/expressão (que o upsert do supabase-js
-- não consegue casar).
--
-- RLS/GRANT no mesmo padrão trainer-scoped do resto do schema.

create table if not exists food_favoritos (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  alimento_id uuid references alimentos(id) on delete cascade,
  source text not null,
  source_id text not null,
  nome text not null,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists food_recentes (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  alimento_id uuid references alimentos(id) on delete cascade,
  source text not null,
  source_id text not null,
  nome text not null,
  snapshot jsonb not null default '{}'::jsonb,
  used_at timestamptz not null default now()
);

alter table food_favoritos enable row level security;
alter table food_recentes enable row level security;

drop policy if exists "trainer vê e edita seus favoritos" on food_favoritos;
create policy "trainer vê e edita seus favoritos"
  on food_favoritos for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

drop policy if exists "trainer vê e edita seus recentes" on food_recentes;
create policy "trainer vê e edita seus recentes"
  on food_recentes for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

grant select, insert, update, delete on food_favoritos, food_recentes to authenticated;

-- Um favorito por (treinador, fonte, item) — clicar ⭐ de novo não duplica.
create unique index if not exists food_favoritos_trainer_source_idx
  on food_favoritos (trainer_id, source, source_id);

-- Idem pra recentes: reusar o item só atualiza `used_at` (upsert), não
-- empilha linha nova a cada uso.
create unique index if not exists food_recentes_trainer_source_idx
  on food_recentes (trainer_id, source, source_id);

create index if not exists food_recentes_trainer_used_at_idx
  on food_recentes (trainer_id, used_at desc);
