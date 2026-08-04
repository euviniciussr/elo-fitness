-- RLS estava liberado só pro trainer (trainer_id = auth.uid()). O aluno logado
-- (clientes.auth_user_id = auth.uid()) não conseguia ler nem a própria linha
-- de cliente, nem seus treinos — por isso "Meu treino" ficava sempre vazio.

create policy "aluno vê seu próprio cadastro de cliente"
  on clientes for select
  using (auth_user_id = auth.uid());

create policy "aluno vê seus próprios treinos"
  on treinos for select
  using (exists (
    select 1 from clientes
    where clientes.id = treinos.cliente_id
    and clientes.auth_user_id = auth.uid()
  ));

create policy "aluno vê os exercícios dos seus treinos"
  on treino_exercicios for select
  using (exists (
    select 1 from treinos
    join clientes on clientes.id = treinos.cliente_id
    where treinos.id = treino_exercicios.treino_id
    and clientes.auth_user_id = auth.uid()
  ));

create policy "aluno vê exercícios usados no seu treino"
  on exercicios for select
  using (exists (
    select 1 from treino_exercicios
    join treinos on treinos.id = treino_exercicios.treino_id
    join clientes on clientes.id = treinos.cliente_id
    where treino_exercicios.exercicio_id = exercicios.id
    and clientes.auth_user_id = auth.uid()
  ));
