-- painel-adm.html precisa enxergar TODOS os trainers/alunos/treinos/etc,
-- não só a própria linha — e nenhuma policy hoje permite isso pra quem não
-- é o dono da linha. Sem isso o painel roda (admin check da migration 0039
-- passa), mas toda query volta vazia porque a RLS "trainer vê só o seu"
-- barra o admin igual barraria qualquer estranho. Usa `is_admin()` (security
-- definer, evita recursão de RLS na própria tabela `admins`) checada em cada
-- policy nova.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from admins where id = auth.uid());
$$;

create policy "admin lê todos os trainers" on trainers for select
  using (public.is_admin());

create policy "admin lê todos os clientes" on clientes for select
  using (public.is_admin());

create policy "admin lê todos os treinos" on treinos for select
  using (public.is_admin());

create policy "admin lê todos os agendamentos" on agendamentos for select
  using (public.is_admin());

create policy "admin lê todos os pagamentos" on pagamentos for select
  using (public.is_admin());

create policy "admin lê todo o histórico de cobrança" on assinatura_pagamentos for select
  using (public.is_admin());
