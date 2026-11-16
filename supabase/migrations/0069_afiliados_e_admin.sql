-- Programa de afiliados + leitura do admin pras telas novas do painel.
--
-- Fluxo: link app.elofitness.com.br/r/<codigo> (indicacao.html) registra o
-- clique e guarda o código no navegador → quando o profissional entra no
-- painel dele pela primeira vez (auth-guard.js), vincular_afiliado() grava
-- trainers.afiliado_id (só uma vez, só em conta nova) → cada cobrança de
-- assinatura confirmada pelo Asaas (asaas-webhook) gera uma comissão
-- idempotente → o admin marca como paga no painel.

-- ── Afiliados ───────────────────────────────────────────────────────────
create table afiliados (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(trim(nome)) between 1 and 120),
  email text,
  codigo text not null unique check (codigo ~ '^[a-z0-9-]{3,40}$'),
  comissao_pct numeric(5,2) not null default 20 check (comissao_pct > 0 and comissao_pct <= 100),
  comissao_meses int check (comissao_meses is null or comissao_meses between 1 and 120), -- null = recorrente enquanto pagar
  chave_pix text,
  observacoes text,
  ativo boolean not null default true,
  -- Conta Elo da pessoa (personal ou aluno) quando ela já tem cadastro.
  -- Opcional: afiliado de fora da plataforma fica só com nome/e-mail.
  user_id uuid unique references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table afiliados enable row level security;
create policy "admin gerencia afiliados" on afiliados for all
  using (public.is_admin()) with check (public.is_admin());

create table afiliado_cliques (
  id uuid primary key default gen_random_uuid(),
  afiliado_id uuid not null references afiliados(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index afiliado_cliques_afiliado_idx on afiliado_cliques (afiliado_id, created_at);
alter table afiliado_cliques enable row level security;
create policy "admin lê cliques" on afiliado_cliques for select using (public.is_admin());

-- ── Vínculo do profissional indicado ────────────────────────────────────
alter table trainers
  add column if not exists afiliado_id uuid references afiliados(id) on delete set null,
  add column if not exists afiliado_vinculado_em timestamptz;

-- A policy de trainers deixa o profissional editar a própria linha inteira;
-- sem esta trava ele poderia trocar/inventar o afiliado depois. Só passa
-- quando a mudança vem de vincular_afiliado() (flag de transação) ou de
-- service_role / SQL direto.
create or replace function public.lock_trainer_afiliado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() in ('authenticated', 'anon')
     and coalesce(current_setting('elo.vinculando_afiliado', true), '') <> '1' then
    new.afiliado_id := old.afiliado_id;
    new.afiliado_vinculado_em := old.afiliado_vinculado_em;
  end if;
  return new;
end;
$$;
create trigger on_trainer_afiliado_lock before update on trainers
  for each row execute function public.lock_trainer_afiliado();

-- Clique no link (anônimo). Devolve se o código existe e está ativo.
create or replace function public.registrar_clique_afiliado(p_codigo text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from afiliados where codigo = lower(trim(p_codigo)) and ativo;
  if v_id is null then return false; end if;
  insert into afiliado_cliques (afiliado_id) values (v_id);
  return true;
end;
$$;
revoke execute on function public.registrar_clique_afiliado(text) from public;
grant execute on function public.registrar_clique_afiliado(text) to anon, authenticated;

-- Vincula o profissional logado ao afiliado. Regras: só uma vez; só conta
-- criada há no máximo 30 dias (indicação é pra cadastro novo); afiliado
-- ativo; ninguém se indica com o próprio e-mail.
create or replace function public.vincular_afiliado(p_codigo text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_tr trainers;
  v_af afiliados;
begin
  select * into v_tr from trainers where id = auth.uid();
  if not found then return 'sem_cadastro_personal'; end if;
  if v_tr.afiliado_id is not null then return 'ja_vinculado'; end if;
  if v_tr.created_at < now() - interval '30 days' then return 'conta_antiga'; end if;
  select * into v_af from afiliados where codigo = lower(trim(p_codigo)) and ativo;
  if not found then return 'codigo_invalido'; end if;
  if v_af.user_id = v_tr.id or (v_af.email is not null and lower(v_af.email) = lower(v_tr.email)) then return 'autoindicacao'; end if;
  perform set_config('elo.vinculando_afiliado', '1', true);
  update trainers set afiliado_id = v_af.id, afiliado_vinculado_em = now() where id = v_tr.id;
  perform set_config('elo.vinculando_afiliado', '', true);
  return 'ok';
end;
$$;
revoke execute on function public.vincular_afiliado(text) from public, anon;
grant execute on function public.vincular_afiliado(text) to authenticated;

-- ── Comissões ───────────────────────────────────────────────────────────
create table comissoes_afiliado (
  id uuid primary key default gen_random_uuid(),
  afiliado_id uuid not null references afiliados(id) on delete cascade,
  trainer_id uuid not null references trainers(id) on delete cascade,
  assinatura_pagamento_id uuid not null unique references assinatura_pagamentos(id) on delete cascade,
  valor_base numeric(10,2) not null,
  pct numeric(5,2) not null,
  valor numeric(10,2) not null,
  status text not null default 'a_pagar' check (status in ('a_pagar', 'pago', 'cancelado')),
  pago_em timestamptz,
  created_at timestamptz not null default now()
);
create index comissoes_afiliado_afiliado_idx on comissoes_afiliado (afiliado_id, status);
alter table comissoes_afiliado enable row level security;
create policy "admin gerencia comissões" on comissoes_afiliado for all
  using (public.is_admin()) with check (public.is_admin());

-- Chamado pelo asaas-webhook depois de gravar o pagamento confirmado.
-- Idempotente (unique por pagamento). Respeita o limite de meses do afiliado.
create or replace function public.registrar_comissao_afiliado(p_asaas_payment_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pag assinatura_pagamentos;
  v_af afiliados;
  v_qtd int;
  v_id uuid;
begin
  select * into v_pag from assinatura_pagamentos where asaas_payment_id = p_asaas_payment_id;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'pagamento_inexistente'); end if;
  select a.* into v_af from trainers t join afiliados a on a.id = t.afiliado_id
    where t.id = v_pag.trainer_id and a.ativo;
  if not found then return jsonb_build_object('ok', true, 'comissao', false); end if;
  if coalesce(v_pag.valor, 0) <= 0 then return jsonb_build_object('ok', true, 'comissao', false); end if;
  if v_af.comissao_meses is not null then
    select count(*) into v_qtd from comissoes_afiliado
      where trainer_id = v_pag.trainer_id and afiliado_id = v_af.id and status <> 'cancelado';
    if v_qtd >= v_af.comissao_meses then return jsonb_build_object('ok', true, 'comissao', false, 'motivo', 'limite_meses'); end if;
  end if;
  insert into comissoes_afiliado (afiliado_id, trainer_id, assinatura_pagamento_id, valor_base, pct, valor)
  values (v_af.id, v_pag.trainer_id, v_pag.id, v_pag.valor, v_af.comissao_pct, round(v_pag.valor * v_af.comissao_pct / 100, 2))
  on conflict (assinatura_pagamento_id) do nothing
  returning id into v_id;
  return jsonb_build_object('ok', true, 'comissao', v_id is not null);
end;
$$;
revoke execute on function public.registrar_comissao_afiliado(text) from public, anon, authenticated;
grant execute on function public.registrar_comissao_afiliado(text) to service_role;

-- ── Busca de contas pra vincular afiliado (só admin) ────────────────────
-- Personal (trainers) e aluno (contas_aluno ou vínculo em clientes), com o
-- e-mail de login vindo de auth.users.
create or replace function public.admin_buscar_contas(p_busca text)
returns table (user_id uuid, nome text, email text, personal boolean, aluno boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_q text := '%' || lower(trim(coalesce(p_busca, ''))) || '%';
begin
  if not public.is_admin() then raise exception 'Apenas admin.' using errcode = '42501'; end if;
  return query
    select u.id,
      coalesce(nullif(trim(t.nome), ''), nullif(trim(ca.nome), ''), nullif(trim(u.raw_user_meta_data->>'nome'), ''),
               (select c.nome from clientes c where c.auth_user_id = u.id limit 1)),
      u.email::text,
      t.id is not null,
      ca.user_id is not null or exists (select 1 from clientes c where c.auth_user_id = u.id)
    from auth.users u
    left join trainers t on t.id = u.id
    left join contas_aluno ca on ca.user_id = u.id
    where length(trim(coalesce(p_busca, ''))) >= 2
      and not exists (select 1 from admins a where a.id = u.id)
      and (lower(u.email) like v_q or lower(coalesce(t.nome, ca.nome, u.raw_user_meta_data->>'nome', '')) like v_q)
    order by u.email
    limit 15;
end;
$$;
revoke execute on function public.admin_buscar_contas(text) from public, anon;
grant execute on function public.admin_buscar_contas(text) to authenticated;

-- ── Leitura do admin pras telas Receita e Operação ──────────────────────
create policy "admin lê todos os produtos" on produtos for select using (public.is_admin());
create policy "admin lê todas as compras de produto" on compras_produto for select using (public.is_admin());
create policy "admin lê todas as importações de treino" on importacoes_treino for select using (public.is_admin());
