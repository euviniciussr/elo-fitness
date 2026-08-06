-- Suporte a "exercício combinado" (bi-set / super-set / rest-pause agrupando
-- 2+ exercícios que o aluno faz em sequência, sem descanso entre eles).
-- grupo_id agrupa as linhas de treino_exercicios que pertencem ao mesmo combo.
-- Nullable — exercícios avulsos continuam sem grupo.

alter table treino_exercicios add column grupo_id uuid;

create index treino_exercicios_grupo_id_idx on treino_exercicios (grupo_id);
