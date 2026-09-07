# Assinatura de Profissionais via Asaas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Elo Fitness professional (trainer/nutricionista) pay a recurring monthly subscription to use the app, via Asaas hosted checkout (card only), with a 14-day trial + 3-day nag grace period before write-actions get blocked, two price tiers by student count, and Savera permanently exempt.

**Architecture:** Two new Edge Functions (`asaas-checkout`, `asaas-webhook`) talk to the Asaas REST API using a shared `_shared/asaas.ts` helper; a single migration adds billing columns to `trainers` plus `planos_assinatura`/`assinatura_pagamentos` tables, locked against client-side writes via a `before update` trigger; enforcement lives entirely in `js/auth-guard.js` (shared by all 17 trainer pages) and a small check in `adicionar-aluno.html` — no RLS changes to any existing table.

**Tech Stack:** Supabase Postgres + Edge Functions (Deno/TypeScript), plain HTML/JS pages (no bundler), Asaas REST API v3 (sandbox now, `api-sandbox.asaas.com`; production later, `api.asaas.com`, swapped via secrets only).

This plan implements: `docs/superpowers/specs/2026-09-07-assinatura-asaas-design.md`.

**No automated test framework exists in this repo** (static HTML + Supabase, no `package.json`/test runner) — this matches every prior plan in this project (Avaliação Física, Evolução). "Test" steps below are concrete SQL/curl verifications with exact expected output instead of unit tests, run against the real linked Supabase project (writes need your explicit go-ahead per the auto-mode classifier, same as every prior migration in this project).

**Known limitations to accept going in** (call these out to the user during review, don't silently "fix" them by over-engineering):
- The UI block in `auth-guard.js` disables `input`/`textarea`/`select` via CSS (`pointer-events:none`), not JS-level `disabled` — this doesn't stop keyboard-only Tab-focus-then-type on an already-focused field. Accepted: the spec already says this bloqueio is UI-only, not airtight (no RLS changes).
- The Asaas `/v3/checkouts` `items[]` schema lists `imageBase64` as "required" in the OpenAPI spec pulled from their docs, but every real-world example omits it. We omit it too; if the sandbox call rejects the request for that reason, Task 9's verification step will surface it immediately and the fix is one line (add a 1x1 base64 pixel).

---

### Task 1: Migration — billing columns, plans, payment history, and the write-lock trigger

**Files:**
- Create: `supabase/migrations/0037_assinatura_asaas.sql`

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Ask the user to confirm before running this against the real database**

This runs against the linked production Supabase project (no separate staging DB exists for this app — same as every prior migration). Say exactly:

> "Vou rodar a migration `0037_assinatura_asaas.sql` no banco real (é a mesma prática das migrations anteriores). Ela só adiciona colunas/tabelas novas e não apaga nada. Posso rodar?"

Wait for explicit confirmation before Step 3.

- [ ] **Step 3: Run the migration**

```bash
export SUPABASE_ACCESS_TOKEN="<personal access token da conta nova, ver project_architecture memory>"
supabase db query --linked --file supabase/migrations/0037_assinatura_asaas.sql
```

Expected: no errors.

- [ ] **Step 4: Verify the migration**

```bash
supabase db query --linked "select id, nome, status_assinatura, trial_termina_em from trainers where id = 'b938902d-4a00-4b07-9666-00bc183b90a4'"
supabase db query --linked "select nome, valor, limite_alunos from planos_assinatura order by valor"
supabase db query --linked "select count(*) from trainers where trial_termina_em is null"
```

Expected: Savera's row shows `status_assinatura = 'isento'`; two plan rows ("Até 30 alunos"/59.90/30 and "Ilimitado"/99.90/null); the null-`trial_termina_em` count is `0`.

- [ ] **Step 5: Verify the lock trigger actually blocks a normal client update**

This simulates what a trainer's browser session can do — run it as the `authenticated` role, not as the CLI's default superuser session:

```bash
supabase db query --linked "
set local request.jwt.claim.role to 'authenticated';
set local request.jwt.claim.sub to 'b938902d-4a00-4b07-9666-00bc183b90a4';
update trainers set status_assinatura = 'ativo' where id = 'b938902d-4a00-4b07-9666-00bc183b90a4';
select status_assinatura from trainers where id = 'b938902d-4a00-4b07-9666-00bc183b90a4';
"
```

(`auth.role()` reads the `request.jwt.claim.role` session setting, not Postgres's own `role` — confirmed by reading `auth.role()`'s source during execution; `set local role authenticated` alone does not trigger the lock.)

Expected: `status_assinatura` still reads `isento` — the trigger silently reverted the change.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0037_assinatura_asaas.sql
git commit -m "feat: add subscription billing columns, plans, and payment history tables

Claude-Session: https://claude.ai/code/session_01DdFcBVXNTpUR9SxMXjwvvc"
```

---

### Task 2: Shared Asaas HTTP helper for Edge Functions

**Files:**
- Create: `supabase/functions/_shared/asaas.ts`

- [ ] **Step 1: Write the helper**

```ts
// Cliente HTTP pro Asaas — usado por asaas-checkout e asaas-webhook.
// Trocar sandbox->produção é só `supabase secrets set ASAAS_API_URL=...
// ASAAS_API_KEY=...`, sem deploy de código.

const ASAAS_API_URL = Deno.env.get("ASAAS_API_URL") || "https://api-sandbox.asaas.com/v3";
const ASAAS_API_KEY = Deno.env.get("ASAAS_API_KEY")!;

export async function asaasFetch(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${ASAAS_API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      access_token: ASAAS_API_KEY,
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Asaas ${path} falhou (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/asaas.ts
git commit -m "feat: add shared Asaas API client helper for Edge Functions

Claude-Session: https://claude.ai/code/session_01DdFcBVXNTpUR9SxMXjwvvc"
```

---

### Task 3: `asaas-checkout` Edge Function

**Files:**
- Create: `supabase/functions/asaas-checkout/index.ts`

- [ ] **Step 1: Write the function**

```ts
// POST /functions/v1/asaas-checkout
// Gera o link de checkout hospedado do Asaas pra um trainer assinar um dos
// planos em planos_assinatura. Chamado autenticado (JWT do trainer) do
// frontend (assinatura.html). Ver design em
// docs/superpowers/specs/2026-09-07-assinatura-asaas-design.md.

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { callerClient } from "../_shared/supabase.ts";
import { asaasFetch } from "../_shared/asaas.ts";

function amanha(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { plano_id, cpf_cnpj, successUrl, cancelUrl, expiredUrl } = body;
    if (!plano_id || !cpf_cnpj || !successUrl || !cancelUrl || !expiredUrl) {
      return jsonResponse({ error: "Campos obrigatórios: plano_id, cpf_cnpj, successUrl, cancelUrl, expiredUrl." }, 400);
    }

    const supabase = callerClient(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonResponse({ error: "Não autenticado." }, 401);

    const { data: trainer } = await supabase.from("trainers").select("nome, email").eq("id", user.id).single();
    if (!trainer) return jsonResponse({ error: "Trainer não encontrado." }, 404);

    const { data: plano } = await supabase.from("planos_assinatura").select("nome, valor").eq("id", plano_id).eq("ativo", true).single();
    if (!plano) return jsonResponse({ error: "Plano inválido." }, 400);

    await supabase.from("trainers").update({ cpf_cnpj }).eq("id", user.id);

    const checkout = await asaasFetch("/checkouts", {
      method: "POST",
      body: JSON.stringify({
        billingTypes: ["CREDIT_CARD"],
        chargeTypes: ["RECURRENT"],
        minutesToExpire: 60,
        callback: { successUrl, cancelUrl, expiredUrl },
        items: [{ name: plano.nome.slice(0, 30), value: plano.valor, quantity: 1 }],
        customerData: { name: trainer.nome, cpfCnpj: cpf_cnpj, email: trainer.email },
        subscription: { cycle: "MONTHLY", nextDueDate: amanha() },
        externalReference: `elofitness:${user.id}:${plano_id}`,
      }),
    });

    return jsonResponse({ link: checkout.link });
  } catch (err) {
    console.error("[asaas-checkout] falhou:", err);
    return jsonResponse({ error: "Não foi possível gerar o checkout." }, 500);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/asaas-checkout/index.ts
git commit -m "feat: add asaas-checkout Edge Function

Claude-Session: https://claude.ai/code/session_01DdFcBVXNTpUR9SxMXjwvvc"
```

---

### Task 4: `asaas-webhook` Edge Function

**Files:**
- Create: `supabase/functions/asaas-webhook/index.ts`

- [ ] **Step 1: Write the function**

```ts
// POST /functions/v1/asaas-webhook
// Recebe eventos de pagamento do Asaas. Endpoint público — verify_jwt
// desligado no deploy (não é uma chamada de um usuário logado no Supabase
// Auth, é o servidor do Asaas chamando direto). Autenticação é o header
// asaas-access-token, configurado igual no Asaas e como secret aqui. Ver
// design em docs/superpowers/specs/2026-09-07-assinatura-asaas-design.md.

import { jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { asaasFetch } from "../_shared/asaas.ts";

const WEBHOOK_TOKEN = Deno.env.get("ASAAS_WEBHOOK_TOKEN")!;

function somarUmMes(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

Deno.serve(async (req) => {
  if (req.headers.get("asaas-access-token") !== WEBHOOK_TOKEN) {
    return jsonResponse({ error: "Token inválido." }, 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const eventosConfirmacao = ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"];
    const eventosAtraso = ["PAYMENT_OVERDUE"];
    if (!body.payment || !body.payment.id || (!eventosConfirmacao.includes(body.event) && !eventosAtraso.includes(body.event))) {
      return jsonResponse({ ignored: true });
    }

    const payment = await asaasFetch(`/payments/${body.payment.id}`);
    const ref = String(payment.externalReference || "");
    const partes = ref.split(":");
    if (partes[0] !== "elofitness" || !partes[1]) {
      return jsonResponse({ ignored: true }); // evento de outro produto na mesma conta Asaas
    }
    const trainerId = partes[1];
    const planoId = partes[2] || null;

    const svc = serviceClient();

    if (eventosConfirmacao.includes(body.event)) {
      await svc.from("assinatura_pagamentos").upsert({
        trainer_id: trainerId,
        asaas_payment_id: payment.id,
        valor: payment.value,
        status: payment.status,
        data_pagamento: new Date().toISOString().slice(0, 10),
      }, { onConflict: "asaas_payment_id" });

      await svc.from("trainers").update({
        status_assinatura: "ativo",
        assinatura_valida_ate: somarUmMes(),
        asaas_customer_id: payment.customer,
        asaas_subscription_id: payment.subscription,
        plano_id: planoId,
      }).eq("id", trainerId);
    } else {
      await svc.from("trainers").update({ status_assinatura: "inadimplente" }).eq("id", trainerId);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("[asaas-webhook] falhou:", err);
    return jsonResponse({ error: "Erro ao processar webhook." }, 500);
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/asaas-webhook/index.ts
git commit -m "feat: add asaas-webhook Edge Function

Claude-Session: https://claude.ai/code/session_01DdFcBVXNTpUR9SxMXjwvvc"
```

---

### Task 5: Deploy functions, set secrets, register the webhook in Asaas Sandbox

**Files:** none (CLI/API operations only)

- [ ] **Step 1: Ask the user for the sandbox API key value**

The sandbox key (`elofitness-sandbox`) was already generated in the Asaas dashboard earlier in this project but its value must never be typed into a committed file. Ask the user to paste it directly into the command below when running it themselves, or paste it in chat right before this step so it's used once and not stored anywhere in the repo.

- [ ] **Step 2: Set secrets**

```bash
supabase secrets set --linked ASAAS_API_KEY="<valor da chave sandbox>"

WEBHOOK_TOKEN=$(openssl rand -hex 32)
supabase secrets set --linked ASAAS_WEBHOOK_TOKEN="$WEBHOOK_TOKEN"
echo "$WEBHOOK_TOKEN"   # guarde esse valor nesta mesma sessão de terminal — é usado no passo 5
```

(`ASAAS_API_URL` is left unset — the code defaults to the sandbox URL. Setting it, together with swapping `ASAAS_API_KEY` for a production key, is the entire cutover to production later. Supabase secrets can't be read back by value later — `$WEBHOOK_TOKEN` only exists in this shell session, so Step 5 below must run in the same session, or you re-generate and re-set it.)

- [ ] **Step 3: Deploy both functions**

```bash
supabase functions deploy asaas-checkout --use-api
supabase functions deploy asaas-webhook --use-api --no-verify-jwt
```

Expected: both deploy without error. Note the project's function base URL from the output (`https://wqscmenuuipuehiwpiul.supabase.co/functions/v1/`).

- [ ] **Step 4: Register the webhook in Asaas Sandbox via API**

```bash
curl -s -X POST https://api-sandbox.asaas.com/v3/webhooks \
  -H "access_token: <valor da chave sandbox>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "elofitness-webhook",
    "url": "https://wqscmenuuipuehiwpiul.supabase.co/functions/v1/asaas-webhook",
    "email": "contabusinessvini@gmail.com",
    "enabled": true,
    "interrupted": false,
    "apiVersion": 3,
    "authToken": "'"$WEBHOOK_TOKEN"'",
    "sendType": "SEQUENTIALLY",
    "events": ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_OVERDUE"]
  }'
```

Expected: `200`/`201` with the created webhook's `id`. (`sendType` is required — omitting it fails with `invalid_object`/"É necessário informar um tipo de envio para essa configuração.", confirmed while running this step.)

- [ ] **Step 5: Verify**

```bash
curl -s https://api-sandbox.asaas.com/v3/webhooks -H "access_token: <valor da chave sandbox>"
```

Expected: the response lists the `elofitness-webhook` entry pointing at the deployed function URL, `enabled: true`.

No commit for this task (no files changed).

---

### Task 6: `assinatura.html` — plan picker + checkout redirect

**Files:**
- Create: `assinatura.html`

- [ ] **Step 1: Write the page**

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Assinatura — Elo Fitness</title>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="js/supabase-client.js"></script>
<script src="js/auth-guard.js"></script>
<style>
html,body{margin:0;padding:0;background:#0a0d13;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e5e9f0;}
*{box-sizing:border-box;}
a{color:#f97316;text-decoration:none;}
button{font-family:inherit;cursor:pointer;}

.topbar{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;border-bottom:1px solid #171d29;}
.logo{display:flex;align-items:center;gap:10px;}
.logo-badge{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#f97316,#ea580c);display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;font-size:16px;}
.logo-text{font-size:17px;font-weight:800;}
.logo-text span{color:#f97316;}

.wrap{max-width:640px;margin:0 auto;padding:32px 20px 80px;}
.card{background:#10151f;border:1px solid #1a2130;border-radius:16px;padding:28px;margin-bottom:16px;}
h1{font-size:20px;font-weight:800;margin:0 0 6px;}
.sub{font-size:13.5px;color:#9aa4b2;margin:0 0 24px;}

.planos{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;}
.plano{border:2px solid #1a2130;border-radius:12px;padding:18px;cursor:pointer;}
.plano.selecionado{border-color:#f97316;background:rgba(249,115,22,.06);}
.plano h3{margin:0 0 4px;font-size:15px;font-weight:800;}
.plano .preco{font-size:22px;font-weight:800;color:#f97316;margin:6px 0;}
.plano .desc{font-size:12.5px;color:#9aa4b2;}

label{font-size:12px;font-weight:700;color:#9aa4b2;display:block;margin-bottom:6px;}
input{width:100%;background:#0d1119;border:1px solid #1e2633;border-radius:9px;padding:11px 14px;color:#e5e9f0;font-family:inherit;font-size:13.5px;outline:none;}
.field{margin-bottom:14px;}

.erro-geral{color:#f87171;font-size:12.5px;margin:14px 0;display:none;}
.btn{border:none;border-radius:10px;padding:12px 18px;font-size:13.5px;font-weight:700;cursor:pointer;width:100%;}
.btn-primary{background:linear-gradient(135deg,#f97316,#ea580c);color:#fff;}
.btn:disabled{opacity:.55;cursor:default;}
.msg{font-size:14px;line-height:1.5;}
</style>
</head>
<body>

<div class="topbar">
  <div class="logo">
    <div class="logo-badge">E</div>
    <div class="logo-text">Elo <span>Fitness</span></div>
  </div>
  <a href="dashboard.html">← Voltar</a>
</div>

<div class="wrap">
  <div class="card" id="card-resultado" style="display:none;"></div>

  <div class="card" id="card-form">
    <h1>Assinar Elo Fitness</h1>
    <div class="sub">Escolha o plano e cadastre o cartão pra continuar usando a plataforma. A cobrança é mensal, automática, direto pelo Asaas.</div>

    <div class="planos" id="planos"></div>

    <div class="field">
      <label>CPF ou CNPJ</label>
      <input id="f-cpf-cnpj" placeholder="Só números">
    </div>

    <div class="erro-geral" id="erro-geral"></div>
    <button class="btn btn-primary" id="btn-assinar" disabled>Selecione um plano</button>
  </div>
</div>

<script>
let planoSelecionadoId = null;

async function init() {
  const params = new URLSearchParams(location.search);
  if (params.get('sucesso')) return mostrarResultadoESincronizar();
  if (params.get('cancelado')) return mostrarResultado('Checkout cancelado. Você pode tentar de novo quando quiser.');
  if (params.get('expirado')) return mostrarResultado('O link de checkout expirou. Tente assinar novamente.');

  const { data: planos } = await supabaseClient.from('planos_assinatura').select('id, nome, valor, limite_alunos').eq('ativo', true).order('valor');
  const cont = document.getElementById('planos');
  (planos || []).forEach(p => {
    const div = document.createElement('div');
    div.className = 'plano';
    div.innerHTML = '<h3>' + p.nome + '</h3><div class="preco">R$ ' + p.valor.toFixed(2).replace('.', ',') + '/mês</div><div class="desc">' + (p.limite_alunos ? 'Até ' + p.limite_alunos + ' alunos' : 'Alunos ilimitados') + '</div>';
    div.addEventListener('click', () => {
      document.querySelectorAll('.plano').forEach(el => el.classList.remove('selecionado'));
      div.classList.add('selecionado');
      planoSelecionadoId = p.id;
      document.getElementById('btn-assinar').disabled = false;
      document.getElementById('btn-assinar').textContent = 'Assinar ' + p.nome;
    });
    cont.appendChild(div);
  });
}

function mostrarResultado(msg) {
  document.getElementById('card-form').style.display = 'none';
  const card = document.getElementById('card-resultado');
  card.style.display = '';
  card.innerHTML = '<div class="msg">' + msg + '</div><br><a href="dashboard.html">Voltar ao Dashboard</a>';
}

async function mostrarResultadoESincronizar() {
  document.getElementById('card-form').style.display = 'none';
  const card = document.getElementById('card-resultado');
  card.style.display = '';
  card.innerHTML = '<div class="msg">Confirmando seu pagamento…</div>';

  const { data: { user } } = await supabaseClient.auth.getUser();
  for (let i = 0; i < 10; i++) {
    const { data: trainer } = await supabaseClient.from('trainers').select('status_assinatura').eq('id', user.id).single();
    if (trainer && trainer.status_assinatura === 'ativo') {
      card.innerHTML = '<div class="msg">Pagamento confirmado! Sua assinatura está ativa.</div><br><a href="dashboard.html">Ir pro Dashboard</a>';
      return;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  card.innerHTML = '<div class="msg">Recebemos seu pagamento e ainda estamos confirmando — pode levar até um minuto. Você pode voltar e recarregar a página em seguida.</div><br><a href="dashboard.html">Voltar ao Dashboard</a>';
}

document.getElementById('btn-assinar').addEventListener('click', async () => {
  const cpfCnpj = document.getElementById('f-cpf-cnpj').value.replace(/\D/g, '');
  const erroGeral = document.getElementById('erro-geral');
  const btn = document.getElementById('btn-assinar');
  erroGeral.style.display = 'none';

  if (!planoSelecionadoId) return;
  if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
    erroGeral.textContent = 'Digite um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.';
    erroGeral.style.display = '';
    return;
  }

  btn.disabled = true; btn.textContent = 'Gerando checkout…';

  const base = location.origin + location.pathname;
  const { data, error } = await supabaseClient.functions.invoke('asaas-checkout', {
    body: {
      plano_id: planoSelecionadoId,
      cpf_cnpj: cpfCnpj,
      successUrl: base + '?sucesso=1',
      cancelUrl: base + '?cancelado=1',
      expiredUrl: base + '?expirado=1',
    },
  });

  if (error || !data || !data.link) {
    erroGeral.textContent = 'Não foi possível gerar o checkout. Tente de novo em alguns instantes.';
    erroGeral.style.display = '';
    btn.disabled = false; btn.textContent = 'Assinar';
    return;
  }

  window.location.href = data.link;
});

init();
</script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add assinatura.html
git commit -m "feat: add subscription plan picker and Asaas checkout page

Claude-Session: https://claude.ai/code/session_01DdFcBVXNTpUR9SxMXjwvvc"
```

---

### Task 7: Enforcement in `js/auth-guard.js`

**Files:**
- Modify: `js/auth-guard.js` (currently 15 lines, full file shown below as context)

- [ ] **Step 1: Replace the file contents**

Current content (for reference — the session-check and logout-link behavior must NOT change):

```js
(async function () {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
  }
})();

document.addEventListener('click', function (e) {
  const link = e.target.closest && e.target.closest('a[href="login.html"]');
  if (!link) return;
  e.preventDefault();
  supabaseClient.auth.signOut().finally(function () {
    window.location.href = 'login.html';
  });
}, true);
```

New content:

```js
(async function () {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return;
  }
  if (!location.pathname.endsWith('assinatura.html')) {
    aplicarBloqueioAssinatura(session.user.id);
  }
})();

document.addEventListener('click', function (e) {
  const link = e.target.closest && e.target.closest('a[href="login.html"]');
  if (!link) return;
  e.preventDefault();
  supabaseClient.auth.signOut().finally(function () {
    window.location.href = 'login.html';
  });
}, true);

// Assinatura: 14 dias de trial + 3 dias de aviso, depois bloqueia escrita.
// Some silenciosamente pra qualquer sessão que não seja de um trainer
// (ex: app-aluno.html, onde quem loga é o cliente, não o profissional).
async function aplicarBloqueioAssinatura(userId) {
  const { data: trainer } = await supabaseClient
    .from('trainers')
    .select('status_assinatura, trial_termina_em, assinatura_valida_ate')
    .eq('id', userId)
    .maybeSingle();
  if (!trainer || trainer.status_assinatura === 'isento') return;

  const baseStr = trainer.assinatura_valida_ate || trainer.trial_termina_em;
  if (!baseStr) return;

  const hojeStr = dataLocalStr();
  const limiteStr = somarDias(baseStr, 3);

  if (hojeStr <= baseStr) return;

  if (hojeStr <= limiteStr) {
    mostrarAvisoAssinatura(diffDias(hojeStr, limiteStr));
  } else {
    bloquearEdicao();
  }
}

function dataLocalStr(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function somarDias(dataStr, dias) {
  const [y, m, d] = dataStr.split('-').map(Number);
  return dataLocalStr(new Date(y, m - 1, d + dias));
}

function diffDias(deStr, ateStr) {
  const [y1, m1, d1] = deStr.split('-').map(Number);
  const [y2, m2, d2] = ateStr.split('-').map(Number);
  const ms = new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1);
  return Math.max(0, Math.round(ms / 86400000));
}

function mostrarAvisoAssinatura(diasRestantes) {
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#f97316;color:#fff;padding:10px 16px;font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;';
  banner.innerHTML = '<span>Seu período de teste terminou. Faltam ' + diasRestantes + ' dia(s) pra sua conta ser bloqueada.</span>'
    + '<a href="assinatura.html" style="background:#fff;color:#ea580c;border-radius:8px;padding:6px 14px;font-weight:700;font-size:13px;">Assinar agora</a>';
  document.body.prepend(banner);
}

function bloquearEdicao() {
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#dc2626;color:#fff;padding:10px 16px;font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;';
  banner.innerHTML = '<span>Sua assinatura está pendente. Você continua vendo seus dados, mas não consegue criar ou editar nada até assinar.</span>'
    + '<a href="assinatura.html" style="background:#fff;color:#dc2626;border-radius:8px;padding:6px 14px;font-weight:700;font-size:13px;">Assinar agora</a>';
  document.body.prepend(banner);

  const style = document.createElement('style');
  style.textContent = 'body.assinatura-bloqueada input, body.assinatura-bloqueada textarea, body.assinatura-bloqueada select { pointer-events:none !important; opacity:.5 !important; }';
  document.head.appendChild(style);
  document.body.classList.add('assinatura-bloqueada');
}
```

- [ ] **Step 2: Verify — trial trainer sees nothing extra**

Manually: log in as a trainer whose `trial_termina_em` is in the future (any freshly created test account). Load `dashboard.html`. Expected: no banner appears, page behaves exactly as before this change.

- [ ] **Step 3: Verify — nag banner appears in the 3-day window**

```bash
supabase db query --linked "update trainers set trial_termina_em = current_date - 1 where id = '<id de um trainer de teste, NÃO a Savera>'"
```

Reload `dashboard.html` logged in as that trainer. Expected: orange banner at the top with "Faltam 2 dia(s)...", page content still fully usable (inputs still work).

- [ ] **Step 4: Verify — block kicks in after the 3-day window**

```bash
supabase db query --linked "update trainers set trial_termina_em = current_date - 4 where id = '<mesmo trainer de teste>'"
```

Reload `dashboard.html`. Expected: red banner, and any `<input>`/`<textarea>`/`<select>` on the page is visibly greyed out and unclickable; existing data still visible.

- [ ] **Step 5: Verify — a student session (`app-aluno.html`) is never affected**

Log in as a test aluno account. Expected: no banner, no change in behavior — the `trainers` lookup returns null for an aluno's `auth.uid()`, so `aplicarBloqueioAssinatura` returns immediately.

- [ ] **Step 6: Restore the test trainer's date and commit**

```bash
supabase db query --linked "update trainers set trial_termina_em = current_date + 14 where id = '<mesmo trainer de teste>'"
git add js/auth-guard.js
git commit -m "feat: block write actions in auth-guard.js after trial + grace period

Claude-Session: https://claude.ai/code/session_01DdFcBVXNTpUR9SxMXjwvvc"
```

---

### Task 8: Student-count limit in `adicionar-aluno.html`

**Files:**
- Modify: `adicionar-aluno.html:154-161` (right before the existing duplicate-email check's `return`, i.e. insert the new check between the duplicate-email check and the `insert` call at line 163)

- [ ] **Step 1: Add the limit check**

Insert this block immediately after the existing duplicate-email check (after line 161's closing `}`) and before the `const { data: novo, error } = await supabaseClient.from('clientes').insert(...)` call:

```js
  const { data: trainerPlano } = await supabaseClient
    .from('trainers')
    .select('plano_id, planos_assinatura(nome, limite_alunos)')
    .eq('id', user.id)
    .single();
  const limite = trainerPlano && trainerPlano.planos_assinatura ? trainerPlano.planos_assinatura.limite_alunos : null;
  if (limite != null) {
    const { count } = await supabaseClient
      .from('clientes')
      .select('id', { count: 'exact', head: true })
      .eq('trainer_id', user.id);
    if ((count || 0) >= limite) {
      erroGeral.innerHTML = 'Você atingiu o limite de ' + limite + ' alunos do plano "' + trainerPlano.planos_assinatura.nome + '". <a href="assinatura.html">Troque de plano</a> pra continuar cadastrando.';
      erroGeral.style.display = '';
      btn.disabled = false; btn.textContent = 'Adicionar cliente';
      return;
    }
  }
```

- [ ] **Step 2: Verify — trainer on the capped plan at the limit is blocked**

```bash
supabase db query --linked "select id from planos_assinatura where nome = 'Até 30 alunos'"
supabase db query --linked "update trainers set plano_id = '<id retornado acima>' where id = '<id de um trainer de teste>'"
```

Create 30 test `clientes` rows for that trainer (or reuse existing ones if the test trainer already has 30+). Load `adicionar-aluno.html` logged in as that trainer, fill the form, submit. Expected: the request is blocked before the insert, with the "Você atingiu o limite..." message and a working link to `assinatura.html`; no new row was created (`select count(*) from clientes where trainer_id = ...` unchanged).

- [ ] **Step 3: Verify — trial trainer (no plano_id) has no limit**

```bash
supabase db query --linked "update trainers set plano_id = null where id = '<mesmo trainer de teste>'"
```

Repeat the form submission. Expected: the aluno is created normally (no limit check blocks it).

- [ ] **Step 4: Restore the test trainer and commit**

```bash
supabase db query --linked "update trainers set plano_id = null where id = '<mesmo trainer de teste>'"
git add adicionar-aluno.html
git commit -m "feat: block adding a new student past the plan's student limit

Claude-Session: https://claude.ai/code/session_01DdFcBVXNTpUR9SxMXjwvvc"
```

---

### Task 9: End-to-end sandbox verification (real Asaas checkout, no production key involved)

**Files:** none

- [ ] **Step 1: Force a test trainer into the blocked state**

```bash
supabase db query --linked "update trainers set trial_termina_em = current_date - 5 where id = '<trainer de teste>'"
```

- [ ] **Step 2: Click through the real flow**

Log in as that trainer, click "Assinar agora" on the red banner, pick a plan, enter a fake-but-valid-format CPF (11 digits), submit. Expected: redirected to a real `sandbox.asaas.com` (or `asaas.com/checkoutSession/...`) hosted page.

- [ ] **Step 3: Pay with Asaas's documented sandbox test card**

Use the test credit card number Asaas's own Sandbox documentation provides (visible on the checkout page itself in sandbox mode, or at `docs.asaas.com/docs/sandbox`). Complete the payment.

- [ ] **Step 4: Verify the webhook fired and updated the trainer**

```bash
supabase db query --linked "select status_assinatura, assinatura_valida_ate, asaas_customer_id, asaas_subscription_id, plano_id from trainers where id = '<trainer de teste>'"
supabase db query --linked "select * from assinatura_pagamentos where trainer_id = '<trainer de teste>'"
```

Expected: `status_assinatura = 'ativo'`, `assinatura_valida_ate` ≈ today + 1 month, both Asaas ids populated, `plano_id` matches what was picked, one row in `assinatura_pagamentos`.

- [ ] **Step 5: Verify the block lifted**

Reload `dashboard.html` as that trainer. Expected: no banner, inputs usable again.

- [ ] **Step 6: Verify the externalReference filter**

Simulate a foreign-product event by calling the deployed webhook directly with a fabricated payload:

```bash
curl -s -X POST https://wqscmenuuipuehiwpiul.supabase.co/functions/v1/asaas-webhook \
  -H "asaas-access-token: $WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"event":"PAYMENT_CONFIRMED","payment":{"id":"pay_naoexiste"}}'
```

Expected: since `pay_naoexiste` doesn't exist, `asaasFetch` throws inside the try block and the function returns `500` with `{"error":"Erro ao processar webhook."}` — that's fine, it proves the code path is reached and fails safely without touching any `trainers` row (confirm no row changed). This is close enough to proving the filter logic without needing a second real Asaas account to generate a genuinely different `externalReference` payment.

- [ ] **Step 7: Confirm Savera never sees anything**

Log in as Savera. Expected: no banner regardless of any date manipulation done in this task (her `status_assinatura` stayed `'isento'` throughout — never touched by any step above).

- [ ] **Step 8: Clean up test state**

```bash
supabase db query --linked "update trainers set trial_termina_em = current_date + 14, status_assinatura = 'trial', assinatura_valida_ate = null, plano_id = null, asaas_customer_id = null, asaas_subscription_id = null, cpf_cnpj = null where id = '<trainer de teste>'"
supabase db query --linked "delete from assinatura_pagamentos where trainer_id = '<trainer de teste>'"
```

No commit for this task (verification only, no files changed).

---

## After this plan

- Generate a **production** Asaas API key (never reuse the sandbox one, and never one that passed through chat) and run `supabase secrets set --linked ASAAS_API_URL=https://api.asaas.com/v3 ASAAS_API_KEY=<prod key>` plus register a second webhook against the production Asaas environment — this is the entire production cutover, no code changes.
- Not in this plan (explicitly out of scope, confirmed with the user): students paying to use the app, Pix/boleto billing.
