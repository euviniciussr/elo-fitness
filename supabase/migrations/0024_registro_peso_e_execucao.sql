-- "Registro de hoje" (peso) e "dias seguidos"/"treinos na semana" no app do
-- aluno eram só decoração — nada disso era persistido. Duas tabelas novas:
-- uma pro histórico de peso, outra pra marcar quando o aluno conclui um
-- treino (base pra calcular streak e adesão semanal de verdade).

create table registros_peso (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  trainer_id uuid not null references trainers(id) on delete cascade,
  peso numeric not null,
  data date not null default current_date,
  created_at timestamptz not null default now(),
  unique (cliente_id, data)
);

alter table registros_peso enable row level security;

create policy "aluno gerencia seus próprios registros de peso"
  on registros_peso for all
  using (exists (select 1 from clientes where clientes.id = registros_peso.cliente_id and clientes.auth_user_id = auth.uid()))
  with check (exists (select 1 from clientes where clientes.id = registros_peso.cliente_id and clientes.auth_user_id = auth.uid()));

create policy "trainer vê registros de peso dos seus alunos"
  on registros_peso for select
  using (trainer_id = auth.uid());

create table treino_execucoes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  trainer_id uuid not null references trainers(id) on delete cascade,
  treino_id uuid references treinos(id) on delete set null,
  data date not null default current_date,
  created_at timestamptz not null default now(),
  unique (cliente_id, data)
);

alter table treino_execucoes enable row level security;

create policy "aluno gerencia suas próprias execuções de treino"
  on treino_execucoes for all
  using (exists (select 1 from clientes where clientes.id = treino_execucoes.cliente_id and clientes.auth_user_id = auth.uid()))
  with check (exists (select 1 from clientes where clientes.id = treino_execucoes.cliente_id and clientes.auth_user_id = auth.uid()));

create policy "trainer vê execuções de treino dos seus alunos"
  on treino_execucoes for select
  using (trainer_id = auth.uid());

-- "Confirmar" sessão na Agenda do aluno: não existia campo nenhum de
-- confirmação (só `concluido`, que é outra coisa — marcado pelo trainer
-- depois que a sessão já aconteceu). RPC security definer em vez de policy
-- de update aberta, pra aluno não poder alterar título/data da sessão.
alter table agendamentos add column confirmado boolean not null default false;

create or replace function public.confirmar_agendamento(p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update agendamentos
    set confirmado = true
    where id = p_id
    and cliente_id in (select id from clientes where auth_user_id = auth.uid());
end;
$$;

grant execute on function public.confirmar_agendamento(uuid) to authenticated;
