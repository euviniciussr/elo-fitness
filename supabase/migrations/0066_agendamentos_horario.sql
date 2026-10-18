-- Agenda do profissional (agenda.html): agendamentos passam a ter horário e
-- duração. Os dois são opcionais — os lembretes criados até aqui (só data,
-- aba Agendamentos do aluno) continuam válidos como "sem horário".
--
-- hora_inicio é a hora de parede (sem fuso), igual a data_lembrete: o que o
-- profissional escolhe é o que aparece, sem conversão de timezone.

alter table agendamentos add column if not exists hora_inicio time;
alter table agendamentos add column if not exists duracao_minutos integer;

alter table agendamentos drop constraint if exists agendamentos_duracao_valida;
alter table agendamentos add constraint agendamentos_duracao_valida
  check (duracao_minutos is null or (duracao_minutos between 5 and 720));

-- Dois agendamentos do mesmo profissional no mesmo dia e mesma hora de início
-- = clique duplo / envio repetido. A sobreposição parcial é conferida na tela.
create unique index if not exists agendamentos_trainer_inicio_unico
  on agendamentos (trainer_id, data_lembrete, hora_inicio)
  where hora_inicio is not null;
