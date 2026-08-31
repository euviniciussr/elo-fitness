-- Sistema de anamnese dinâmica e personalizável por profissional.
--
-- "Dados pessoais e experiência" (sexo, idade, altura, peso, objetivo, tempo
-- de treino) continua em anamnese_respostas com colunas fixas, porque sexo/
-- idade/altura_cm/peso_kg/nivel_atividade/objetivo_calorico alimentam
-- diretamente a calculadora de TMB/GET usada em montar-dieta.html — não dá
-- pra deixar isso solto num JSON customizável sem quebrar o cálculo.
-- "nivel" (nível de experiência) só era usado pra exibição em
-- aluno-detalhe.html, então é seguro substituir pela nova pergunta
-- "Tempo de treino" (tempo_treino) sem migrar dado nenhum.
alter table anamnese_respostas
  add column tempo_treino text check (tempo_treino in ('1_a_6_meses', '6_meses_a_1_ano', '1_a_3_anos', 'acima_3_anos'));

-- Todo o resto da anamnese (profissão/atividade, rotina de treino, tempo
-- disponível, dores/lesões/saúde, horários, hábitos alimentares, restrições,
-- suplementação) vira totalmente customizável por profissional, guardado
-- como estrutura JSON (seções -> perguntas -> opções), com respostas do
-- aluno amarradas ao ID estável de cada pergunta (não à posição/texto) —
-- assim, se o profissional editar o enunciado de uma pergunta depois, a
-- resposta antiga do aluno continua corretamente vinculada.
create table anamnese_templates (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid references trainers(id) on delete cascade,
  estrutura jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trainer_id)
);

-- Garante que só existe uma linha "padrão do sistema" (trainer_id null) —
-- unique(trainer_id) sozinho não barra múltiplos nulls no Postgres.
create unique index anamnese_templates_um_padrao_idx on anamnese_templates ((true)) where trainer_id is null;

alter table anamnese_templates enable row level security;

create policy "leitura ampla dos templates de anamnese"
  on anamnese_templates for select
  using (
    trainer_id is null
    or trainer_id = auth.uid()
    or exists (
      select 1 from clientes
      where clientes.auth_user_id = auth.uid() and clientes.trainer_id = anamnese_templates.trainer_id
    )
  );

create policy "admin gerencia a anamnese padrao do sistema"
  on anamnese_templates for all
  using (trainer_id is null and exists (select 1 from trainers where trainers.id = auth.uid() and trainers.is_admin))
  with check (trainer_id is null and exists (select 1 from trainers where trainers.id = auth.uid() and trainers.is_admin));

create policy "trainer gerencia sua propria personalizacao de anamnese"
  on anamnese_templates for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

create table anamnese_respostas_dinamicas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null unique references clientes(id) on delete cascade,
  trainer_id uuid not null references trainers(id) on delete cascade,
  respostas jsonb not null default '{}'::jsonb,
  respondido_em timestamptz,
  updated_at timestamptz not null default now()
);

alter table anamnese_respostas_dinamicas enable row level security;

create policy "trainer ve e edita respostas dinamicas dos seus alunos"
  on anamnese_respostas_dinamicas for all
  using (trainer_id = auth.uid())
  with check (trainer_id = auth.uid());

create policy "aluno preenche e ve suas proprias respostas dinamicas"
  on anamnese_respostas_dinamicas for all
  using (exists (select 1 from clientes where clientes.id = anamnese_respostas_dinamicas.cliente_id and clientes.auth_user_id = auth.uid()))
  with check (exists (select 1 from clientes where clientes.id = anamnese_respostas_dinamicas.cliente_id and clientes.auth_user_id = auth.uid()));

-- Anamnese padrão do sistema (trainer_id null) — base que todo profissional
-- usa até personalizar a própria versão (que nasce como cópia desta).
insert into anamnese_templates (trainer_id, estrutura) values (null, '{"secoes": [{"id": "profissao_atividade", "titulo": "Profissão e atividade", "ordem": 1}, {"id": "rotina_treino", "titulo": "Rotina de treinos e atividade física", "ordem": 2}, {"id": "tempo_disponivel", "titulo": "Tempo disponível para atividade física", "ordem": 3}, {"id": "saude", "titulo": "Dores, lesões e saúde", "ordem": 4}, {"id": "horarios", "titulo": "Horários de costume", "ordem": 5}, {"id": "alimentacao_habitos", "titulo": "Seus hábitos alimentares", "ordem": 6}, {"id": "restricoes_preferencias", "titulo": "Restrições e preferências alimentares", "ordem": 7}, {"id": "suplementacao", "titulo": "Suplementação", "ordem": 8}], "perguntas": [{"id": "nivel_atividade_profissional", "secao_id": "profissao_atividade", "tipo": "escolha_unica", "label": "Na sua profissão, qual é o nível da sua atividade?", "obrigatoria": true, "ordem": 1, "opcoes": [{"valor": "pouco_ativa", "label": "Pouco ativa — o tempo todo sentado"}, {"valor": "razoavelmente_ativa", "label": "Razoavelmente ativa — durante o dia varia entre sentado e em pé"}, {"valor": "muito_ativa", "label": "Muito ativa — em pé ou caminhando a maior parte do tempo"}]}, {"id": "atividades_fisicas", "secao_id": "rotina_treino", "tipo": "lista_pares", "label": "Qual tipo de atividade física você pratica e com qual frequência?", "obrigatoria": false, "ordem": 1, "subcampos": [{"key": "tipo", "label": "Tipo de atividade (ex: corrida, futebol...)"}, {"key": "frequencia", "label": "Frequência (ex: 3x por semana)"}]}, {"id": "disponibilidade_musculacao", "secao_id": "rotina_treino", "tipo": "escolha_unica", "label": "Qual a sua disponibilidade para treinar musculação na semana?", "obrigatoria": true, "ordem": 2, "opcoes": [{"valor": "1x", "label": "1 vez por semana"}, {"valor": "2x", "label": "2 vezes por semana"}, {"valor": "3x", "label": "3 vezes por semana"}, {"valor": "4x", "label": "4 vezes por semana"}, {"valor": "5x", "label": "5 vezes por semana"}, {"valor": "6x", "label": "6 vezes por semana"}, {"valor": "7x", "label": "7 vezes por semana"}]}, {"id": "exercicios_gosta", "secao_id": "rotina_treino", "tipo": "texto_longo", "label": "Na musculação, quais exercícios você gosta de fazer?", "obrigatoria": false, "ordem": 3}, {"id": "exercicios_odeia", "secao_id": "rotina_treino", "tipo": "texto_longo", "label": "Na musculação, quais exercícios você odeia fazer?", "obrigatoria": false, "ordem": 4}, {"id": "incomodo_fisico", "secao_id": "rotina_treino", "tipo": "texto_longo", "label": "O que mais te incomoda fisicamente?", "obrigatoria": false, "ordem": 5}, {"id": "musculos_prioridade", "secao_id": "rotina_treino", "tipo": "texto_longo", "label": "Quais músculos você tem como prioridade melhorar?", "obrigatoria": false, "ordem": 6}, {"id": "tempo_disponivel_treino", "secao_id": "tempo_disponivel", "tipo": "escolha_unica", "label": "Quanto tempo você dispõe para realizar suas atividades físicas?", "obrigatoria": true, "ordem": 1, "opcoes": [{"valor": "ate_45min", "label": "Até 45 minutos"}, {"valor": "ate_60min", "label": "Até 60 minutos"}, {"valor": "ate_90min", "label": "Até 90 minutos"}, {"valor": "mais_90min", "label": "Mais de 90 minutos"}]}, {"id": "dores_articulares", "secao_id": "saude", "tipo": "escolha_unica", "label": "Durante as atividades ou na sua rotina, você sente dores articulares?", "obrigatoria": true, "ordem": 1, "opcoes": [{"valor": "nao", "label": "Não"}, {"valor": "sim", "label": "Sim"}]}, {"id": "dor_onde", "secao_id": "saude", "tipo": "texto", "label": "Onde sente dor?", "obrigatoria": false, "ordem": 2, "depende_de": {"pergunta_id": "dores_articulares", "valores": ["sim"]}}, {"id": "dor_quando", "secao_id": "saude", "tipo": "texto_longo", "label": "Quando sente essa dor?", "obrigatoria": false, "ordem": 3, "depende_de": {"pergunta_id": "dores_articulares", "valores": ["sim"]}}, {"id": "ja_lesionou", "secao_id": "saude", "tipo": "escolha_unica", "label": "Já lesionou alguma parte do corpo?", "obrigatoria": true, "ordem": 4, "opcoes": [{"valor": "nao", "label": "Não"}, {"valor": "sim", "label": "Sim"}]}, {"id": "lesao_detalhe", "secao_id": "saude", "tipo": "texto_longo", "label": "Qual parte do corpo foi lesionada e o que aconteceu?", "obrigatoria": false, "ordem": 5, "depende_de": {"pergunta_id": "ja_lesionou", "valores": ["sim"]}}, {"id": "problema_saude", "secao_id": "saude", "tipo": "escolha_unica", "label": "Tem algum problema de saúde?", "obrigatoria": true, "ordem": 6, "opcoes": [{"valor": "nao", "label": "Não"}, {"valor": "sim", "label": "Sim"}]}, {"id": "problema_saude_detalhe", "secao_id": "saude", "tipo": "texto_longo", "label": "Qual problema de saúde?", "obrigatoria": false, "ordem": 7, "depende_de": {"pergunta_id": "problema_saude", "valores": ["sim"]}}, {"id": "sintomas_atividade", "secao_id": "saude", "tipo": "escolha_multipla", "label": "Durante as atividades físicas, você já sentiu:", "obrigatoria": true, "ordem": 8, "opcoes": [{"valor": "dor_peito", "label": "Dor no peito"}, {"valor": "tontura", "label": "Tontura"}, {"valor": "desmaio", "label": "Desmaio"}, {"valor": "nenhum", "label": "Não, nunca senti nenhum desses sintomas"}]}, {"id": "sintomas_detalhe", "secao_id": "saude", "tipo": "texto_longo", "label": "Descreva o que aconteceu.", "obrigatoria": false, "ordem": 9, "depende_de": {"pergunta_id": "sintomas_atividade", "valores": ["dor_peito", "tontura", "desmaio"]}}, {"id": "horario_acordar", "secao_id": "horarios", "tipo": "horario", "label": "Horário habitual de acordar", "obrigatoria": false, "ordem": 1}, {"id": "horario_dormir", "secao_id": "horarios", "tipo": "horario", "label": "Horário habitual de dormir", "obrigatoria": false, "ordem": 2}, {"id": "horario_treino", "secao_id": "horarios", "tipo": "horario", "label": "Horário habitual de treinar", "obrigatoria": false, "ordem": 3}, {"id": "horarios_variacao", "secao_id": "horarios", "tipo": "texto_longo", "label": "Caso tenha horários diferentes dependendo do dia, descreva a variação", "obrigatoria": false, "ordem": 4}, {"id": "cafe_manha_horario", "secao_id": "alimentacao_habitos", "tipo": "horario", "label": "Horário — Café da manhã", "obrigatoria": false, "ordem": 1}, {"id": "cafe_manha_consumo", "secao_id": "alimentacao_habitos", "tipo": "texto_longo", "label": "O que costuma consumir no(a) Café da manhã?", "obrigatoria": false, "ordem": 2}, {"id": "lanche_manha_horario", "secao_id": "alimentacao_habitos", "tipo": "horario", "label": "Horário — Lanche da manhã", "obrigatoria": false, "ordem": 3}, {"id": "lanche_manha_consumo", "secao_id": "alimentacao_habitos", "tipo": "texto_longo", "label": "O que costuma consumir no(a) Lanche da manhã?", "obrigatoria": false, "ordem": 4}, {"id": "almoco_horario", "secao_id": "alimentacao_habitos", "tipo": "horario", "label": "Horário — Almoço", "obrigatoria": false, "ordem": 5}, {"id": "almoco_consumo", "secao_id": "alimentacao_habitos", "tipo": "texto_longo", "label": "O que costuma consumir no(a) Almoço?", "obrigatoria": false, "ordem": 6}, {"id": "lanche_tarde_horario", "secao_id": "alimentacao_habitos", "tipo": "horario", "label": "Horário — Lanche da tarde", "obrigatoria": false, "ordem": 7}, {"id": "lanche_tarde_consumo", "secao_id": "alimentacao_habitos", "tipo": "texto_longo", "label": "O que costuma consumir no(a) Lanche da tarde?", "obrigatoria": false, "ordem": 8}, {"id": "jantar_horario", "secao_id": "alimentacao_habitos", "tipo": "horario", "label": "Horário — Jantar", "obrigatoria": false, "ordem": 9}, {"id": "jantar_consumo", "secao_id": "alimentacao_habitos", "tipo": "texto_longo", "label": "O que costuma consumir no(a) Jantar?", "obrigatoria": false, "ordem": 10}, {"id": "ceia_horario", "secao_id": "alimentacao_habitos", "tipo": "horario", "label": "Horário — Ceia", "obrigatoria": false, "ordem": 11}, {"id": "ceia_consumo", "secao_id": "alimentacao_habitos", "tipo": "texto_longo", "label": "O que costuma consumir no(a) Ceia?", "obrigatoria": false, "ordem": 12}, {"id": "alimento_nao_consome", "secao_id": "restricoes_preferencias", "tipo": "texto_longo", "label": "Qual alimento você não consome por intolerância, alergia ou paladar?", "obrigatoria": false, "ordem": 1}, {"id": "motivo_nao_consome", "secao_id": "restricoes_preferencias", "tipo": "escolha_unica", "label": "Motivo", "obrigatoria": false, "ordem": 2, "opcoes": [{"valor": "intolerancia", "label": "Intolerância"}, {"valor": "alergia", "label": "Alergia"}, {"valor": "nao_gosto", "label": "Não gosto do sabor"}, {"valor": "outro", "label": "Outro"}]}, {"id": "alimentos_nao_retirar", "secao_id": "restricoes_preferencias", "tipo": "texto_longo", "label": "Quais alimentos você não gostaria que fossem retirados do seu dia a dia?", "obrigatoria": false, "ordem": 3}, {"id": "bebida_alcoolica", "secao_id": "restricoes_preferencias", "tipo": "escolha_unica", "label": "Você ingere bebidas alcoólicas?", "obrigatoria": true, "ordem": 4, "opcoes": [{"valor": "nao", "label": "Não"}, {"valor": "sim", "label": "Sim"}]}, {"id": "consome_acucar", "secao_id": "restricoes_preferencias", "tipo": "escolha_unica", "label": "Você consome açúcar/doces?", "obrigatoria": true, "ordem": 5, "opcoes": [{"valor": "nao", "label": "Não"}, {"valor": "sim", "label": "Sim"}]}, {"id": "acucar_detalhe", "secao_id": "restricoes_preferencias", "tipo": "texto", "label": "Frequência ou quantidade (opcional)", "obrigatoria": false, "ordem": 6, "depende_de": {"pergunta_id": "consome_acucar", "valores": ["sim"]}}, {"id": "usa_suplemento", "secao_id": "suplementacao", "tipo": "escolha_unica", "label": "Faz uso de algum suplemento alimentar?", "obrigatoria": true, "ordem": 1, "opcoes": [{"valor": "nao", "label": "Não"}, {"valor": "sim", "label": "Sim"}]}, {"id": "quais_suplementos", "secao_id": "suplementacao", "tipo": "texto_longo", "label": "Quais suplementos você utiliza?", "obrigatoria": false, "ordem": 2, "depende_de": {"pergunta_id": "usa_suplemento", "valores": ["sim"]}}]}'::jsonb);
