-- Plano permanente grátis (até 5 alunos) — quem não assina depois do
-- trial mas tem 5 alunos ou menos continua usando o app de graça, sem
-- perder dado nenhum. Quem já tem mais de 5 alunos (ou é inadimplente de
-- verdade, já pagava e falhou a cobrança) continua caindo no bloqueio de
-- escrita existente em js/auth-guard.js.
insert into planos_assinatura (nome, valor, limite_alunos) values
  ('Grátis (até 5 alunos)', 0, 5);
