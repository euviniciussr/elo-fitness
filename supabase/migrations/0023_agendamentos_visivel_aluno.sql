-- A aba "Agenda" e o card "Próxima sessão" em app-aluno.html precisam que o
-- aluno leia seus próprios agendamentos, mas só havia policy pro trainer.
create policy "aluno vê seus próprios agendamentos"
  on agendamentos for select
  using (exists (
    select 1 from clientes
    where clientes.id = agendamentos.cliente_id
    and clientes.auth_user_id = auth.uid()
  ));
