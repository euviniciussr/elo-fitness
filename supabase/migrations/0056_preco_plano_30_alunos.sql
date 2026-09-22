-- Preço oficial do plano "Até 30 alunos" passou de 59.90 pra 49.90. Já
-- tinha sido alterado direto no banco; esta migration só registra.
update planos_assinatura set valor = 49.90 where nome = 'Até 30 alunos';
