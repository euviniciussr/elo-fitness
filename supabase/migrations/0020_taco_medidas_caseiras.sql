-- Extensão aditiva da base padrão (taco_alimentos, ~600 itens, fonte "APP")
-- pra suportar medida caseira/unidade, no mesmo formato jsonb já usado por
-- `alimentos`/`tbca_alimentos` (measures + default_unit). Só a base local
-- ganha colunas novas aqui — não mexe em nada da integração TBCA nem
-- FatSecret (arquivos/tabelas separados, intocados por esta migration).
alter table taco_alimentos
  add column if not exists default_unit text not null default 'g',
  add column if not exists measures jsonb not null default '[]'::jsonb;

-- Pesos médios de referência de domínio público (não extraídos de nenhuma
-- base proprietária) pros alimentos mais comuns que normalmente são
-- contados por unidade em vez de pesados, cobrindo os exemplos pedidos
-- (ovo, pão francês, maçã, banana) e variações já existentes na base.
update taco_alimentos set measures = '[{"unidade":"unidade","label":"unidade","grams":50}]'::jsonb
  where id in (488, 489, 490); -- Ovo, de galinha, inteiro (cozido/cru/frito)

update taco_alimentos set measures = '[{"unidade":"unidade","label":"unidade","grams":50}]'::jsonb
  where id = 53; -- Pão, trigo, francês

update taco_alimentos set measures = '[{"unidade":"unidade","label":"unidade","grams":130}]'::jsonb
  where id in (221, 222); -- Maçã, Argentina / Fuji, com casca, crua

update taco_alimentos set measures = '[{"unidade":"unidade","label":"unidade","grams":120}]'::jsonb
  where id = 179; -- Banana, nanica, crua

update taco_alimentos set measures = '[{"unidade":"unidade","label":"unidade","grams":70}]'::jsonb
  where id in (178, 182); -- Banana, maçã / prata, crua

update taco_alimentos set measures = '[{"unidade":"unidade","label":"unidade","grams":150}]'::jsonb
  where id = 175; -- Banana, da terra, crua

update taco_alimentos set measures = '[{"unidade":"unidade","label":"unidade","grams":100}]'::jsonb
  where id = 181; -- Banana, pacova, crua

update taco_alimentos set measures = '[{"unidade":"unidade","label":"unidade","grams":35}]'::jsonb
  where id = 180; -- Banana, ouro, crua

update taco_alimentos set measures = '[{"unidade":"unidade","label":"unidade","grams":30}]'::jsonb
  where id = 177; -- Banana, figo, crua
