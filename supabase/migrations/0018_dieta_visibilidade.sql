-- Dieta não tinha o mesmo controle de visibilidade que treinos.habilitado —
-- toda dieta com cliente_id ficava lida pelo aluno assim que existisse (a
-- policy "aluno vê as dietas atribuídas a ele" não checava nenhum status).
-- Além disso app-aluno.html nunca chegou a consultar `dietas` de verdade (a
-- aba "Minha dieta" era um placeholder estático) — corrigido à parte no
-- frontend. Esta migration só resolve o lado do banco: dá ao treinador o
-- mesmo botão liga/desliga que já existe pra treino.

alter table dietas add column if not exists habilitado boolean not null default true;

drop policy if exists "aluno vê as dietas atribuídas a ele" on dietas;

create policy "aluno vê as dietas atribuídas a ele"
  on dietas for select
  using (
    habilitado = true
    and exists (
      select 1 from clientes
      where clientes.id = dietas.cliente_id
      and clientes.auth_user_id = auth.uid()
    )
  );
