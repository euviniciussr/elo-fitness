# Assinatura de profissionais via Asaas — Design

## Contexto

Hoje o Elo Fitness não cobra nada dos profissionais que usam o app — qualquer
um que se cadastra usa de graça, indefinidamente. A tabela `pagamentos` que já
existe é só um caderno manual: o profissional anota ali o que recebeu do
próprio aluno (mensalidade da personal training), sem nenhuma automação.

O pedido agora é diferente: fazer o **Elo Fitness cobrar do profissional** uma
assinatura mensal pra usar a plataforma (modelo SaaS clássico). O aluno pagando
o profissional continua fora de escopo por enquanto — só cobrança
Elo Fitness → profissional.

## Decisões já validadas com o usuário

- **Quem paga quem:** o profissional (personal/nutricionista) paga o Elo
  Fitness. Aluno pagando pra usar fica pra uma fase futura, não faz parte
  deste trabalho.
- **Gateway:** Asaas. Conta já criada e aprovada (CNPJ 68.294.387 Vinicius
  Souto Rocha), com ambiente Sandbox configurado e uma chave de API de teste
  já gerada (`elofitness-sandbox`).
- **Multi-SaaS na mesma conta Asaas:** essa mesma conta Asaas vai receber
  pagamentos de outros produtos do usuário (ex: TJV Sistema), todos no mesmo
  CNPJ — sem subconta. A separação é feita marcando todo cliente/cobrança/
  assinatura criado pelo Elo Fitness com `externalReference` no formato
  `elofitness:<trainer_id>:<plano_id>`, o que permite filtrar no painel do Asaas
  e garante que o webhook do Elo Fitness só processe eventos que ele mesmo
  criou (ignora silenciosamente qualquer evento de referência que não comece
  com `elofitness:`).
- **Forma de pagamento:** só cartão de crédito recorrente automático (sem
  Pix/boleto por agora) — cobra sozinho todo mês, sem o profissional precisar
  fazer nada manualmente.
- **Checkout:** redirecionamento pra página hospedada do próprio Asaas pra
  cadastro do cartão (link de assinatura gerado via API) — o Elo Fitness nunca
  recebe/processa número de cartão, elimina qualquer responsabilidade de PCI
  compliance.
- **Trial:** 14 dias grátis a partir do cadastro do profissional.
- **Período de tolerância pós-trial/vencimento:** 3 dias de acesso normal +
  aviso insistente de cobrança (banner). Só depois desses 3 dias o app
  bloqueia ações de criar/editar.
- **Bloqueio:** não é bloqueio total de tela — o profissional continua vendo
  os dados que já tem (alunos, treinos, dietas existentes), mas não consegue
  criar/editar nada novo até pagar. Implementado na casca do app
  (`js/auth-guard.js`), sem tocar em RLS de ~30 tabelas.
- **Conta isenta:** a Savera (`b938902d-4a00-4b07-9666-00bc183b90a4`) fica
  marcada como `isento` permanentemente — nunca entra no fluxo de cobrança,
  mesmo depois do gateway estar ativo. Qualquer profissional novo que se
  cadastrar a partir de agora entra no fluxo normal (trial → cobrança).
- **Preço:** dois planos por faixa de alunos, já decididos:
  - **Até 30 alunos** — R$ 59,90/mês.
  - **Ilimitado** — R$ 99,90/mês.

  Guardados como linhas na tabela `planos_assinatura` (não hardcoded) —
  trocar valor/limite não exige deploy de código. Essa cobrança só vale
  **depois dos 14 dias de teste**; durante o trial o profissional usa sem
  escolher plano e sem limite de alunos.
- **Limite de alunos por plano:** se o profissional está no plano "Até 30
  alunos" e já tem 30 cadastrados, tentar cadastrar o 31º é **bloqueado**
  (precisa trocar pro plano Ilimitado primeiro). Durante o trial não existe
  esse limite.
- **Sem cron job:** o status "vencido"/"bloqueado" nunca é calculado e
  gravado por um job periódico — é sempre derivado na hora, comparando a data
  de hoje com `trial_termina_em`/`assinatura_valida_ate` + 3 dias, o mesmo
  espírito de "nunca guardar TMB pronto" que já existe no projeto
  (`aluno-detalhe.html:calcularTMB`).

## Modelo de dados

### `trainers` (colunas novas, tudo nullable/com default seguro pra não quebrar quem já existe)

| coluna | tipo | uso |
|---|---|---|
| `status_assinatura` | text, check in (`trial`,`ativo`,`inadimplente`,`isento`) | estado "declarado" — ver nota abaixo sobre por que isso não é a fonte de verdade do bloqueio |
| `trial_termina_em` | date | cadastro + 14 dias, preenchido no `handle_new_trainer` (trigger que já existe, migration `0001_init.sql`/`0002_convites.sql`) |
| `assinatura_valida_ate` | date, nullable | até quando o último pagamento confirmado cobre; atualizado pelo webhook |
| `asaas_customer_id` | text, nullable | id do cliente criado no Asaas |
| `asaas_subscription_id` | text, nullable | id da assinatura recorrente no Asaas |
| `plano_id` | uuid, nullable, `references planos_assinatura(id)` | qual dos dois planos o profissional escolheu no checkout; `null` durante o trial |
| `cpf_cnpj` | text, nullable | documento do profissional, pedido uma vez na tela de checkout (o Asaas exige pra criar a cobrança); reaproveitado se ele trocar de plano depois |

`status_assinatura` guarda a última transição conhecida (útil pra listagem/
suporte: "quem está trial", "quem está inadimplente"), mas a decisão real de
bloquear ou não é sempre recalculada na hora a partir das datas — `status_assinatura`
nunca é a fonte de verdade sozinha, só um cache de leitura rápida atualizado
junto com as datas.

### Nova tabela `planos_assinatura`

```sql
create table planos_assinatura (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  valor numeric not null,
  limite_alunos int, -- null = sem limite (plano Ilimitado)
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
```

Duas linhas inseridas na migration: `("Até 30 alunos", 59.90, 30)` e
`("Ilimitado", 99.90, null)`. Trocar valor/limite = `update` nessa tabela,
sem deploy.

### Nova tabela `assinatura_pagamentos`

Histórico das cobranças do Asaas — **separada** da tabela `pagamentos` que já
existe (essa é sobre o profissional recebendo do aluno; misturar as duas
corromperia o relatório financeiro que o profissional já vê em
`financeiro.html`/`dashboard.html`).

```sql
create table assinatura_pagamentos (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  asaas_payment_id text not null unique,
  valor numeric not null,
  status text not null, -- espelha o status do Asaas (CONFIRMED, OVERDUE, etc.)
  data_pagamento date,
  created_at timestamptz not null default now()
);
```

RLS: só o próprio trainer vê o seu histórico (`trainer_id = auth.uid()`),
`for select`. Escrita só via `service_role` (webhook), nenhuma policy de
insert/update pra usuário comum.

## Fluxo de checkout

1. Profissional bloqueado/em aviso vê uma tela "Assinar agora" com os dois
   planos (Até 30 alunos / Ilimitado) e escolhe um.
2. O frontend chama a Edge Function `asaas-checkout` (mesmo padrão das
   `food-*` que já existem em `supabase/functions/`) passando o
   `plano_id` escolhido e o CPF/CNPJ do profissional (pedido no mesmo
   formulário — o Asaas exige documento pra criar a cobrança e hoje
   `trainers` não guarda isso).
3. A function usa o endpoint de **Asaas Checkout** (`POST /v3/checkouts`,
   hospedado pelo próprio Asaas): manda `billingTypes: ["CREDIT_CARD"]`,
   `chargeTypes: ["RECURRENT"]`, `subscription: { cycle: "MONTHLY",
   nextDueDate: <hoje+1> }`, `customerData` (nome, cpfCnpj, email do
   trainer), `value` = o valor do plano escolhido, e
   `externalReference: 'elofitness:' + trainer_id + ':' + plano_id`.
   Devolve o campo `link` da resposta — a URL hospedada pra onde o
   frontend redireciona.
4. Profissional cadastra o cartão nessa página do próprio Asaas.
5. Asaas cobra e manda webhook de confirmação; é o **webhook** (não o
   checkout) quem grava `asaas_customer_id`/`asaas_subscription_id` e
   `plano_id` definitivos em `trainers`, extraindo `trainer_id` e
   `plano_id` do `externalReference` do evento confirmado.

## Webhook

Nova Edge Function `asaas-webhook`, endpoint público (auth via token de
webhook configurado no painel do Asaas, verificado num header customizado —
não é a mesma coisa que o JWT do Supabase Auth, então essa function roda com
`verify_jwt` desligado, igual outras integrações externas costumam precisar).

Ao receber um evento:
1. Confirma o token do header.
2. Ignora se `payment.externalReference` não começa com `elofitness:` (evento
   de outro produto na mesma conta Asaas).
3. Extrai `trainer_id` e `plano_id` do `externalReference`
   (`elofitness:<trainer_id>:<plano_id>`).
4. Em `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED`: grava/atualiza linha em
   `assinatura_pagamentos`, atualiza `trainers.assinatura_valida_ate` pra
   "hoje + 1 mês", `status_assinatura = 'ativo'`, `plano_id`,
   `asaas_customer_id = payment.customer`, `asaas_subscription_id =
   payment.subscription`.
5. Em `PAYMENT_OVERDUE`/falha de cobrança: atualiza `status_assinatura` pra
   `'inadimplente'` (a data `assinatura_valida_ate` não muda — o bloqueio real
   continua sendo calculado a partir dela + 3 dias, não desse campo).

## Enforcement (bloqueio)

`js/auth-guard.js` (carregado em toda página protegida) ganha uma checagem:
busca `status_assinatura`, `trial_termina_em`, `assinatura_valida_ate` do
trainer logado; se `isento`, libera; senão calcula
`limite = coalesce(assinatura_valida_ate, trial_termina_em) + 3 dias` e:

- hoje ≤ `limite` → libera tudo (com banner de aviso se já passou do
  trial/vencimento original, antes do limite).
- hoje > `limite` → mostra um overlay bloqueando ações de escrita (mesma UI
  em todas as páginas, um componente pequeno reaproveitável) — leitura dos
  dados existentes continua funcionando.

Nenhuma policy de RLS muda nas ~30 tabelas existentes — o bloqueio é só de
UI/UX no app do profissional, não no banco.

### Limite de alunos por plano

Independente do bloqueio por pagamento, o formulário de "novo aluno"
(`adicionar-aluno.html`) ganha uma checagem própria: antes de inserir,
conta quantos `clientes` o trainer já tem; se o `plano_id` atual aponta
pra um plano com `limite_alunos` definido (hoje, só "Até 30 alunos") e a
contagem já bateu nesse limite, bloqueia a criação com uma mensagem
convidando a trocar pro plano Ilimitado — sem tocar em RLS, só na UI,
mesmo espírito do bloqueio por pagamento. Durante o trial (`plano_id`
ainda `null`) não há limite nenhum.

## Fora de escopo (confirmado com o usuário)

- Aluno pagando para usar o app.
- Pix e boleto como forma de pagamento.
- Subconta Asaas (não necessário — mesmo CNPJ, separação via `externalReference`).

## Verificação

1. Testar o fluxo completo no Sandbox do Asaas (cartão de teste que a própria
   documentação do Asaas fornece) antes de qualquer chave de produção.
2. Confirmar que o webhook ignora corretamente um evento com
   `externalReference` de outro produto (simular manualmente).
3. Confirmar que a Savera nunca vê nenhum aviso de cobrança.
4. Confirmar que um trainer de teste em trial vê acesso normal, depois do dia
   14 vê o banner (dias 15-17), e só bloqueia ações no dia 18.
5. Confirmar que pagar em qualquer momento (mesmo já bloqueado) libera de
   volta imediatamente após o webhook confirmar.
6. Confirmar que um trainer no plano "Até 30 alunos" com 30 `clientes` não
   consegue cadastrar o 31º, e que o mesmo trainer sem plano (trial) não
   tem esse limite.
