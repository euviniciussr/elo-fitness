-- Separa séries de aquecimento das séries válidas por exercício prescrito.
-- `series` passa a representar exclusivamente as séries válidas (contam pra
-- volume de treinamento); `series_aquecimento` é um campo novo, opcional,
-- com o mesmo formato (texto livre, 1 linha = 1 série) usado só de referência
-- pro aluno — nunca entra no cálculo de volume por grupamento muscular.
-- Aditivo: nenhuma coluna existente muda, nenhuma linha é reescrita.

alter table treino_exercicios add column if not exists series_aquecimento text;

comment on column treino_exercicios.series_aquecimento is
  'Séries de aquecimento desta prescrição (texto livre, 1 linha = 1 série). Opcional. NÃO conta no volume de séries por grupamento muscular — apenas treino_exercicios.series (séries válidas) conta.';

comment on column treino_exercicios.series is
  'Séries válidas desta prescrição (texto livre, 1 linha = 1 série). São as que contam no volume de treinamento por grupamento muscular.';
