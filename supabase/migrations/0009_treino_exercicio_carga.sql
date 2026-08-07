-- Campo de carga (peso) por exercício do treino, separado de "séries"
-- (que já combina séries+repetições, ex: "3x8-10") e do intervalo de
-- descanso. Texto livre pra caber "20kg", "barra livre", "progressivo", etc.

alter table treino_exercicios add column carga text;
