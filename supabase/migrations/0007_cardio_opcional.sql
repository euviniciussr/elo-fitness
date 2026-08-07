-- Campo de cardio opcional (atividades extras/pontuais, distintas do cardio
-- principal): ex. cardio mais intenso num dia específico, treino
-- complementar, caminhada extra, protocolo de fim de semana.

alter table cardio_protocolos add column cardio_opcional text;
