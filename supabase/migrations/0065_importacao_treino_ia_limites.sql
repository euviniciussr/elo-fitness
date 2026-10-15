-- Limite de uso da IA na importação de treino + colunas só do servidor.
--
-- A 0064 foi aplicada em produção na primeira versão (sem limite por plano).
-- Esta migration completa o que faltava e é idempotente: roda tanto em cima
-- dessa primeira versão quanto da 0064 atual, sem erro e sem duplicar nada.

alter table importacoes_treino add column if not exists cota_consumida_em timestamptz;

revoke insert, update on importacoes_treino from authenticated, anon;
grant insert (id, trainer_id, cliente_id, hash_arquivos, arquivos) on importacoes_treino to authenticated;
grant update (arquivos, arquivos_removidos, status, updated_at) on importacoes_treino to authenticated;

create or replace function public.importacoes_treino_status_cliente()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'authenticated' and new.status is distinct from old.status and new.status <> 'descartado' then
    raise exception 'Status da importação só pode ser alterado pelo servidor.';
  end if;
  return new;
end;
$$;

drop trigger if exists importacoes_treino_status_cliente on importacoes_treino;
create trigger importacoes_treino_status_cliente
  before update on importacoes_treino
  for each row execute function public.importacoes_treino_status_cliente();

-- Limite de uso da IA (custo por leitura):
--   plano grátis (e trial/inadimplente): 1 importação por aluno;
--   plano pago ativo ou conta isenta: 1 importação por dia;
--   qualquer plano: uma leitura em andamento por vez.
-- Só conta leitura concluída (cota_consumida_em); erro da IA não gasta cota.
-- Devolve o motivo do bloqueio ou null se liberado.
create or replace function public.motivo_bloqueio_importacao_ia(p_cliente_id uuid, p_ignorar_id uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text;
  v_valor numeric;
  v_pro boolean;
  v_inicio_dia timestamptz := (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
begin
  if not exists (select 1 from clientes where id = p_cliente_id and trainer_id = auth.uid()) then
    return 'Este aluno não pertence ao profissional.';
  end if;

  if exists (
    select 1 from importacoes_treino
    where trainer_id = auth.uid() and status = 'processando'
      and processando_desde > now() - interval '8 minutes'
      and id is distinct from p_ignorar_id
  ) then
    return 'Já existe uma ficha sendo lida pela IA. Aguarde ela terminar para enviar outra.';
  end if;

  select t.status_assinatura, pa.valor into v_status, v_valor
    from trainers t left join planos_assinatura pa on pa.id = t.plano_id
    where t.id = auth.uid();
  v_pro := v_status = 'isento' or (v_status = 'ativo' and coalesce(v_valor, 0) > 0);

  if v_pro then
    if exists (
      select 1 from importacoes_treino
      where trainer_id = auth.uid() and cota_consumida_em >= v_inicio_dia
        and id is distinct from p_ignorar_id
    ) then
      return 'Seu plano permite 1 importação de treino com IA por dia. Tente novamente amanhã.';
    end if;
  elsif exists (
    select 1 from importacoes_treino
    where trainer_id = auth.uid() and cliente_id = p_cliente_id and cota_consumida_em is not null
      and id is distinct from p_ignorar_id
  ) then
    return 'No plano gratuito é possível importar 1 treino com IA por aluno, e este aluno já usou a dele. Faça upgrade para importar 1 treino por dia.';
  end if;

  return null;
end;
$$;

grant execute on function public.motivo_bloqueio_importacao_ia(uuid, uuid) to authenticated;

-- Reserva atômica antes de chamar a IA (Edge Function, com o JWT do
-- profissional). O lock por profissional impede que várias requisições
-- simultâneas passem juntas pela checagem de limite.
create or replace function public.reservar_importacao_ia(p_importacao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  imp importacoes_treino%rowtype;
  v_motivo text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('importacao_ia:' || auth.uid()::text, 0));

  select * into imp from importacoes_treino
    where id = p_importacao_id and trainer_id = auth.uid()
    for update;
  if not found then
    raise exception 'Importação não encontrada.';
  end if;

  -- Clique repetido / aba duplicada: não dispara outra leitura.
  if imp.status in ('concluido', 'importado', 'descartado')
     or (imp.status = 'processando' and imp.processando_desde > now() - interval '8 minutes') then
    return jsonb_build_object('reservada', false, 'status', imp.status);
  end if;

  v_motivo := motivo_bloqueio_importacao_ia(imp.cliente_id, imp.id);
  if v_motivo is not null then
    raise exception '%', v_motivo using errcode = 'P0429';
  end if;

  update importacoes_treino
    set status = 'processando', processando_desde = now(), erro = null, updated_at = now()
    where id = imp.id;
  return jsonb_build_object('reservada', true, 'status', 'processando');
end;
$$;

grant execute on function public.reservar_importacao_ia(uuid) to authenticated;

-- Status "importado" é do servidor (ver trigger acima): só marca quando a
-- divisão existe de verdade e é deste profissional e deste aluno.
create or replace function public.marcar_importacao_importada(p_importacao_id uuid, p_split_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update importacoes_treino i
    set status = 'importado', split_id = p_split_id, updated_at = now()
    where i.id = p_importacao_id and i.trainer_id = auth.uid() and i.status = 'concluido'
      and exists (
        select 1 from treinos t
        where t.split_id = p_split_id and t.trainer_id = auth.uid() and t.cliente_id = i.cliente_id
      );
  if not found then
    raise exception 'Não foi possível concluir a importação.';
  end if;
end;
$$;

grant execute on function public.marcar_importacao_importada(uuid, uuid) to authenticated;

-- Grava a prévia revisada como uma divisão nova do aluno (nunca substitui
-- treino existente). Roda com a RLS de quem chama (security invoker) e é uma
-- transação só: qualquer erro desfaz tudo, sem treino pela metade.
--
-- p_divisoes: [{ nome, observacoes, exercicios: [{
--   exercicio_id | novo_exercicio: {nome, categoria},
--   series_aquecimento, series, carga, intervalo_descanso, descanso_segundos,
--   tecnica_id | nova_tecnica_nome, tecnica_instrucoes, observacoes, combo }] }]
create or replace function public.confirmar_importacao_treino(p_importacao_id uuid, p_divisoes jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  imp importacoes_treino%rowtype;
  v_split uuid := gen_random_uuid();
  v_div jsonb;
  v_ex jsonb;
  v_div_idx int := 0;
  v_ex_idx int;
  v_treino_id uuid;
  v_exercicio_id uuid;
  v_tecnica text;
  v_nome text;
  v_combos jsonb;
  v_grupo uuid;
begin
  select * into imp from importacoes_treino
    where id = p_importacao_id and trainer_id = auth.uid()
    for update;
  if not found then
    raise exception 'Importação não encontrada.';
  end if;

  -- Reenvio / clique repetido: devolve a mesma divisão já criada.
  if imp.status = 'importado' then
    return imp.split_id;
  end if;
  if imp.status <> 'concluido' then
    raise exception 'A importação ainda não está pronta para ser confirmada (status: %).', imp.status;
  end if;

  if not exists (select 1 from clientes where id = imp.cliente_id and trainer_id = auth.uid()) then
    raise exception 'Este aluno não pertence ao profissional.';
  end if;

  if jsonb_typeof(p_divisoes) <> 'array' or jsonb_array_length(p_divisoes) = 0 then
    raise exception 'Nenhum treino para importar.';
  end if;

  for v_div in select * from jsonb_array_elements(p_divisoes) loop
    v_nome := nullif(trim(v_div->>'nome'), '');
    if v_nome is null then
      raise exception 'Treino % sem nome.', v_div_idx + 1;
    end if;

    insert into treinos (trainer_id, cliente_id, nome, descricao, habilitado, dias_semana, split_id, ordem)
    values (auth.uid(), imp.cliente_id, left(v_nome, 120), nullif(trim(v_div->>'observacoes'), ''), false, '{}', v_split, v_div_idx)
    returning id into v_treino_id;

    v_combos := '{}'::jsonb;
    v_ex_idx := 0;
    for v_ex in select * from jsonb_array_elements(coalesce(v_div->'exercicios', '[]'::jsonb)) loop
      -- Exercício: do acervo visível ao profissional, ou particular novo.
      v_exercicio_id := nullif(v_ex->>'exercicio_id', '')::uuid;
      if v_exercicio_id is not null then
        if not exists (
          select 1 from exercicios e
          where e.id = v_exercicio_id and (e.is_global or e.trainer_id = auth.uid())
        ) then
          raise exception 'Exercício % do % não está disponível no seu acervo.', v_ex_idx + 1, v_nome;
        end if;
      elsif v_ex ? 'novo_exercicio' and nullif(trim(v_ex->'novo_exercicio'->>'nome'), '') is not null then
        select e.id into v_exercicio_id from exercicios e
          where e.trainer_id = auth.uid() and not e.is_global
            and lower(trim(e.nome)) = lower(trim(v_ex->'novo_exercicio'->>'nome'))
          limit 1;
        if v_exercicio_id is null then
          insert into exercicios (trainer_id, is_global, nome, categoria)
          values (auth.uid(), false, left(trim(v_ex->'novo_exercicio'->>'nome'), 120),
                  nullif(trim(v_ex->'novo_exercicio'->>'categoria'), ''))
          returning id into v_exercicio_id;
        end if;
      else
        raise exception 'O exercício % do % está sem correspondência no acervo.', v_ex_idx + 1, v_nome;
      end if;

      -- Técnica: do acervo visível, particular nova (reaproveita se já existir com o mesmo nome) ou nenhuma.
      v_tecnica := 'nenhuma';
      if nullif(v_ex->>'tecnica_id', '') is not null then
        if not exists (
          select 1 from tecnicas_avancadas t
          where t.id = (v_ex->>'tecnica_id')::uuid and (t.is_global or t.trainer_id = auth.uid())
        ) then
          raise exception 'Técnica avançada do exercício % do % não está disponível.', v_ex_idx + 1, v_nome;
        end if;
        v_tecnica := v_ex->>'tecnica_id';
      elsif nullif(trim(v_ex->>'nova_tecnica_nome'), '') is not null then
        select t.id::text into v_tecnica from tecnicas_avancadas t
          where (t.is_global or t.trainer_id = auth.uid())
            and lower(trim(t.nome)) = lower(trim(v_ex->>'nova_tecnica_nome'))
          limit 1;
        if v_tecnica is null then
          insert into tecnicas_avancadas (trainer_id, is_global, nome)
          values (auth.uid(), false, left(trim(v_ex->>'nova_tecnica_nome'), 80))
          returning id::text into v_tecnica;
        end if;
      end if;

      -- Combos (bi-set/superset/tri-set): mesmo rótulo na mesma divisão = mesmo grupo_id.
      v_grupo := null;
      if nullif(trim(v_ex->>'combo'), '') is not null then
        if v_combos ? (v_ex->>'combo') then
          v_grupo := (v_combos->>(v_ex->>'combo'))::uuid;
        else
          v_grupo := gen_random_uuid();
          v_combos := v_combos || jsonb_build_object(v_ex->>'combo', v_grupo::text);
        end if;
      end if;

      insert into treino_exercicios (
        treino_id, exercicio_id, ordem, series_aquecimento, series, carga,
        intervalo_descanso, descanso_segundos, tecnica_avancada, tecnica_instrucoes,
        observacoes, grupo_id
      ) values (
        v_treino_id, v_exercicio_id, v_ex_idx,
        nullif(trim(v_ex->>'series_aquecimento'), ''),
        nullif(trim(v_ex->>'series'), ''),
        nullif(trim(v_ex->>'carga'), ''),
        nullif(trim(v_ex->>'intervalo_descanso'), ''),
        case when (v_ex->>'descanso_segundos') ~ '^\d+$' then (v_ex->>'descanso_segundos')::int end,
        v_tecnica,
        case when v_tecnica = 'nenhuma' then null else nullif(trim(v_ex->>'tecnica_instrucoes'), '') end,
        nullif(trim(v_ex->>'observacoes'), ''),
        v_grupo
      );
      v_ex_idx := v_ex_idx + 1;
    end loop;

    v_div_idx := v_div_idx + 1;
  end loop;

  perform marcar_importacao_importada(imp.id, v_split);

  return v_split;
end;
$$;

grant execute on function public.confirmar_importacao_treino(uuid, jsonb) to authenticated;
