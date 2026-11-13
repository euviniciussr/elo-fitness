-- Gestão do plano do aluno (vigência, histórico e bloqueio de acesso).
--
-- Causa do problema: o plano do aluno (clientes.plano, plano_data_inicio,
-- plano_data_expiracao — 0001/0011) só era gravado no cadastro manual
-- (adicionar-aluno.html). O perfil do aluno não tinha onde editar, aluno
-- que entrou por convite nunca tinha plano, e a data de vencimento não
-- controlava nada.
--
-- Reaproveita as colunas que já existem em clientes como "plano vigente"
-- (nenhum cadastro novo, nada duplicado) e acrescenta:
-- 1) clientes.plano_status ('ativo' | 'cancelado'). Ativo/próximo do
--    vencimento/expirado são derivados da data (plano_situacao()).
-- 2) cliente_planos_historico: cada mudança de plano/vigência/status vira
--    uma linha (append-only), gravada por trigger — vale pra qualquer tela
--    que altere o plano, não só a do perfil.
-- 3) salvar_plano_aluno(): RPC usada pelo perfil do aluno (respeita RLS:
--    profissional só altera aluno dele).
-- 4) Bloqueio no backend: policies RESTRICTIVE (mesmo padrão do onboarding,
--    0057). Plano expirado ou cancelado => aluno não lê nem grava treino,
--    dieta, cardio, avaliações e execuções. Continua com acesso ao próprio
--    cadastro, mensagens com o personal, notificações e histórico de
--    evolução. Aluno sem plano ou sem data de vencimento NÃO é bloqueado
--    (preserva quem já usa o app hoje sem vigência definida).
-- 5) gerar_avisos_vencimento_plano(): avisa o profissional (notificacoes)
--    quando o plano de um aluno está a 7 dias ou menos de vencer e quando
--    vence. Idempotente: um aviso por situação/vencimento.

-- ---------------------------------------------------------------------------
-- Helpers de data/situação
-- ---------------------------------------------------------------------------
create or replace function public.hoje_br()
returns date
language sql
stable
as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- 'sem_plano' | 'ativo' | 'proximo_vencimento' | 'expirado' | 'cancelado'
-- O vencimento é o último dia de acesso (vence no fim do dia).
create or replace function public.plano_situacao(p_plano text, p_status text, p_vencimento date)
returns text
language sql
stable
as $$
  select case
    when p_status = 'cancelado' then 'cancelado'
    when nullif(trim(coalesce(p_plano, '')), '') is null and p_vencimento is null then 'sem_plano'
    when p_vencimento is null then 'ativo'
    when p_vencimento < public.hoje_br() then 'expirado'
    when p_vencimento <= public.hoje_br() + 7 then 'proximo_vencimento'
    else 'ativo'
  end
$$;
grant execute on function public.hoje_br() to authenticated;
grant execute on function public.plano_situacao(text, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 1) Status manual do plano + controle de aviso
-- ---------------------------------------------------------------------------
alter table clientes add column if not exists plano_status text not null default 'ativo'
  check (plano_status in ('ativo', 'cancelado'));
-- "<situacao>:<vencimento>" do último aviso gerado pro profissional.
alter table clientes add column if not exists plano_aviso_chave text;

-- ---------------------------------------------------------------------------
-- 2) Histórico
-- ---------------------------------------------------------------------------
create table if not exists cliente_planos_historico (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  trainer_id uuid not null references trainers(id) on delete cascade,
  tipo text not null check (tipo in ('registro_inicial', 'contratacao', 'alteracao', 'renovacao', 'correcao', 'cancelamento', 'reativacao')),
  plano_anterior text,
  inicio_anterior date,
  vencimento_anterior date,
  status_anterior text,
  plano text,
  data_inicio date,
  data_vencimento date,
  status text,
  alterado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists cliente_planos_historico_cliente_idx
  on cliente_planos_historico (cliente_id, created_at desc);

alter table cliente_planos_historico enable row level security;

-- Só leitura pelo profissional dono. Ninguém grava direto pela API: as linhas
-- vêm só do trigger (security definer), então o histórico não é editável.
drop policy if exists "trainer vê o histórico de planos dos seus alunos" on cliente_planos_historico;
create policy "trainer vê o histórico de planos dos seus alunos"
  on cliente_planos_historico for select
  using (trainer_id = auth.uid());

create or replace function public.registrar_historico_plano()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_tipo text := nullif(current_setting('elo.plano_tipo', true), '');
begin
  if tg_op = 'INSERT' then
    if nullif(trim(coalesce(new.plano, '')), '') is null and new.plano_data_expiracao is null then
      return new;
    end if;
    v_tipo := 'contratacao';
  else
    if new.plano is not distinct from old.plano
       and new.plano_data_inicio is not distinct from old.plano_data_inicio
       and new.plano_data_expiracao is not distinct from old.plano_data_expiracao
       and new.plano_status is not distinct from old.plano_status then
      return new;
    end if;
    if v_tipo is null or v_tipo not in ('contratacao', 'alteracao', 'renovacao', 'correcao', 'cancelamento', 'reativacao') then
      v_tipo := case
        when new.plano_status = 'cancelado' and old.plano_status <> 'cancelado' then 'cancelamento'
        when old.plano_status = 'cancelado' and new.plano_status <> 'cancelado' then 'reativacao'
        when nullif(trim(coalesce(old.plano, '')), '') is null then 'contratacao'
        when new.plano is distinct from old.plano then 'alteracao'
        when old.plano_data_expiracao is not null and new.plano_data_expiracao > old.plano_data_expiracao then 'renovacao'
        else 'correcao'
      end;
    end if;
  end if;

  insert into cliente_planos_historico (
    cliente_id, trainer_id, tipo,
    plano_anterior, inicio_anterior, vencimento_anterior, status_anterior,
    plano, data_inicio, data_vencimento, status
  ) values (
    new.id, new.trainer_id, v_tipo,
    case when tg_op = 'UPDATE' then old.plano end,
    case when tg_op = 'UPDATE' then old.plano_data_inicio end,
    case when tg_op = 'UPDATE' then old.plano_data_expiracao end,
    case when tg_op = 'UPDATE' then public.plano_situacao(old.plano, old.plano_status, old.plano_data_expiracao) end,
    new.plano, new.plano_data_inicio, new.plano_data_expiracao,
    public.plano_situacao(new.plano, new.plano_status, new.plano_data_expiracao)
  );
  return new;
end;
$$;

drop trigger if exists registrar_historico_plano on clientes;
create trigger registrar_historico_plano
  after insert or update of plano, plano_data_inicio, plano_data_expiracao, plano_status on clientes
  for each row execute function public.registrar_historico_plano();

-- Backfill: o plano vigente de quem já tem plano vira o primeiro registro.
insert into cliente_planos_historico (
  cliente_id, trainer_id, tipo, plano, data_inicio, data_vencimento, status, alterado_por, created_at
)
select c.id, c.trainer_id, 'registro_inicial', c.plano, c.plano_data_inicio, c.plano_data_expiracao,
       public.plano_situacao(c.plano, c.plano_status, c.plano_data_expiracao), null, c.created_at
from clientes c
where (nullif(trim(coalesce(c.plano, '')), '') is not null or c.plano_data_expiracao is not null)
  and not exists (select 1 from cliente_planos_historico h where h.cliente_id = c.id);

-- ---------------------------------------------------------------------------
-- 3) RPC do perfil do aluno
-- security invoker: o UPDATE passa pela RLS de clientes (trainer_id =
-- auth.uid()), então um profissional não altera aluno de outro.
-- ---------------------------------------------------------------------------
create or replace function public.salvar_plano_aluno(
  p_cliente_id uuid,
  p_plano text,
  p_data_inicio date,
  p_data_vencimento date,
  p_status text default 'ativo',
  p_tipo text default null
)
returns clientes
language plpgsql
security invoker set search_path = public
as $$
declare
  v_cliente clientes;
begin
  if nullif(trim(coalesce(p_plano, '')), '') is null then
    raise exception 'Informe o nome do plano.';
  end if;
  if p_data_inicio is null then
    raise exception 'Informe a data de início do plano.';
  end if;
  if p_data_vencimento is not null and p_data_vencimento < p_data_inicio then
    raise exception 'O vencimento não pode ser antes do início do plano.';
  end if;
  if coalesce(p_status, 'ativo') not in ('ativo', 'cancelado') then
    raise exception 'Status de plano inválido.';
  end if;

  perform set_config('elo.plano_tipo', coalesce(p_tipo, ''), true);

  update clientes
     set plano = trim(p_plano),
         plano_data_inicio = p_data_inicio,
         plano_data_expiracao = p_data_vencimento,
         plano_status = coalesce(p_status, 'ativo')
   where id = p_cliente_id
     and trainer_id = auth.uid()
  returning * into v_cliente;

  perform set_config('elo.plano_tipo', '', true);

  if v_cliente.id is null then
    raise exception 'Aluno não encontrado entre os seus alunos.';
  end if;
  return v_cliente;
end;
$$;
revoke execute on function public.salvar_plano_aluno(uuid, text, date, date, text, text) from public, anon;
grant execute on function public.salvar_plano_aluno(uuid, text, date, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Bloqueio de acesso por plano
-- true só pra aluno cujo(s) cadastro(s) estão todos com plano expirado ou
-- cancelado. Profissional (linha em trainers) nunca é bloqueado.
-- ---------------------------------------------------------------------------
create or replace function public.aluno_plano_bloqueado()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
      select 1 from clientes c
      where c.auth_user_id = auth.uid()
        and public.plano_situacao(c.plano, c.plano_status, c.plano_data_expiracao) in ('expirado', 'cancelado')
    )
    and not exists (
      select 1 from clientes c
      where c.auth_user_id = auth.uid()
        and public.plano_situacao(c.plano, c.plano_status, c.plano_data_expiracao) not in ('expirado', 'cancelado')
    )
    and not exists (select 1 from trainers t where t.id = auth.uid());
$$;
revoke execute on function public.aluno_plano_bloqueado() from public, anon;
grant execute on function public.aluno_plano_bloqueado() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'treinos', 'treino_exercicios', 'exercicios', 'tecnicas_avancadas',
    'exercicio_personalizacoes', 'cardio_protocolos', 'dietas', 'agendamentos',
    'avaliacoes_fisicas', 'calorimetrias', 'feedbacks_treino', 'treino_execucoes',
    'treino_exercicio_execucoes', 'treino_serie_execucoes', 'serie_cargas'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "plano: aluno com plano vencido bloqueado" on public.%I', t);
      execute format(
        'create policy "plano: aluno com plano vencido bloqueado" on public.%I
           as restrictive for all to authenticated
           using (not (select public.aluno_plano_bloqueado()))
           with check (not (select public.aluno_plano_bloqueado()))',
        t);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Avisos de vencimento pro profissional (chamado ao abrir o painel)
-- ---------------------------------------------------------------------------
create or replace function public.gerar_avisos_vencimento_plano()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  v_qtd int;
begin
  if not exists (select 1 from trainers where id = auth.uid()) then
    return 0;
  end if;

  with alvo as (
    select c.id, c.nome, c.plano, c.plano_data_expiracao,
           public.plano_situacao(c.plano, c.plano_status, c.plano_data_expiracao) as situacao
    from clientes c
    where c.trainer_id = auth.uid()
      and c.status = 'ativo'
      and c.plano_status = 'ativo'
      and c.plano_data_expiracao is not null
      and c.plano_data_expiracao between public.hoje_br() - 30 and public.hoje_br() + 7
  ), novos as (
    select a.* from alvo a
    join clientes c on c.id = a.id
    where a.situacao in ('proximo_vencimento', 'expirado')
      and c.plano_aviso_chave is distinct from a.situacao || ':' || a.plano_data_expiracao
  ), ins as (
    insert into notificacoes (trainer_id, cliente_id, destino, titulo, descricao)
    select auth.uid(), n.id, 'trainer',
           case when n.situacao = 'expirado'
             then 'Plano de ' || n.nome || ' venceu'
             else 'Plano de ' || n.nome || ' vence em ' || to_char(n.plano_data_expiracao, 'DD/MM/YYYY')
           end,
           case when n.situacao = 'expirado'
             then 'O acesso do aluno ao treino e à dieta foi bloqueado. Renove o plano no perfil do aluno.'
             else 'Renove o plano (' || coalesce(n.plano, 'sem nome') || ') no perfil do aluno para não bloquear o acesso.'
           end
    from novos n
    returning cliente_id
  )
  update clientes c
     set plano_aviso_chave = n.situacao || ':' || n.plano_data_expiracao
    from novos n
   where c.id = n.id;

  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;
revoke execute on function public.gerar_avisos_vencimento_plano() from public, anon;
grant execute on function public.gerar_avisos_vencimento_plano() to authenticated;
