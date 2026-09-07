-- Assinatura paga do profissional pra usar o Elo Fitness. Trial de 14 dias
-- + 3 dias de aviso, depois bloqueia ações de escrita (feito na UI, ver
-- js/auth-guard.js — nenhuma RLS muda aqui). Ver design completo em
-- docs/superpowers/specs/2026-09-07-assinatura-asaas-design.md.

-- Planos por faixa de alunos — preço/limite editável por UPDATE, sem deploy.
create table planos_assinatura (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  valor numeric not null,
  limite_alunos int, -- null = sem limite (plano Ilimitado)
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table planos_assinatura enable row level security;
create policy "qualquer trainer autenticado lê os planos" on planos_assinatura for select
  using (auth.uid() is not null);

insert into planos_assinatura (nome, valor, limite_alunos) values
  ('Até 30 alunos', 59.90, 30),
  ('Ilimitado', 99.90, null);

-- Colunas de assinatura em trainers (tudo nullable/com default seguro).
alter table trainers
  add column status_assinatura text not null default 'trial'
    check (status_assinatura in ('trial', 'ativo', 'inadimplente', 'isento')),
  add column trial_termina_em date,
  add column assinatura_valida_ate date,
  add column asaas_customer_id text,
  add column asaas_subscription_id text,
  add column cpf_cnpj text,
  add column plano_id uuid references planos_assinatura(id);

-- Backfill: profissionais que já existem antes desta migration ganham um
-- trial contado a partir do cadastro deles (não a partir de hoje), pra não
-- puni-los por uma feature nova.
update trainers set trial_termina_em = created_at::date + 14 where trial_termina_em is null;

-- Savera fica isenta pra sempre.
update trainers set status_assinatura = 'isento' where id = 'b938902d-4a00-4b07-9666-00bc183b90a4';

-- Trainer novo já nasce em trial de 14 dias (troca a função existente,
-- criada na migration 0001_init.sql).
create or replace function public.handle_new_trainer()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.trainers (id, nome, email, status_assinatura, trial_termina_em)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', ''), new.email, 'trial', current_date + 14);
  return new;
end;
$$;

-- Histórico de cobranças do Asaas — separado de `pagamentos` (que é o
-- profissional recebendo do PRÓPRIO aluno, não relacionado a isso).
create table assinatura_pagamentos (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  asaas_payment_id text not null unique,
  valor numeric not null,
  status text not null,
  data_pagamento date,
  created_at timestamptz not null default now()
);
alter table assinatura_pagamentos enable row level security;
create policy "trainer vê seu próprio histórico de cobrança" on assinatura_pagamentos for select
  using (trainer_id = auth.uid());
-- Sem policy de insert/update pra usuário comum — só service_role (Edge Function) escreve.

-- Trava as 6 colunas de billing: a policy "trainer vê e edita seu próprio
-- perfil" (migration 0001) permite `for all` na própria linha, o que
-- deixaria qualquer trainer se auto-declarar 'isento'/'ativo' direto do
-- browser. Este trigger reverte essas colunas pro valor antigo sempre que
-- quem está editando é o próprio usuário via PostgREST (role anon/
-- authenticated) — chamadas feitas pelas Edge Functions com a service role
-- key passam direto (auth.role() = 'service_role'), e uma sessão SQL direta
-- (psql/CLI, sem JWT) também passa direto (auth.role() is null).
create or replace function public.lock_trainer_billing_fields()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.role() in ('authenticated', 'anon') then
    new.status_assinatura := old.status_assinatura;
    new.trial_termina_em := old.trial_termina_em;
    new.assinatura_valida_ate := old.assinatura_valida_ate;
    new.asaas_customer_id := old.asaas_customer_id;
    new.asaas_subscription_id := old.asaas_subscription_id;
    new.plano_id := old.plano_id;
  end if;
  return new;
end;
$$;

create trigger on_trainer_billing_lock
  before update on trainers
  for each row execute function public.lock_trainer_billing_fields();
