-- O card "Seu personal" em app-aluno.html precisa do nome do trainer, mas não
-- havia nenhuma policy de select em `trainers` pro aluno — a query sempre
-- voltava vazia (RLS nega por padrão), então o nome nunca aparecia.
create policy "aluno vê o nome do próprio trainer"
  on trainers for select
  using (exists (
    select 1 from clientes
    where clientes.trainer_id = trainers.id
    and clientes.auth_user_id = auth.uid()
  ));
