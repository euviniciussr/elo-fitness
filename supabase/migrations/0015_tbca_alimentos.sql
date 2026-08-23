-- Base de referência TBCA (Tabela Brasileira de Composição de Alimentos,
-- USP). Mesmo padrão de `taco_alimentos` (global, somente leitura,
-- read-only pra todo usuário autenticado) — mas criada VAZIA.
--
-- TBCA não tem API pública oficial e tem termos de uso próprios. Antes de
-- importar qualquer linha aqui é preciso validar a licença/termos com a
-- fonte oficial (https://www.tbca.net.br/). Esta tabela só existe pra
-- FoodProviderTBCA já ter onde ler assim que houver dado permitido —
-- nenhum dado é inserido por esta migration.

create table if not exists tbca_alimentos (
  id serial primary key,
  source_id text unique,
  nome text not null,
  categoria text,
  kcal numeric,
  proteina_g numeric,
  carboidrato_g numeric,
  gordura_g numeric,
  fibra_g numeric,
  sodio_mg numeric,
  other_nutrients jsonb not null default '{}'::jsonb,
  default_unit text not null default 'g',
  measures jsonb not null default '[]'::jsonb
);

alter table tbca_alimentos enable row level security;

drop policy if exists "qualquer usuário autenticado pode ler a base TBCA" on tbca_alimentos;
create policy "qualquer usuário autenticado pode ler a base TBCA"
  on tbca_alimentos for select
  using (true);

grant select on tbca_alimentos to authenticated;

create index if not exists tbca_alimentos_nome_lower_idx on tbca_alimentos (lower(nome));
