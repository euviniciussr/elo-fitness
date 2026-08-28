-- Permite ao trainer sobrescrever, só para esta prescrição específica, a
-- explicação de uma técnica avançada reutilizável (tecnicas_avancadas.observacao
-- continua sendo o texto padrão/fallback quando nenhuma sobrescrita é dada).
-- Aditivo: nenhuma coluna existente muda, nenhuma linha é reescrita.

alter table treino_exercicios add column if not exists tecnica_instrucoes text;

comment on column treino_exercicios.tecnica_instrucoes is
  'Explicação da técnica avançada específica desta prescrição. Quando nulo, o app usa tecnicas_avancadas.observacao (texto padrão do trainer para essa técnica) como fallback.';
