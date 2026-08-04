-- Suporte a "divisão de treino" (Treino A/B/C/D criados juntos como um grupo).
-- split_id agrupa treinos criados na mesma divisão; ordem controla a sequência
-- de exibição (A, B, C...). Ambos nullable — treinos avulsos continuam válidos.

alter table treinos add column split_id uuid;
alter table treinos add column ordem int not null default 0;

create index treinos_split_id_idx on treinos (split_id);
