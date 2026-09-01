-- Timer de descanso automático: segundos estruturados pro app do aluno contar
-- regressivamente ao marcar uma série como feita. Continua existindo, sem
-- mudança, o campo de texto livre intervalo_descanso (ex.: "1-2min") — esse
-- aqui é opcional e só alimenta o timer quando o personal quiser um número
-- exato (ex.: 90 segundos). Null = personal não configurou timer.
alter table treino_exercicios add column descanso_segundos int;

comment on column treino_exercicios.descanso_segundos is
  'Segundos de descanso pro timer automático no app do aluno, iniciado ao marcar uma série como feita. Opcional — null significa sem timer (só o texto livre de intervalo_descanso, se houver).';
