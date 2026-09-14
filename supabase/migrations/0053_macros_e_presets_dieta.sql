-- Macros automáticos na dieta (proteína/gordura/carboidrato calculados a
-- partir da meta calórica) + biblioteca global de presets de refeição
-- (alimento principal + substituíveis reutilizável entre profissionais).
-- Só adiciona — nenhuma coluna/tabela existente é alterada.

alter table dietas
  add column proteina_g numeric,
  add column gordura_g numeric,
  add column carboidrato_g numeric;

-- estrutura: { principal: {food_source, food_source_id, nome, quantidade, unidade},
--              substituiveis: [{food_source, food_source_id, nome, quantidade, unidade}, ...] }
-- Guarda só a referência do alimento + quantidade — nunca kcal/macros
-- prontos, pra sempre recalcular com o mecanismo nutricional atual
-- (TBCA/FatSecret/base própria) quando o preset for aplicado.
create table dieta_presets (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  nome text not null,
  categoria text,
  estrutura jsonb not null,
  created_at timestamptz not null default now()
);

alter table dieta_presets enable row level security;

-- Biblioteca global: qualquer profissional autenticado pode ler qualquer
-- preset (item 14 do pedido).
create policy "qualquer trainer le a biblioteca global de presets"
  on dieta_presets for select
  using (exists (select 1 from trainers where trainers.id = auth.uid()));

-- Só o criador pode editar/excluir o próprio preset (item 20) — ninguém
-- altera silenciosamente o preset de outro profissional. trainer_id fica
-- pronto pra, no futuro, virar preset privado só ajustando a policy de
-- select acima, sem mudar a estrutura da tabela.
create policy "trainer cria seus proprios presets"
  on dieta_presets for insert
  with check (trainer_id = auth.uid());

create policy "trainer edita e exclui seus proprios presets"
  on dieta_presets for update
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

create policy "trainer exclui seus proprios presets"
  on dieta_presets for delete
  using (trainer_id = auth.uid());

grant select, insert, update, delete on dieta_presets to authenticated;
