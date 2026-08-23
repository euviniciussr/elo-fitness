-- Reformulação do banco de alimentos: `alimentos` passa a ser o modelo
-- normalizado "Food" (fonte App/TBCA/FatSecret), em vez de só a lista
-- manual do treinador. Migration 100% aditiva — nenhuma coluna existente
-- muda, nenhuma linha é reescrita, `taco_alimentos` não é tocada.
--
-- Linhas já existentes em `alimentos` continuam válidas: `source` cai no
-- default 'APP' (é exatamente o que elas já eram — alimentos cadastrados
-- manualmente pelo treinador).

alter table alimentos add column if not exists source text not null default 'APP';
alter table alimentos add column if not exists source_id text;
alter table alimentos add column if not exists brand_name text;
alter table alimentos add column if not exists barcode text;
alter table alimentos add column if not exists other_nutrients jsonb not null default '{}'::jsonb;
alter table alimentos add column if not exists default_unit text not null default 'g';
alter table alimentos add column if not exists measures jsonb not null default '[]'::jsonb;
alter table alimentos add column if not exists updated_at timestamptz not null default now();

alter table alimentos drop constraint if exists alimentos_source_check;
alter table alimentos add constraint alimentos_source_check
  check (source in ('APP', 'TBCA', 'FATSECRET'));

-- Evita duplicar o mesmo produto externo já promovido pra base do treinador
-- (ex.: clicar "adicionar ao banco do app" duas vezes no mesmo resultado).
create unique index if not exists alimentos_trainer_source_source_id_idx
  on alimentos (trainer_id, source, source_id)
  where source_id is not null;

-- Busca por código de barras (Parte 8) é sempre escopada ao treinador, igual
-- ao resto do acervo — não existe biblioteca compartilhada entre treinadores
-- neste app (lição já registrada no projeto).
create index if not exists alimentos_trainer_barcode_idx
  on alimentos (trainer_id, barcode)
  where barcode is not null;

create index if not exists alimentos_trainer_nome_lower_idx
  on alimentos (trainer_id, lower(nome));

comment on column alimentos.source is 'Origem do registro: APP (cadastro manual/promovido), TBCA ou FATSECRET.';
comment on column alimentos.source_id is 'Identificador do alimento na fonte externa (ex.: food_id da FatSecret). Nulo para alimentos 100% manuais.';
comment on column alimentos.measures is 'Lista de medidas convertíveis pra grama/ml: [{"unidade":"unidade","label":"1 unidade","grams":50}, {"unidade":"colher_sopa","label":"1 colher de sopa","grams":15}, ...]. "g" (e "ml" quando líquido) sempre implícitos, não precisam estar na lista.';
comment on column alimentos.other_nutrients is 'Nutrientes além dos 6 campos dedicados (kcal/proteina/carboidrato/gordura/fibra/sodio), ex.: {"acucares_g": 5, "gordura_saturada_g": 2}.';
