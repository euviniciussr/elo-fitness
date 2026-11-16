-- Produtos digitais vendidos pelo profissional (Gestão → Produtos).
--
-- Um produto entrega PDF(s), um treino no app, ou os dois. O treino do
-- produto é uma divisão própria em `treinos` (produto_id preenchido,
-- cliente_id nulo), montada no mesmo editor (montar-treino.html) — não é
-- prescrição de aluno nem treino predefinido, e não muda quando outros
-- treinos mudam. Compradores sempre veem a versão atual do conteúdo do
-- produto (atualização do profissional chega pra quem já comprou, sem
-- mexer em compra nem validade).
--
-- Pagamento: Asaas Checkout (mesma conta/infra da assinatura). Só a Edge
-- Function produto-checkout cria compras e só o asaas-webhook confirma
-- (service_role). Acesso = linha em acessos_produto (uma por comprador e
-- produto); cada pagamento confirmado é uma linha em compras_produto
-- (compra inicial ou renovação) — histórico nunca é apagado.
--
-- Vencimento é checado no banco (tem_acesso_produto) em toda leitura de
-- conteúdo: RPC do treino e policy de storage dos PDFs.

-- ── Produtos ────────────────────────────────────────────────────────────
create table produtos (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  codigo text not null unique default lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  nome text not null check (char_length(trim(nome)) between 1 and 120),
  descricao text not null default '',
  preco numeric(10,2) not null check (preco >= 5),
  entrega_pdf boolean not null default false,
  entrega_treino boolean not null default false,
  permite_download boolean not null default true,
  acesso_tipo text not null default 'ilimitado' check (acesso_tipo in ('ilimitado', 'periodo')),
  acesso_dias int check (acesso_dias is null or acesso_dias between 1 and 3650),
  publicado boolean not null default false,
  arquivado boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint produtos_entrega_check check (entrega_pdf or entrega_treino),
  constraint produtos_periodo_check check (acesso_tipo = 'ilimitado' or acesso_dias is not null)
);
create index produtos_trainer_idx on produtos (trainer_id);

alter table produtos enable row level security;
create policy "trainer gerencia seus produtos" on produtos for all
  using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());

create or replace function public.produtos_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.acesso_tipo = 'ilimitado' then new.acesso_dias := null; end if;
  -- produto arquivado nunca fica à venda
  if new.arquivado then new.publicado := false; end if;
  return new;
end;
$$;
create trigger produtos_touch before insert or update on produtos
  for each row execute function public.produtos_touch();

-- ── Arquivos PDF ────────────────────────────────────────────────────────
create table produto_arquivos (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references produtos(id) on delete cascade,
  trainer_id uuid not null references trainers(id) on delete cascade,
  nome text not null,
  storage_path text not null unique,
  tamanho bigint,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);
create index produto_arquivos_produto_idx on produto_arquivos (produto_id);

alter table produto_arquivos enable row level security;
create policy "trainer gerencia arquivos dos seus produtos" on produto_arquivos for all
  using (trainer_id = auth.uid())
  with check (
    trainer_id = auth.uid()
    and exists (select 1 from produtos p where p.id = produto_id and p.trainer_id = auth.uid())
  );

-- ── Treino do produto ───────────────────────────────────────────────────
alter table treinos add column if not exists produto_id uuid references produtos(id) on delete cascade;
create index if not exists treinos_produto_idx on treinos (produto_id) where produto_id is not null;

-- A RLS de treinos só checa trainer_id; sem isto um profissional poderia
-- pendurar treino dele no produto de outro. Treino de produto nunca é de aluno.
create or replace function public.treinos_produto_dono()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.produto_id is not null then
    if not exists (select 1 from produtos p where p.id = new.produto_id and p.trainer_id = new.trainer_id) then
      raise exception 'Produto inválido para este treino.';
    end if;
    new.cliente_id := null;
    new.habilitado := false;
  end if;
  return new;
end;
$$;
create trigger treinos_produto_dono before insert or update of produto_id, trainer_id, cliente_id on treinos
  for each row execute function public.treinos_produto_dono();

-- ── Compras e acessos ───────────────────────────────────────────────────
create table compras_produto (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references produtos(id) on delete restrict,
  trainer_id uuid not null references trainers(id) on delete cascade,
  comprador_id uuid not null references auth.users(id) on delete cascade,
  comprador_nome text,
  comprador_email text,
  tipo text not null default 'compra' check (tipo in ('compra', 'renovacao')),
  valor numeric(10,2) not null,
  status text not null default 'pendente' check (status in ('pendente', 'pago', 'divergente', 'cancelado')),
  asaas_checkout_id text unique,
  asaas_payment_id text unique,
  pago_em timestamptz,
  acesso_inicio timestamptz,
  acesso_fim timestamptz,
  created_at timestamptz not null default now()
);
create index compras_produto_produto_idx on compras_produto (produto_id);
create index compras_produto_comprador_idx on compras_produto (comprador_id);

alter table compras_produto enable row level security;
create policy "trainer vê compras dos seus produtos" on compras_produto for select
  using (trainer_id = auth.uid());
create policy "comprador vê as próprias compras" on compras_produto for select
  using (comprador_id = auth.uid());
-- Sem insert/update/delete pra usuário: só service_role (Edge Functions).

create table acessos_produto (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references produtos(id) on delete restrict,
  trainer_id uuid not null references trainers(id) on delete cascade,
  comprador_id uuid not null references auth.users(id) on delete cascade,
  inicio timestamptz not null default now(),
  vence_em timestamptz, -- null = ilimitado
  updated_at timestamptz not null default now(),
  unique (produto_id, comprador_id)
);
create index acessos_produto_comprador_idx on acessos_produto (comprador_id);

alter table acessos_produto enable row level security;
create policy "trainer vê acessos dos seus produtos" on acessos_produto for select
  using (trainer_id = auth.uid());
create policy "comprador vê os próprios acessos" on acessos_produto for select
  using (comprador_id = auth.uid());

-- Grants explícitos (o default ACL do projeto já concede, mas escrita do
-- usuário em compras/acessos precisa ser impossível mesmo sem policy).
revoke insert, update, delete on compras_produto from anon, authenticated;
revoke insert, update, delete on acessos_produto from anon, authenticated;

-- ── Checagem de acesso (fonte única) ────────────────────────────────────
create or replace function public.tem_acesso_produto(p_produto uuid)
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from acessos_produto a
    where a.produto_id = p_produto
      and a.comprador_id = auth.uid()
      and (a.vence_em is null or a.vence_em > now())
  ) or exists (
    select 1 from produtos p where p.id = p_produto and p.trainer_id = auth.uid()
  );
$$;
revoke execute on function public.tem_acesso_produto(uuid) from public, anon;
grant execute on function public.tem_acesso_produto(uuid) to authenticated;

-- ── Storage dos PDFs ────────────────────────────────────────────────────
-- Bucket privado: só URL assinada de curta duração, e só gera quem passa
-- na policy abaixo (dono do produto ou comprador com acesso vigente).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('produtos-arquivos', 'produtos-arquivos', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

create policy "trainer gerencia PDFs dos seus produtos"
  on storage.objects for all
  using (bucket_id = 'produtos-arquivos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'produtos-arquivos' and (storage.foldername(name))[1] = auth.uid()::text);

-- security definer: o comprador não enxerga produto_arquivos pela RLS, então
-- a checagem precisa rodar como dono da função.
create or replace function public.pode_ler_arquivo_produto(p_path text)
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from produto_arquivos pa
    where pa.storage_path = p_path and public.tem_acesso_produto(pa.produto_id)
  );
$$;
revoke execute on function public.pode_ler_arquivo_produto(text) from public, anon;
grant execute on function public.pode_ler_arquivo_produto(text) to authenticated;

create policy "comprador com acesso vigente lê PDFs do produto"
  on storage.objects for select
  using (bucket_id = 'produtos-arquivos' and public.pode_ler_arquivo_produto(name));

-- ── Página pública de venda ─────────────────────────────────────────────
create or replace function public.produto_publico(p_codigo text)
returns jsonb
language sql stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'codigo', p.codigo,
    'nome', p.nome,
    'descricao', p.descricao,
    'preco', p.preco,
    'entrega_pdf', p.entrega_pdf,
    'entrega_treino', p.entrega_treino,
    'permite_download', p.permite_download,
    'acesso_tipo', p.acesso_tipo,
    'acesso_dias', p.acesso_dias,
    'profissional', coalesce(nullif(trim(t.nome), ''), 'Profissional Elo'),
    'arquivos', (select count(*) from produto_arquivos pa where pa.produto_id = p.id),
    'divisoes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nome', tr.nome,
        'exercicios', (select count(*) from treino_exercicios te where te.treino_id = tr.id)
      ) order by tr.ordem)
      from treinos tr where tr.produto_id = p.id
    ), '[]'::jsonb)
  )
  from produtos p
  join trainers t on t.id = p.trainer_id
  where p.codigo = lower(trim(p_codigo))
    and p.publicado and not p.arquivado;
$$;
revoke execute on function public.produto_publico(text) from public;
grant execute on function public.produto_publico(text) to anon, authenticated;

-- ── Área do comprador ───────────────────────────────────────────────────
create or replace function public.meus_produtos()
returns jsonb
language sql stable
security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'produto_id', p.id,
    'codigo', p.codigo,
    'nome', p.nome,
    'descricao', p.descricao,
    'preco', p.preco,
    'entrega_pdf', p.entrega_pdf,
    'entrega_treino', p.entrega_treino,
    'acesso_tipo', p.acesso_tipo,
    'acesso_dias', p.acesso_dias,
    'a_venda', p.publicado and not p.arquivado,
    'profissional', coalesce(nullif(trim(t.nome), ''), 'Profissional Elo'),
    'inicio', a.inicio,
    'vence_em', a.vence_em,
    'ativo', (a.vence_em is null or a.vence_em > now())
  ) order by a.updated_at desc), '[]'::jsonb)
  from acessos_produto a
  join produtos p on p.id = a.produto_id
  join trainers t on t.id = p.trainer_id
  where a.comprador_id = auth.uid();
$$;
revoke execute on function public.meus_produtos() from public, anon;
grant execute on function public.meus_produtos() to authenticated;

-- Conteúdo protegido: só com acesso vigente (ou dono, pra pré-visualizar).
create or replace function public.conteudo_produto(p_produto uuid)
returns jsonb
language plpgsql stable
security definer set search_path = public
as $$
declare
  v_prod produtos;
begin
  select * into v_prod from produtos where id = p_produto;
  if not found then raise exception 'Produto não encontrado.'; end if;
  if not public.tem_acesso_produto(p_produto) then
    raise exception 'acesso_expirado' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'id', v_prod.id,
    'nome', v_prod.nome,
    'descricao', v_prod.descricao,
    'permite_download', v_prod.permite_download,
    'entrega_pdf', v_prod.entrega_pdf,
    'entrega_treino', v_prod.entrega_treino,
    'arquivos', coalesce((
      select jsonb_agg(jsonb_build_object('id', pa.id, 'nome', pa.nome, 'path', pa.storage_path, 'tamanho', pa.tamanho)
        order by pa.ordem, pa.created_at)
      from produto_arquivos pa where pa.produto_id = v_prod.id
    ), '[]'::jsonb),
    'treinos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tr.id,
        'nome', tr.nome,
        'exercicios', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', te.id,
            'nome', coalesce(ep.nome, e.nome),
            'categoria', coalesce(ep.categoria, e.categoria),
            'video_url', coalesce(ep.video_url, e.video_url),
            'series', te.series,
            'series_aquecimento', te.series_aquecimento,
            'intervalo_descanso', te.intervalo_descanso,
            'descanso_segundos', te.descanso_segundos,
            'observacoes', te.observacoes,
            'grupo_id', te.grupo_id,
            'tecnica_nome', ta.nome,
            'tecnica_obs', ta.observacao
          ) order by te.ordem, te.created_at, te.id)
          from treino_exercicios te
          join exercicios e on e.id = te.exercicio_id
          left join exercicio_personalizacoes ep on ep.exercicio_id = e.id and ep.trainer_id = v_prod.trainer_id
          left join tecnicas_avancadas ta on te.tecnica_avancada <> 'nenhuma' and ta.id::text = te.tecnica_avancada
          where te.treino_id = tr.id
        ), '[]'::jsonb)
      ) order by tr.ordem)
      from treinos tr where tr.produto_id = v_prod.id
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.conteudo_produto(uuid) from public, anon;
grant execute on function public.conteudo_produto(uuid) to authenticated;

-- ── Confirmação do pagamento (só service_role / webhook) ────────────────
-- Idempotente: notificações repetidas (PAYMENT_CONFIRMED + PAYMENT_RECEIVED
-- + CHECKOUT_PAID do mesmo pagamento) só liberam uma vez. Renovação soma o
-- período a partir do vencimento atual se ainda vigente, senão de agora.
create or replace function public.confirmar_compra_produto(
  p_compra uuid, p_payment_id text default null, p_valor numeric default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_compra compras_produto;
  v_prod produtos;
  v_acesso acessos_produto;
  v_base timestamptz;
  v_vence timestamptz;
begin
  select * into v_compra from compras_produto where id = p_compra for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'compra_inexistente'); end if;
  if v_compra.status = 'pago' then return jsonb_build_object('ok', true, 'repetido', true); end if;

  if p_payment_id is not null and exists (
    select 1 from compras_produto where asaas_payment_id = p_payment_id and id <> p_compra
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'pagamento_ja_usado');
  end if;

  if p_valor is not null and p_valor + 0.01 < v_compra.valor then
    update compras_produto set status = 'divergente', asaas_payment_id = coalesce(p_payment_id, asaas_payment_id)
      where id = p_compra;
    return jsonb_build_object('ok', false, 'motivo', 'valor_divergente');
  end if;

  select * into v_prod from produtos where id = v_compra.produto_id;
  select * into v_acesso from acessos_produto
    where produto_id = v_compra.produto_id and comprador_id = v_compra.comprador_id for update;

  if v_prod.acesso_tipo = 'ilimitado' or (found and v_acesso.vence_em is null) then
    v_vence := null;
  else
    v_base := case when found and v_acesso.vence_em > now() then v_acesso.vence_em else now() end;
    v_vence := v_base + make_interval(days => v_prod.acesso_dias);
  end if;

  if v_acesso.id is null then
    insert into acessos_produto (produto_id, trainer_id, comprador_id, inicio, vence_em)
    values (v_compra.produto_id, v_compra.trainer_id, v_compra.comprador_id, now(), v_vence)
    on conflict (produto_id, comprador_id) do update set vence_em = excluded.vence_em, updated_at = now();
  else
    update acessos_produto set
      inicio = case when vence_em is not null and vence_em <= now() then now() else inicio end,
      vence_em = v_vence, updated_at = now()
    where id = v_acesso.id;
  end if;

  update compras_produto set
    status = 'pago',
    asaas_payment_id = coalesce(p_payment_id, asaas_payment_id),
    pago_em = now(),
    acesso_inicio = coalesce(case when v_acesso.vence_em > now() then v_acesso.vence_em end, now()),
    acesso_fim = v_vence
  where id = p_compra;

  return jsonb_build_object('ok', true, 'vence_em', v_vence);
end;
$$;
revoke execute on function public.confirmar_compra_produto(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.confirmar_compra_produto(uuid, text, numeric) to service_role;
