-- Foto opcional que o aluno pode anexar ao finalizar um treino (ex: foto do
-- espelho, do resultado do dia etc). Guardada no mesmo bucket privado
-- fotos-evolucao já usado pelas outras fotos do app; aqui só referenciamos o
-- caminho (não é obrigatória — o aluno pode finalizar o treino sem foto).
alter table treino_execucoes add column foto_url text;

comment on column treino_execucoes.foto_url is
  'Caminho no bucket fotos-evolucao da foto opcional tirada pelo aluno ao finalizar o treino naquele dia. Nulo = não anexou foto.';
