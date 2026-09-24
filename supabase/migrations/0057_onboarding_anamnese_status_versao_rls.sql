-- Onboarding obrigatório da anamnese pra aluno que entra por convite —
-- versão "de verdade", controlada pelo banco:
--
-- 1) clientes.origem_cadastro ('manual' | 'convite') vira a fonte de verdade
--    da origem. anamnese_obrigatoria (0052) passa a ser derivada dela
--    (coluna gerada), então nunca mais diverge.
-- 2) clientes.anamnese_status ('pendente' | 'concluida') + anamnese_concluida_em.
--    O aluno só tem SELECT em clientes (0003), então não consegue se
--    auto-liberar: o status só muda via concluir_anamnese() (security
--    definer), que valida as respostas no servidor antes.
--    Antes o gate olhava anamnese_respostas.respondido_em, que é
--    NOT NULL DEFAULT now() (0006) — o primeiro autosave já "concluía".
-- 3) Versão da anamnese: anamnese_templates.versao (incrementa a cada
--    mudança de estrutura) e, na resposta do aluno, template_id +
--    template_versao + estrutura_snapshot congelados no início do
--    onboarding — editar o template depois não altera o que o aluno
--    respondeu nem a pergunta que ele viu.
-- 4) Bloqueio no backend: policies RESTRICTIVE nas tabelas da plataforma
--    do aluno. Aluno de convite com anamnese pendente não lê nem grava
--    treino/dieta/evolução/avaliação/mensagens, mesmo chamando a API
--    direto. Aluno manual e profissional não são afetados.

-- ---------------------------------------------------------------------------
-- 1) Origem do cadastro
-- ---------------------------------------------------------------------------
alter table clientes add column origem_cadastro text not null default 'manual'
  check (origem_cadastro in ('manual', 'convite'));

update clientes set origem_cadastro = 'convite' where anamnese_obrigatoria;

alter table clientes drop column anamnese_obrigatoria;
alter table clientes add column anamnese_obrigatoria boolean
  generated always as (origem_cadastro = 'convite') stored;

-- ---------------------------------------------------------------------------
-- 2) Status da anamnese
-- ---------------------------------------------------------------------------
alter table clientes
  add column anamnese_status text not null default 'pendente'
    check (anamnese_status in ('pendente', 'concluida')),
  add column anamnese_concluida_em timestamptz;

-- Backfill: preserva exatamente quem tem acesso ao app hoje — o gate
-- antigo liberava qualquer um com linha em anamnese_respostas (inclusive
-- só de autosave, por causa do default now()), e havia alunas de convite
-- já treinando nessa situação. Quem o gate antigo bloqueava (sem linha)
-- continua pendente. A regra nova vale inteira pros próximos convites.
update clientes c
set anamnese_status = 'concluida',
    anamnese_concluida_em = coalesce(
      (select ard.respondido_em from anamnese_respostas_dinamicas ard where ard.cliente_id = c.id),
      (select ar.respondido_em from anamnese_respostas ar where ar.cliente_id = c.id),
      now())
where exists (
    select 1 from anamnese_respostas_dinamicas ard
    where ard.cliente_id = c.id and ard.respondido_em is not null
  )
  or exists (select 1 from anamnese_respostas ar where ar.cliente_id = c.id);

-- ---------------------------------------------------------------------------
-- 3) Versão da anamnese
-- ---------------------------------------------------------------------------
alter table anamnese_templates add column versao int not null default 1;

create or replace function public.anamnese_template_bump_versao()
returns trigger
language plpgsql
as $$
begin
  if new.estrutura is distinct from old.estrutura then
    new.versao := old.versao + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger anamnese_template_bump_versao
  before update on anamnese_templates
  for each row execute function public.anamnese_template_bump_versao();

alter table anamnese_respostas_dinamicas
  add column template_id uuid references anamnese_templates(id) on delete set null,
  add column template_versao int,
  add column template_tipo text check (template_tipo in ('padrao', 'personalizada')),
  add column estrutura_snapshot jsonb;

-- O aluno tem policy "for all" em anamnese_respostas_dinamicas (0031, pro
-- autosave das respostas). Sem isso ele conseguiria, pela API, trocar a
-- versão congelada. Só funções security definer (current_user = dono da
-- função) mexem nessas colunas; o autosave e o form do profissional
-- continuam gravando respostas normalmente.
create or replace function public.anamnese_proteger_versao()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.template_id := null;
      new.template_versao := null;
      new.template_tipo := null;
      new.estrutura_snapshot := null;
    else
      new.template_id := old.template_id;
      new.template_versao := old.template_versao;
      new.template_tipo := old.template_tipo;
      new.estrutura_snapshot := old.estrutura_snapshot;
    end if;
  end if;
  return new;
end;
$$;

create trigger anamnese_proteger_versao
  before insert or update on anamnese_respostas_dinamicas
  for each row execute function public.anamnese_proteger_versao();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- true só pra aluno de convite com anamnese pendente. Profissional (linha
-- em trainers) nunca é bloqueado, mesmo que tenha um cadastro de cliente.
create or replace function public.aluno_onboarding_pendente()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
      select 1 from clientes c
      where c.auth_user_id = auth.uid()
        and c.origem_cadastro = 'convite'
        and c.anamnese_status = 'pendente'
    )
    and not exists (select 1 from trainers t where t.id = auth.uid());
$$;
grant execute on function public.aluno_onboarding_pendente() to authenticated;

-- Cadastro de cliente do aluno logado. Prioriza um onboarding pendente de
-- convite (é ele que precisa ser respondido), depois o mais recente.
create or replace function public.cliente_do_aluno_logado()
returns clientes
language sql
stable
security definer set search_path = public
as $$
  select c.* from clientes c
  where c.auth_user_id = auth.uid()
  order by (c.origem_cadastro = 'convite' and c.anamnese_status = 'pendente') desc, c.created_at desc
  limit 1;
$$;
revoke execute on function public.cliente_do_aluno_logado() from public, anon;

-- ---------------------------------------------------------------------------
-- iniciar_anamnese(): resolve NO SERVIDOR qual anamnese o aluno responde
-- (a do profissional dele — personalizada se anamnese_modo =
-- 'personalizada' e existir, senão a padrão) e congela a versão na
-- resposta. Chamadas seguintes devolvem o mesmo snapshot (continua de onde
-- parou, na mesma versão).
-- ---------------------------------------------------------------------------
create or replace function public.iniciar_anamnese()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_cliente clientes;
  v_din anamnese_respostas_dinamicas;
  v_modo text;
  v_tpl anamnese_templates;
  v_tipo text;
begin
  v_cliente := public.cliente_do_aluno_logado();
  if v_cliente.id is null then
    raise exception 'Cadastro de aluno não encontrado.';
  end if;

  select * into v_din from anamnese_respostas_dinamicas where cliente_id = v_cliente.id;

  if v_din.id is null or v_din.estrutura_snapshot is null then
    select anamnese_modo into v_modo from trainers where id = v_cliente.trainer_id;

    if v_modo = 'personalizada' then
      select * into v_tpl from anamnese_templates where trainer_id = v_cliente.trainer_id;
      v_tipo := 'personalizada';
    end if;
    if v_tpl.id is null then
      select * into v_tpl from anamnese_templates where trainer_id is null;
      v_tipo := 'padrao';
    end if;

    insert into anamnese_respostas_dinamicas
      (cliente_id, trainer_id, template_id, template_versao, template_tipo, estrutura_snapshot)
    values
      (v_cliente.id, v_cliente.trainer_id, v_tpl.id, v_tpl.versao, v_tipo,
       coalesce(v_tpl.estrutura, '{"secoes":[],"perguntas":[]}'::jsonb))
    on conflict (cliente_id) do update
      set template_id = excluded.template_id,
          template_versao = excluded.template_versao,
          template_tipo = excluded.template_tipo,
          estrutura_snapshot = excluded.estrutura_snapshot,
          updated_at = now()
    returning * into v_din;
  end if;

  return jsonb_build_object(
    'cliente_id', v_cliente.id,
    'trainer_id', v_cliente.trainer_id,
    'nome', v_cliente.nome,
    'origem_cadastro', v_cliente.origem_cadastro,
    'anamnese_status', v_cliente.anamnese_status,
    'template_id', v_din.template_id,
    'template_versao', v_din.template_versao,
    'template_tipo', v_din.template_tipo,
    'estrutura', v_din.estrutura_snapshot,
    'respostas', v_din.respostas
  );
end;
$$;
revoke execute on function public.iniciar_anamnese() from public, anon;
grant execute on function public.iniciar_anamnese() to authenticated;

-- ---------------------------------------------------------------------------
-- concluir_anamnese(): única forma de virar ANAMNESE_CONCLUIDA. Valida no
-- servidor dados pessoais + perguntas obrigatórias visíveis (respeitando
-- depende_de) da versão congelada, salva tudo e libera a plataforma.
-- ---------------------------------------------------------------------------
create or replace function public.concluir_anamnese(p_pessoais jsonb, p_respostas jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_cliente clientes;
  v_din anamnese_respostas_dinamicas;
  q jsonb;
  v_gatilho jsonb;
  v_visivel boolean;
  v_resp jsonb;
  v_agora timestamptz := now();
begin
  v_cliente := public.cliente_do_aluno_logado();
  if v_cliente.id is null then
    raise exception 'Cadastro de aluno não encontrado.';
  end if;

  select * into v_din from anamnese_respostas_dinamicas where cliente_id = v_cliente.id;
  if v_din.id is null or v_din.estrutura_snapshot is null then
    raise exception 'Anamnese não iniciada — recarregue a página.';
  end if;

  p_respostas := coalesce(p_respostas, '{}'::jsonb);

  if coalesce(p_pessoais->>'sexo', '') not in ('M', 'F')
     or nullif(p_pessoais->>'idade', '') is null
     or nullif(p_pessoais->>'altura_cm', '') is null
     or nullif(p_pessoais->>'peso_kg', '') is null then
    raise exception 'Preencha todos os dados pessoais.';
  end if;

  for q in select * from jsonb_array_elements(coalesce(v_din.estrutura_snapshot->'perguntas', '[]'::jsonb)) loop
    if coalesce((q->>'obrigatoria')::boolean, false) then
      v_visivel := true;
      if jsonb_typeof(q->'depende_de') = 'object' then
        v_gatilho := p_respostas -> (q->'depende_de'->>'pergunta_id');
        if v_gatilho is null or jsonb_typeof(v_gatilho) = 'null' then
          v_visivel := false;
        elsif jsonb_typeof(v_gatilho) = 'array' then
          v_visivel := exists (
            select 1 from jsonb_array_elements_text(v_gatilho) a
            where (q->'depende_de'->'valores') ? a
          );
        else
          v_visivel := (q->'depende_de'->'valores') ? (v_gatilho #>> '{}');
        end if;
      end if;

      if v_visivel then
        v_resp := p_respostas -> (q->>'id');
        if v_resp is null
           or jsonb_typeof(v_resp) = 'null'
           or (jsonb_typeof(v_resp) = 'array' and jsonb_array_length(v_resp) = 0)
           or (jsonb_typeof(v_resp) = 'string' and btrim(v_resp #>> '{}') = '') then
          raise exception 'Responda todas as perguntas obrigatórias (faltou: %).', q->>'label';
        end if;
      end if;
    end if;
  end loop;

  -- Status primeiro: o resto das escritas (e o trigger de peso inicial,
  -- 0036) já rodam com a plataforma liberada.
  update clientes
  set anamnese_status = 'concluida', anamnese_concluida_em = v_agora
  where id = v_cliente.id;

  insert into anamnese_respostas
    (cliente_id, trainer_id, objetivo, sexo, idade, altura_cm, peso_kg, respondido_em)
  values
    (v_cliente.id, v_cliente.trainer_id,
     nullif(p_pessoais->>'objetivo', ''),
     p_pessoais->>'sexo',
     (p_pessoais->>'idade')::numeric::int,
     (p_pessoais->>'altura_cm')::numeric::int,
     (p_pessoais->>'peso_kg')::numeric,
     v_agora)
  on conflict (cliente_id) do update
    set objetivo = excluded.objetivo,
        sexo = excluded.sexo,
        idade = excluded.idade,
        altura_cm = excluded.altura_cm,
        peso_kg = excluded.peso_kg,
        respondido_em = excluded.respondido_em;

  update anamnese_respostas_dinamicas
  set respostas = p_respostas, respondido_em = v_agora, updated_at = v_agora
  where id = v_din.id;

  return jsonb_build_object(
    'cliente_id', v_cliente.id,
    'anamnese_status', 'concluida',
    'anamnese_concluida_em', v_agora,
    'template_versao', v_din.template_versao
  );
end;
$$;
revoke execute on function public.concluir_anamnese(jsonb, jsonb) from public, anon;
grant execute on function public.concluir_anamnese(jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- accept_convite: corpo idêntico ao de 0052, trocando anamnese_obrigatoria
-- (agora gerada) por origem_cadastro = 'convite' no INSERT de cadastro
-- novo. Reaproveitar cadastro manual existente (mesmo e-mail) continua sem
-- duplicar e sem mudar a origem — aluno manual nunca é bloqueado.
-- ---------------------------------------------------------------------------
create or replace function public.accept_convite(p_token text, p_nome text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_convite convites%rowtype;
  v_cliente_id uuid;
  v_limite int;
  v_atual int;
begin
  select * into v_convite from convites where token = p_token and status = 'pendente';
  if not found then
    raise exception 'Convite inválido ou já utilizado.';
  end if;

  select id into v_cliente_id
  from clientes
  where trainer_id = v_convite.trainer_id
    and auth_user_id = auth.uid()
  limit 1;

  if v_cliente_id is null then
    select id into v_cliente_id
    from clientes
    where trainer_id = v_convite.trainer_id
      and lower(email) = lower(v_convite.email)
      and auth_user_id is null
    limit 1;
  end if;

  if v_cliente_id is not null then
    update clientes
    set auth_user_id = auth.uid(),
        nome = coalesce(nullif(p_nome, ''), nome),
        status = 'ativo'
    where id = v_cliente_id;
  else
    select pa.limite_alunos into v_limite
    from trainers t
    left join planos_assinatura pa on pa.id = t.plano_id
    where t.id = v_convite.trainer_id;

    if v_limite is not null then
      select count(*) into v_atual from clientes where trainer_id = v_convite.trainer_id;
      if v_atual >= v_limite then
        raise exception 'Seu personal atingiu o limite de alunos do plano atual — peça pra ele fazer upgrade antes de você continuar.';
      end if;
    end if;

    insert into clientes (trainer_id, auth_user_id, nome, email, status, origem_cadastro)
    values (v_convite.trainer_id, auth.uid(), coalesce(nullif(p_nome, ''), v_convite.email), v_convite.email, 'ativo', 'convite')
    returning id into v_cliente_id;
  end if;

  update convites set status = 'aceito', cliente_id = v_cliente_id where id = v_convite.id;

  return v_cliente_id;
end;
$$;
grant execute on function public.accept_convite(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Bloqueio no backend: RESTRICTIVE = AND com as policies existentes.
-- "(select ...)" faz o Postgres avaliar a função uma vez por query.
-- Ficam de fora (liberadas durante o onboarding): clientes, trainers,
-- anamnese_*, convites, notificacoes.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'treinos', 'treino_exercicios', 'exercicios', 'tecnicas_avancadas',
    'cardio_protocolos', 'dietas', 'agendamentos', 'avaliacoes_fisicas',
    'calorimetrias', 'medidas_corporais', 'comparacoes_fotos', 'fotos_evolucao',
    'registros_peso', 'feedbacks_treino', 'treino_execucoes',
    'treino_exercicio_execucoes', 'treino_serie_execucoes', 'serie_cargas',
    'mensagens'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format(
        'create policy "onboarding: aluno com anamnese pendente bloqueado" on public.%I
           as restrictive for all to authenticated
           using (not (select public.aluno_onboarding_pendente()))
           with check (not (select public.aluno_onboarding_pendente()))',
        t);
    end if;
  end loop;
end;
$$;
