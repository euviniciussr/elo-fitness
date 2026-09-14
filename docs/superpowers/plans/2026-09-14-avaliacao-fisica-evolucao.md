# Avaliação Física — evolução para histórico + gráficos + PDF

> Spec bruta do usuário, registrada em 2026-09-14 para implementação futura.
> Ainda NÃO implementado — anotado a pedido do usuário enquanto a tarefa
> anterior (anamnese obrigatória no onboarding) estava sendo finalizada.

## Requisito

Ver texto completo do usuário abaixo. Resumo executivo antes de implementar:

- **Não alterar** a metodologia de cálculo existente (Jackson & Pollock 7
  dobras + Siri) nem quebrar nada do que já funciona.
- Nomenclatura: usar sempre **"Massa livre de gordura"**, nunca "massa
  muscular" como sinônimo — corrigir em todo lugar que já usa o termo errado,
  sem tocar no cálculo.
- Cada avaliação física deve virar um **registro histórico imutável**
  (snapshot), não mais um upsert que sobrescreve o anterior. Precisa migrar/
  compatibilizar o que já existe no banco sem duplicar nem perder dado.
- Tela do profissional (dentro de `aluno-detalhe.html`) e tela nova do aluno
  (dentro de `app-aluno.html`) devem ler da **mesma fonte de dados** — não
  duplicar registros só para exibição do aluno.
- Gráfico de composição corporal com métricas selecionáveis (% gordura /
  massa de gordura / massa livre de gordura) em vez de 3 escalas no mesmo
  gráfico — e um gráfico separado só de peso.
- Resumo "desde a primeira avaliação" (diffs, % gordura em pontos
  percentuais, não % relativo) + tabela "primeira x atual".
- Histórico ordenado do mais recente pro mais antigo, cada item abre os
  detalhes completos daquela avaliação específica.
- PDF: mesmo gerador/modelo para aluno e profissional; PDF de uma avaliação
  antiga usa os dados DAQUELA data, nunca os dados atuais do aluno; se for
  simples dentro da estrutura atual, também um "PDF de evolução" separado.
  Compartilhamento via mecanismo nativo do dispositivo (Web Share API no
  navegador/mobile; download normal no desktop) — sem integração externa
  tipo WhatsApp API.
- Segurança: aluno só vê as próprias avaliações, profissional só vê alunos
  vinculados a ele — validado no **backend/RLS**, não só na UI. Testar
  acesso direto por ID/URL pra confirmar que não é só bloqueio visual.
- Integridade: editar a anamnese (ex: peso atual) não pode alterar
  retroativamente avaliações físicas antigas já registradas. Ao criar uma
  avaliação nova, copiar peso/altura/sexo/idade da anamnese pro novo
  registro, mas depois de criado o registro fica independente.
- Responsivo (celular/tablet/desktop), visual "profissional, limpo,
  moderno, premium, esportivo" — poucas cores, boa hierarquia, números em
  destaque.

## Testes obrigatórios (10, ver spec completa)

Nova avaliação com cálculo correto · histórico com 3 avaliações sem
sobrescrever · gráfico com os 3 pontos corretos por métrica · nova avaliação
não altera antiga · editar anamnese não altera avaliação antiga · PDF do
profissional correto · PDF do aluno idêntico ao do profissional · segurança
(aluno A não vê aluno B, profissional A não vê aluno de B, inclusive via
URL/API direta) · PDF de avaliação antiga mostra dados antigos · responsivo.

## Contexto técnico já conhecido (deste repo, antes de começar)

- Avaliação física hoje vive em `aluno-detalhe.html` (tabela
  `avaliacoes_fisicas`, ver grep por `avaliacoes_fisicas` nesse arquivo e em
  `app-aluno.html`) — precisa ler o schema atual antes de desenhar a
  migração de histórico (já pode ser que cada linha seja um registro por
  data e o "histórico" já exista parcialmente; verificar antes de assumir
  que é upsert único).
- `anamnese_respostas` guarda sexo/idade/altura_cm/peso_kg (fixo, alimenta
  TMB/GET) — é dali que o preenchimento automático deve copiar ao criar uma
  avaliação nova, per [[project_anamnese_dinamica]].
- Padrão do projeto pra telas novas do aluno: só `app-aluno.html` e
  `anamnese.html` são páginas do aluno hoje (confirmado na sessão de
  2026-09-14) — a evolução da "visão do aluno" provavelmente entra como
  nova aba dentro de `app-aluno.html`, não uma página nova, pra manter esse
  padrão (a confirmar com o usuário se preferir diferente).
- Geração de PDF: não há gerador de PDF no projeto ainda (a confirmar) —
  precisa escolher biblioteca client-side (ex: jsPDF) antes de desenhar o
  "mesmo componente de relatório" compartilhado entre aluno e profissional.
- RLS: seguir o padrão trainer-scoped já usado em outras tabelas
  (`trainer_id = auth.uid()` pro profissional, `clientes.auth_user_id =
  auth.uid()` pro aluno via join) — ver [[project_admin_role_and_treino_tracking]]
  pro padrão de policy já estabelecido.

## Texto original completo do usuário

Preservado abaixo, verbatim, pra não perder nenhum detalhe da spec quando
essa tarefa for retomada.

---

PRECISO FAZER UMA EVOLUÇÃO COMPLETA NO MÓDULO DE "AVALIAÇÃO FÍSICA".

IMPORTANTE:
Não alterar, remover ou quebrar nenhuma funcionalidade existente do aplicativo.
Os cálculos atuais de avaliação física devem ser preservados.
Essa implementação deve aproveitar a estrutura atual de Avaliação Física e evoluí-la para permitir HISTÓRICO + GRÁFICOS + PDF + VISUALIZAÇÃO PELO ALUNO E PELO PROFISSIONAL.

==================================================
1. OBJETIVO PRINCIPAL
==================================================

Quero transformar a Avaliação Física em um histórico de composição corporal do aluno.

Hoje já temos a avaliação física com os dados necessários para calcular:

- Percentual de gordura
- Massa de gordura
- Massa livre de gordura

IMPORTANTE SOBRE NOMENCLATURA:

Não utilizar "massa muscular" como sinônimo de massa livre de gordura.

O termo correto na interface deve ser:

"Massa livre de gordura"

A massa livre de gordura NÃO deve ser apresentada como "massa muscular", porque são conceitos diferentes.

A massa livre de gordura representa tudo que não é gordura corporal, incluindo músculo, água, órgãos, ossos etc.

Portanto:

% de gordura = percentual de gordura corporal
Massa de gordura = quantidade estimada de gordura corporal em kg
Massa livre de gordura = peso corporal - massa de gordura

==================================================
2. MANTER OS CÁLCULOS ATUAIS
==================================================

NÃO alterar a metodologia de cálculo que já existe no sistema.

A avaliação deve continuar utilizando Jackson & Pollock — 7 dobras + Siri.

Dobras:

1. Peitoral
2. Axilar média
3. Tríceps
4. Subescapular
5. Supra-ilíaca
6. Abdominal
7. Coxa

Valores em milímetros.

Somar automaticamente as 7 dobras.

Para homens:

DC = 1.112 − (0.00043499 × soma das 7 dobras) + (0.00000055 × soma das 7 dobras²) − (0.00028826 × idade)

Para mulheres:

DC = 1.097 − (0.00046971 × soma das 7 dobras) + (0.00000056 × soma das 7 dobras²) − (0.00012828 × idade)

Percentual de gordura pelo método de Siri:

% gordura = (495 ÷ DC) − 450

Massa de gordura:

massa de gordura = peso × (% gordura ÷ 100)

Massa livre de gordura:

massa livre de gordura = peso − massa de gordura

IMPORTANTE:

Não arredondar os valores internamente antes de realizar os cálculos seguintes.

Os arredondamentos devem ser feitos somente na apresentação.

Exemplo de apresentação:

% gordura: 18,4%
Massa de gordura: 19,2 kg
Massa livre de gordura: 84,1 kg

==================================================
3. CADA AVALIAÇÃO DEVE SER UM REGISTRO HISTÓRICO
==================================================

Esse ponto é MUITO importante.

Uma nova avaliação NÃO pode sobrescrever a avaliação anterior.

Cada avaliação física deve possuir seu próprio registro histórico.

Cada registro deve estar vinculado a:

- aluno
- profissional responsável
- data da avaliação
- peso
- altura
- sexo
- idade
- 7 dobras cutâneas
- soma das dobras
- densidade corporal
- percentual de gordura
- massa de gordura
- massa livre de gordura

A avaliação deve representar um "snapshot" daquele momento.

Se o aluno fizer uma nova avaliação daqui a 30 dias, a avaliação anterior deve continuar exatamente como estava.

Exemplo:

14/07/2026
Peso: 107 kg
Gordura: 23,0%
Massa de gordura: 24,6 kg
Massa livre de gordura: 82,4 kg

14/08/2026
Peso: 105 kg
Gordura: 20,8%
Massa de gordura: 21,8 kg
Massa livre de gordura: 83,2 kg

14/09/2026
Peso: 103,3 kg
Gordura: 18,4%
Massa de gordura: 19,2 kg
Massa livre de gordura: 84,1 kg

As três avaliações devem permanecer disponíveis.

==================================================
4. TELA DE AVALIAÇÃO FÍSICA — PROFISSIONAL
==================================================

No lado do profissional, manter a tela atual de avaliação física, mas acrescentar:

- Histórico de avaliações
- Gráficos de evolução
- Resumo da evolução
- Botão "Gerar PDF"

O profissional deve conseguir:

1. Criar nova avaliação
2. Visualizar avaliação atual
3. Visualizar avaliações anteriores
4. Abrir uma avaliação específica
5. Visualizar os cálculos daquela avaliação
6. Visualizar os gráficos
7. Gerar o PDF da avaliação atual
8. Gerar o PDF de uma avaliação específica do histórico

==================================================
5. TELA DE AVALIAÇÃO FÍSICA — ALUNO
==================================================

O aluno também deve ter acesso à própria Avaliação Física dentro do aplicativo.

O aluno deve conseguir visualizar:

- Avaliação atual
- Histórico de avaliações
- Peso
- Percentual de gordura
- Massa de gordura
- Massa livre de gordura
- Gráficos de evolução
- Data de cada avaliação
- Detalhes de cada avaliação

O aluno também deve ter o botão:

"Gerar PDF"

O aluno deve conseguir gerar o PDF da mesma forma que o profissional.

IMPORTANTE:

O PDF gerado pelo aluno deve ser EXATAMENTE o mesmo modelo de PDF que o profissional consegue gerar.

Não criar dois modelos diferentes.

Utilizar o mesmo gerador/componente de relatório.

O aluno só pode acessar as próprias avaliações.

Nunca permitir que um aluno consiga acessar dados de outro aluno.

Essa regra deve existir também no backend, não apenas na interface.

==================================================
6. MODELO DOS GRÁFICOS
==================================================

Quero que os gráficos tenham aparência profissional, limpa e premium.

NÃO colocar as três métricas em uma única escala de gráfico.

Como percentual e kg possuem escalas diferentes, isso pode gerar uma leitura ruim.

A solução preferida é utilizar UM gráfico de evolução com métricas selecionáveis.

Título:

"Evolução da composição corporal"

Abaixo do título, colocar filtros/abas:

[ % Gordura ] [ Massa de gordura ] [ Massa livre de gordura ]

Ao selecionar:

% Gordura

O gráfico mostra somente a evolução percentual.

Exemplo:

20,5% → 19,8% → 18,9% → 18,4%

Ao selecionar:

Massa de gordura

Mostrar:

22,1 kg → 20,8 kg → 19,7 kg → 19,2 kg

Ao selecionar:

Massa livre de gordura

Mostrar:

82,4 kg → 83,6 kg → 84,5 kg → 84,1 kg

O eixo horizontal representa a DATA DA AVALIAÇÃO.

Cada avaliação deve ser um ponto do gráfico.

Ao tocar/clicar em um ponto, mostrar um tooltip/card com:

Data da avaliação
Valor da métrica
Peso da avaliação

Exemplo:

14/09/2026
Gordura corporal: 18,4%
Peso: 103,3 kg

O gráfico deve ser responsivo e funcionar corretamente no celular e desktop.

==================================================
7. GRÁFICO DE PESO
==================================================

Além do gráfico de composição corporal, criar um gráfico separado:

"Evolução do peso"

Mostrar o peso em kg ao longo das avaliações.

Exemplo:

107 kg → 105 kg → 103,3 kg

Não misturar o peso com percentual de gordura no mesmo gráfico.

Isso deixa a leitura muito mais profissional.

==================================================
8. RESUMO DA EVOLUÇÃO
==================================================

Abaixo dos gráficos, criar uma área:

"Desde a primeira avaliação"

Calcular automaticamente a diferença entre:

- primeira avaliação registrada
- avaliação atual/mais recente

Mostrar:

Peso
% de gordura
Massa de gordura
Massa livre de gordura

Exemplo:

DESDE A PRIMEIRA AVALIAÇÃO

Peso
↓ 3,7 kg

Percentual de gordura
↓ 4,6 p.p.

Massa de gordura
↓ 5,4 kg

Massa livre de gordura
↑ 1,7 kg

IMPORTANTE:

Para percentual de gordura, mostrar a diferença em PONTOS PERCENTUAIS (p.p.), e não como porcentagem relativa.

Exemplo:

23,0% → 18,4%

Mostrar:

-4,6 p.p.

Não mostrar:

-20%

==================================================
9. COMPARAÇÃO ENTRE PRIMEIRA E ÚLTIMA AVALIAÇÃO
==================================================

Criar também uma área:

"Primeira avaliação x Avaliação atual"

Tabela:

                     PRIMEIRA     ATUAL       DIFERENÇA

Peso                  107 kg       103,3 kg    -3,7 kg
% gordura             23,0%        18,4%       -4,6 p.p.
Massa de gordura      24,6 kg      19,2 kg     -5,4 kg
Massa livre gordura   82,4 kg      84,1 kg     +1,7 kg

Os valores devem ser calculados automaticamente com base nos registros reais.

Não inserir valores fictícios.

==================================================
10. HISTÓRICO DE AVALIAÇÕES
==================================================

Criar uma seção:

"Histórico de avaliações"

Ordenar da mais recente para a mais antiga.

Cada item pode mostrar:

14/09/2026
103,3 kg · 18,4% gordura · 19,2 kg gordura · 84,1 kg MLG

14/08/2026
105 kg · 20,8% gordura · 21,8 kg gordura · 83,2 kg MLG

14/07/2026
107 kg · 23,0% gordura · 24,6 kg gordura · 82,4 kg MLG

Ao clicar em uma avaliação:

Abrir todos os detalhes daquela avaliação.

==================================================
11. DETALHES DE UMA AVALIAÇÃO
==================================================

Ao abrir uma avaliação específica, mostrar:

AVALIAÇÃO FÍSICA

Data

Dados antropométricos:

- Peso
- Altura
- Sexo
- Idade

7 dobras:

- Peitoral
- Axilar média
- Tríceps
- Subescapular
- Supra-ilíaca
- Abdominal
- Coxa

Mostrar:

- Soma das 7 dobras
- Densidade corporal
- Percentual de gordura
- Massa de gordura
- Massa livre de gordura

Adicionar:

"Gerar PDF"

==================================================
12. PDF — MODELO PROFISSIONAL
==================================================

Criar um relatório PDF com aparência profissional.

Não quero um simples "print" da tela.

Quero um documento estruturado.

Título:

AVALIAÇÃO FÍSICA

Subtítulo:

RELATÓRIO DE COMPOSIÇÃO CORPORAL

Informações:

Nome do aluno
Data da avaliação
Profissional responsável

--------------------------------------------------

BLOCO 1 — RESUMO

Peso
% Gordura
Massa de gordura
Massa livre de gordura

--------------------------------------------------

BLOCO 2 — EVOLUÇÃO

Adicionar gráfico de evolução da composição corporal.

Preferencialmente mostrar o gráfico da métrica selecionada ou, no PDF, apresentar gráficos separados de:

- % gordura
- Massa de gordura
- Massa livre de gordura

Não misturar escalas incompatíveis.

Adicionar também gráfico de evolução do peso.

--------------------------------------------------

BLOCO 3 — EVOLUÇÃO DESDE A PRIMEIRA AVALIAÇÃO

Mostrar:

Peso
% gordura
Massa de gordura
Massa livre de gordura

Com as diferenças calculadas automaticamente.

--------------------------------------------------

BLOCO 4 — AVALIAÇÃO DETALHADA

Dados antropométricos:

Peso
Altura
Sexo
Idade

Dobras cutâneas:

Peitoral
Axilar média
Tríceps
Subescapular
Supra-ilíaca
Abdominal
Coxa

Soma das dobras.

Resultados:

Densidade corporal
Percentual de gordura
Massa de gordura
Massa livre de gordura

--------------------------------------------------

RODAPÉ

Método utilizado:
Jackson & Pollock — 7 dobras cutâneas + equação de Siri.

IMPORTANTE:

Não inserir interpretação médica ou diagnóstico automático.

O relatório deve apresentar os dados e cálculos da avaliação.

==================================================
13. PDF DO HISTÓRICO
==================================================

Quando o profissional ou aluno gerar o PDF de uma avaliação específica:

O PDF deve representar aquela avaliação naquela data.

Não substituir os dados históricos pelos dados atuais do aluno.

Exemplo:

Se eu abrir a avaliação de julho, o PDF deve mostrar o peso, idade e dobras registrados em julho.

Mesmo que hoje o aluno esteja com outro peso ou idade.

==================================================
14. PDF DA EVOLUÇÃO
==================================================

Além do PDF de uma avaliação individual, se for simples implementar dentro da estrutura atual, criar também a opção:

"Gerar relatório de evolução"

Esse relatório deve apresentar:

- Primeira avaliação
- Avaliação atual
- Histórico
- Gráfico de evolução
- Diferença de peso
- Diferença de percentual de gordura
- Diferença de massa de gordura
- Diferença de massa livre de gordura

Esse relatório deve ser especialmente útil para o profissional enviar ao aluno.

Se a implementação exigir dois tipos de PDF, manter:

"PDF da avaliação"

e

"PDF da evolução"

==================================================
15. COMPARTILHAMENTO DO PDF
==================================================

Depois de gerar o PDF, permitir o compartilhamento pelo recurso nativo do dispositivo quando disponível.

No celular:

Abrir o compartilhamento nativo do sistema, permitindo escolher:

- WhatsApp
- E-mail
- Arquivos
- Outros aplicativos disponíveis

No desktop/web:

Permitir baixar/abrir o PDF normalmente.

IMPORTANTE:

Não criar integração externa com WhatsApp se isso não existir atualmente.

O objetivo é permitir que o arquivo PDF seja compartilhado pelo mecanismo nativo disponível no dispositivo.

==================================================
16. PERMISSÕES
==================================================

PROFISSIONAL:

Pode:

- criar avaliação para seus alunos
- visualizar avaliações dos seus alunos
- visualizar histórico
- visualizar gráficos
- gerar PDF
- gerar relatório de evolução

ALUNO:

Pode:

- visualizar suas próprias avaliações
- visualizar seu próprio histórico
- visualizar seus próprios gráficos
- gerar PDF
- gerar relatório de evolução

ALUNO NÃO PODE:

- editar avaliação feita pelo profissional
- excluir avaliação do profissional
- visualizar avaliação de outro aluno
- acessar dados de outro profissional

IMPORTANTE:

As permissões precisam ser validadas no backend.

Não confiar apenas na interface.

==================================================
17. INTEGRIDADE HISTÓRICA
==================================================

Uma nova avaliação nunca deve alterar uma avaliação antiga.

Também tomar cuidado com dados da anamnese.

Se o peso atual da anamnese mudar:

NÃO alterar automaticamente o peso registrado em uma avaliação física antiga.

Cada avaliação física deve manter seus próprios dados.

Exemplo:

Avaliação 01:
Peso = 100 kg

Depois o aluno atualiza a anamnese:
Peso = 95 kg

A Avaliação 01 continua:

Peso = 100 kg

==================================================
18. PREENCHIMENTO AUTOMÁTICO
==================================================

Manter a lógica existente em que dados como:

- peso
- altura
- sexo
- idade

podem ser preenchidos automaticamente a partir da anamnese quando disponíveis.

Porém:

Ao criar uma nova avaliação, esses valores devem ser copiados para o novo registro.

Depois de criada a avaliação, os dados daquela avaliação ficam independentes.

Se o profissional editar peso/altura/idade dentro da nova avaliação, isso não deve alterar retroativamente a anamnese nem avaliações antigas.

==================================================
19. RESPONSIVIDADE
==================================================

A interface precisa funcionar bem:

- celular
- tablet
- desktop

No celular, os gráficos devem ser fáceis de tocar e interpretar.

Cards e informações devem se reorganizar verticalmente.

O PDF também precisa ter boa leitura em celular quando enviado pelo WhatsApp.

==================================================
20. EXPERIÊNCIA VISUAL
==================================================

Quero uma aparência:

- profissional
- limpa
- moderna
- premium
- esportiva
- fácil de entender

Evitar excesso de cores, gráficos poluídos ou elementos desnecessários.

Priorizar:

- tipografia clara
- bastante espaço
- cards objetivos
- números de destaque
- gráficos limpos
- hierarquia visual forte

O aluno deve bater o olho e entender rapidamente:

"Como eu estava?"
"Como estou agora?"
"O que mudou?"

==================================================
21. IMPORTANTE SOBRE MASSA LIVRE DE GORDURA
==================================================

Em TODOS os locais do sistema, usar:

"Massa livre de gordura"

Não utilizar:

"Massa muscular"

como substituição automática.

Se houver algum texto existente chamando MLG de "massa muscular", corrigir somente a nomenclatura.

Não alterar o cálculo.

==================================================
22. COMPATIBILIDADE COM A ESTRUTURA EXISTENTE
==================================================

Não remover:

- avaliação física atual
- campos atuais
- cálculos atuais
- metodologia atual
- integração com anamnese
- histórico existente
- demais módulos do aplicativo

A nova funcionalidade deve ser adicionada sobre a estrutura existente.

Se já existir algum histórico ou registro de avaliação física no banco, migrar/compatibilizar esses registros para o novo histórico sem perda de dados.

NÃO duplicar avaliações antigas.

==================================================
23. SEGURANÇA E ISOLAMENTO DE DADOS
==================================================

Garantir que:

Profissional A só veja os alunos vinculados a ele.

Profissional B não tenha acesso às avaliações dos alunos do Profissional A.

Aluno A só veja suas próprias avaliações.

Aluno B não consiga consultar dados do Aluno A alterando IDs ou parâmetros da URL/API.

Validar autorização no backend/API em todas as operações:

- consultar avaliação
- consultar histórico
- gerar PDF
- consultar gráficos
- criar avaliação
- editar avaliação

==================================================
24. TESTES OBRIGATÓRIOS
==================================================

Antes de considerar concluído, testar:

TESTE 1 — NOVA AVALIAÇÃO

Criar avaliação com:

Peso
Altura
Sexo
Idade
7 dobras

Confirmar cálculo de:

- soma das dobras
- densidade corporal
- % gordura
- massa de gordura
- massa livre de gordura

--------------------------------------------------

TESTE 2 — HISTÓRICO

Criar 3 avaliações em datas diferentes.

Confirmar que:

- as 3 aparecem no histórico
- nenhuma sobrescreve outra
- cada uma mantém seus próprios dados

--------------------------------------------------

TESTE 3 — GRÁFICO

Com 3 avaliações:

Confirmar que o gráfico apresenta os 3 pontos.

Testar:

% gordura
Massa de gordura
Massa livre de gordura
Peso

Confirmar que os valores correspondem exatamente às avaliações.

--------------------------------------------------

TESTE 4 — NOVA AVALIAÇÃO NÃO ALTERA ANTIGA

Alterar peso e dobras em uma nova avaliação.

Confirmar que a avaliação antiga continua com os valores originais.

--------------------------------------------------

TESTE 5 — ANAMNESE

Alterar peso na anamnese.

Confirmar que avaliações físicas antigas NÃO são alteradas.

--------------------------------------------------

TESTE 6 — PDF PROFISSIONAL

Profissional gera PDF.

Confirmar:

- nome correto do aluno
- data correta
- valores corretos
- cálculos corretos
- gráficos corretos
- histórico correto
- nomenclatura "massa livre de gordura"
- PDF abre normalmente

--------------------------------------------------

TESTE 7 — PDF ALUNO

Aluno entra em Avaliação Física.

Confirmar que consegue:

- visualizar avaliação
- visualizar histórico
- visualizar gráficos
- gerar PDF

Confirmar que o PDF gerado pelo aluno possui o mesmo padrão do PDF gerado pelo profissional.

--------------------------------------------------

TESTE 8 — SEGURANÇA

Criar dois alunos.

Confirmar que:

Aluno A não consegue acessar avaliação do Aluno B.

Criar dois profissionais.

Confirmar que:

Profissional A não consegue acessar avaliação de aluno vinculado ao Profissional B.

Testar também acesso direto via URL/API/ID para garantir que a proteção não seja apenas visual.

--------------------------------------------------

TESTE 9 — PDF DE AVALIAÇÃO ANTIGA

Criar uma avaliação em julho.

Criar outra em setembro.

Abrir a avaliação de julho e gerar PDF.

Confirmar que o PDF contém os dados de julho, e não os dados atuais.

--------------------------------------------------

TESTE 10 — RESPONSIVIDADE

Testar no:

- iPhone/celular
- tablet
- desktop

Confirmar que:

- gráficos não quebram
- cards não ficam cortados
- histórico funciona
- botão Gerar PDF funciona
- compartilhamento funciona quando suportado pelo dispositivo

==================================================
25. RESULTADO FINAL ESPERADO
==================================================

Quero que Avaliação Física deixe de ser apenas uma tela de cálculo e passe a funcionar como um verdadeiro módulo de acompanhamento da composição corporal.

O fluxo final deve ser:

PROFISSIONAL:

Alunos → Aluno → Avaliação Física

→ Criar avaliação
→ Salvar avaliação
→ Calcular composição corporal
→ Registrar no histórico
→ Atualizar gráficos
→ Visualizar evolução
→ Gerar PDF
→ Compartilhar PDF

ALUNO:

Meu aplicativo → Avaliação Física

→ Visualizar avaliação atual
→ Visualizar histórico
→ Visualizar gráficos
→ Visualizar evolução
→ Gerar PDF
→ Compartilhar PDF

Tudo deve utilizar os mesmos dados, os mesmos cálculos e o mesmo histórico.

A regra principal é:

UMA ÚNICA FONTE DE DADOS PARA A AVALIAÇÃO FÍSICA.

O profissional e o aluno visualizam o mesmo registro da avaliação, respeitando as permissões de cada perfil.

Não criar dados duplicados apenas para exibir no lado do aluno.

E, principalmente:

NÃO QUEBRAR NENHUMA FUNCIONALIDADE EXISTENTE.

Implementar, testar e validar o backend, banco de dados, cálculos, histórico, gráficos, permissões e geração de PDF antes de finalizar.
