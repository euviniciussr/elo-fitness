# Tema Claro (Light Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao app inteiro (aluno, personal, admin) a opção de alternar entre tema escuro (atual, padrão) e um tema claro, com um botão sol/lua sempre visível e a preferência salva na conta.

**Architecture:** Um script compartilhado (`js/tema.js`) aplicado a cada página: em páginas x-dc (cor toda inline), ele reescreve os hex escuros conhecidos pelos claros direto no DOM renderizado; em páginas vanilla (cor centralizada num `<style>`), esse `<style>` é convertido pra variáveis CSS com um bloco `[data-theme="claro"]`. Preferência lida de `trainers.tema` / `clientes.tema` / `admins.tema` (com cache em `localStorage` pra aplicar sem esperar rede).

**Tech Stack:** HTML/JS vanilla (sem framework, sem bundler), Supabase (Postgres + Auth), deploy estático via Vercel/GitHub.

Este projeto não tem suite de testes automatizados (é um app estático, verificado historicamente rodando localmente com `python3 -m http.server` e testando ao vivo no navegador, ou direto contra o banco via `curl`/Management API). Cada task abaixo usa esse mesmo método de verificação em vez de testes automatizados — não existe framework de teste (pytest/jest) neste repositório.

---

### Task 1: Migration — coluna `tema` em trainers/clientes/admins

**Files:**
- Create: `supabase/migrations/0046_tema_claro.sql`

- [ ] **Step 1: Escrever a migration**

```sql
alter table trainers add column tema text not null default 'escuro' check (tema in ('escuro', 'claro'));
alter table clientes add column tema text not null default 'escuro' check (tema in ('escuro', 'claro'));
alter table admins   add column tema text not null default 'escuro' check (tema in ('escuro', 'claro'));
```

- [ ] **Step 2: Aplicar via Management API**

```bash
TOKEN="$SUPABASE_ACCESS_TOKEN"  # ver token no dashboard do Supabase (Account > Access Tokens)
python3 -c "
import json
sql = open('supabase/migrations/0046_tema_claro.sql').read()
print(json.dumps({'query': sql}))
" > /tmp/migration_0046.json
curl -s -X POST "https://api.supabase.com/v1/projects/wqscmenuuipuehiwpiul/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d @/tmp/migration_0046.json
```
Expected: `[]` (sucesso, sem erro).

- [ ] **Step 3: Confirmar as 3 colunas existem com default correto**

```bash
curl -s -X POST "https://api.supabase.com/v1/projects/wqscmenuuipuehiwpiul/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select table_name, column_name, column_default from information_schema.columns where column_name = '"'"'tema'"'"' and table_name in ('"'"'trainers'"'"','"'"'clientes'"'"','"'"'admins'"'"');"}'
```
Expected: 3 linhas, uma por tabela, `column_default` mostrando `'escuro'::text`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0046_tema_claro.sql
git commit -m "feat: add tema (light/dark) column to trainers, clientes and admins"
```

---

### Task 2: `js/tema.js` — núcleo (ler, aplicar, salvar)

**Files:**
- Create: `js/tema.js`

O mapa de cores completo vem da spec (`docs/superpowers/specs/2026-09-07-tema-claro-design.md`, seção "Mapa de cores").

- [ ] **Step 1: Escrever o arquivo completo**

```js
// Tema claro/escuro do app inteiro. Cada página inclui assim:
//   <script>window.TEMA_CONTA = 'trainer';</script>  <!-- ou 'cliente' / 'admin' / 'nenhuma' -->
//   <script src="js/tema.js"></script>
// Depois de js/supabase-client.js (usa supabaseClient) e antes do fim do <body>.
//
// Estratégia: páginas x-dc têm cor toda em style="" inline — a troca de tema
// reescreve, no DOM já renderizado, cada hex escuro conhecido pelo claro
// equivalente. Páginas vanilla (painel-adm, adm, montar-treino, acervo,
// aluno-detalhe) centralizam cor num <style> com classes; essas reagem via
// <html data-tema="claro"> + variáveis CSS já definidas no próprio arquivo,
// então aqui só setamos o atributo e cuidamos do restante (localStorage,
// banco, botão).

const TEMA_MAPA_CLARO = {
  // fundos
  '#0a0d13': '#f4f5f7', '#0d1119': '#eef0f3', '#10151f': '#ffffff',
  '#131a26': '#e9ebef', '#141a26': '#e9ebef', '#141018': '#ffffff', '#151b28': '#ffffff',
  // bordas
  '#171d29': '#e4e7ec', '#1a2130': '#dfe3e9', '#1e2633': '#d5dae2', '#2a3444': '#cbd2dc',
  // texto
  '#e5e9f0': '#10151f', '#9aa4b2': '#5b6472', '#66707e': '#7c8593', '#4a5364': '#98a1ae',
  '#c4cad4': '#3a4452', '#c7ccd6': '#3a4452', '#c3cad6': '#3a4452', '#3a4352': '#8b94a3',
  // status
  '#4ade80': '#16a34a', '#f87171': '#dc2626', '#60a5fa': '#2563eb', '#3b82f6': '#2563eb',
  '#a855f7': '#9333ea', '#facc15': '#b45309', '#f59e0b': '#b45309', '#f5b942': '#b45309',
  // avisos raros
  '#3a2418': '#fdece3', '#1a1408': '#fdf6e3', '#0a1a10': '#e9f9ee',
};

const TEMA_CHAVE_LOCAL = 'elofitness_tema';

function temaAtual() {
  return localStorage.getItem(TEMA_CHAVE_LOCAL) || 'escuro';
}

function temaAplicarNoDom(tema) {
  document.documentElement.setAttribute('data-tema', tema);
  if (tema === 'claro') {
    document.querySelectorAll('[style]').forEach(function (el) {
      if (el.dataset.temaOriginal === undefined) {
        el.dataset.temaOriginal = el.getAttribute('style');
      }
      let style = el.dataset.temaOriginal;
      Object.keys(TEMA_MAPA_CLARO).forEach(function (escuro) {
        if (style.indexOf(escuro) !== -1) {
          style = style.split(escuro).join(TEMA_MAPA_CLARO[escuro]);
        }
      });
      el.setAttribute('style', style);
    });
  } else {
    document.querySelectorAll('[data-tema-original]').forEach(function (el) {
      el.setAttribute('style', el.dataset.temaOriginal);
    });
  }
}

function temaTabelaDaConta() {
  const conta = window.TEMA_CONTA;
  if (conta === 'trainer') return 'trainers';
  if (conta === 'cliente') return 'clientes';
  if (conta === 'admin') return 'admins';
  return null;
}

async function temaSalvar(tema) {
  localStorage.setItem(TEMA_CHAVE_LOCAL, tema);
  temaAplicarNoDom(tema);
  temaAtualizarBotao(tema);
  const tabela = temaTabelaDaConta();
  if (!tabela || typeof supabaseClient === 'undefined') return;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  await supabaseClient.from(tabela).update({ tema: tema }).eq('id', user.id);
}

async function temaCarregarDaConta() {
  const tabela = temaTabelaDaConta();
  if (!tabela || typeof supabaseClient === 'undefined') return;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  const { data } = await supabaseClient.from(tabela).select('tema').eq('id', user.id).maybeSingle();
  if (data && data.tema && data.tema !== temaAtual()) {
    localStorage.setItem(TEMA_CHAVE_LOCAL, data.tema);
    temaAplicarNoDom(data.tema);
    temaAtualizarBotao(data.tema);
  }
}

function temaAtualizarBotao(tema) {
  const btn = document.getElementById('tema-toggle-btn');
  if (!btn) return;
  const claro = tema === 'claro';
  btn.innerHTML = claro
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';
  btn.style.background = claro ? '#ffffff' : '#1e2633';
  btn.style.color = claro ? '#10151f' : '#e5e9f0';
  btn.style.borderColor = claro ? '#d5dae2' : '#2a3444';
}

function temaInserirBotao() {
  const btn = document.createElement('button');
  btn.id = 'tema-toggle-btn';
  btn.type = 'button';
  btn.title = 'Alternar tema claro/escuro';
  btn.style.cssText = 'position:fixed;top:16px;right:16px;z-index:99998;width:38px;height:38px;border-radius:50%;border:1px solid;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.15);';
  btn.addEventListener('click', function () {
    temaSalvar(temaAtual() === 'claro' ? 'escuro' : 'claro');
  });
  document.body.appendChild(btn);
  temaAtualizarBotao(temaAtual());
}

(function temaInit() {
  temaAplicarNoDom(temaAtual());
  document.addEventListener('DOMContentLoaded', function () {
    temaInserirBotao();
    temaCarregarDaConta();
  });
})();
```

- [ ] **Step 2: Commit**

```bash
git add js/tema.js
git commit -m "feat: add js/tema.js — shared light/dark theme engine"
```

---

### Task 3: Wire em `login.html` (página x-dc, sem sessão)

**Files:**
- Modify: `login.html`

- [ ] **Step 1: Incluir o script**

Adicionar logo antes de `</body>` (depois do script de mostrar/ocultar senha que já existe no fim do arquivo):

```html
<script>window.TEMA_CONTA = 'nenhuma';</script>
<script src="js/tema.js"></script>
```

- [ ] **Step 2: Testar localmente**

```bash
cd "/Users/viniciusrocha/Projetos CODE/elo-fitness"
python3 -m http.server 8940 &
```
Abrir `http://localhost:8940/login.html`, clicar no botão sol (canto superior direito): fundo deve virar claro, texto escuro, botão de "Criar conta" e inputs legíveis. Clicar de novo: volta pro escuro. Dar F5 depois de deixar em claro: deve abrir já em claro (veio do `localStorage`, já que não há sessão).

- [ ] **Step 3: Commit**

```bash
git add login.html
git commit -m "feat: wire theme toggle into login.html"
```

---

### Task 4: Wire em `painel-adm.html` (página vanilla — converter `<style>` pra variáveis)

**Files:**
- Modify: `painel-adm.html`

- [ ] **Step 1: Substituir o bloco `<style>` (linhas 9-86 hoje) por uma versão com variáveis CSS**

No topo do `<style>`, declarar as variáveis (valores escuros = os mesmos de hoje) e um bloco `[data-tema="claro"]` sobrescrevendo:

```css
:root {
  --bg: #0a0d13; --bg-sidebar: #0d1119; --bg-card: #10151f; --bg-hover: #141a26;
  --borda: #171d29; --borda-forte: #1a2130;
  --texto: #e5e9f0; --texto-2: #9aa4b2; --texto-3: #c4cad4; --texto-4: #66707e;
}
html[data-tema="claro"] {
  --bg: #f4f5f7; --bg-sidebar: #eef0f3; --bg-card: #ffffff; --bg-hover: #e9ebef;
  --borda: #e4e7ec; --borda-forte: #dfe3e9;
  --texto: #10151f; --texto-2: #5b6472; --texto-3: #3a4452; --texto-4: #7c8593;
}
```

Depois, trocar cada uso literal desses hex no restante do `<style>` pelas variáveis correspondentes — por exemplo `.sidebar{...background:#0d1119;border-right:1px solid #171d29;...}` vira `.sidebar{...background:var(--bg-sidebar);border-right:1px solid var(--borda);...}`. Mapeamento pra usar em cada substituição:
- `#0a0d13` → `var(--bg)`
- `#0d1119` → `var(--bg-sidebar)`
- `#10151f` → `var(--bg-card)`
- `#141a26` → `var(--bg-hover)`
- `#171d29` → `var(--borda)`
- `#1a2130` → `var(--borda-forte)`
- `#e5e9f0` → `var(--texto)`
- `#9aa4b2` → `var(--texto-2)`
- `#c4cad4` → `var(--texto-3)`
- `#66707e` → `var(--texto-4)`

Cores que não mudam de tema ficam como estão (`#f97316`, `#ea580c`, badges `rgba(...)`, etc — essas já têm contraste ok nos dois fundos).

- [ ] **Step 2: Incluir o script, informando que é conta admin**

Antes de `</body>`:
```html
<script>window.TEMA_CONTA = 'admin';</script>
<script src="js/tema.js"></script>
```

- [ ] **Step 3: Testar localmente logado como admin**

```bash
python3 -m http.server 8940 &
```
Abrir `http://localhost:8940/adm.html`, logar com `contabusinessvini@gmail.com` / `Alicativoelofitness2026@`. No painel, clicar no botão de tema: sidebar, cards e texto devem virar claros e continuar legíveis. Navegar entre Dashboard/Receita/Usuários com o tema claro ligado, conferir que gráficos e badges continuam legíveis. Dar F5: tema persiste (veio do banco, tabela `admins`).

- [ ] **Step 4: Commit**

```bash
git add painel-adm.html
git commit -m "feat: convert painel-adm.html to CSS variables and wire theme toggle"
```

---

### Task 5: Onda Aluno — `app-aluno.html`, `anamnese.html`, `convite.html`

**Files:**
- Modify: `app-aluno.html`, `anamnese.html`, `convite.html`

- [ ] **Step 1: Incluir o script em cada uma, antes de `</body>`**

Em `app-aluno.html` e `anamnese.html` (contas de aluno logado):
```html
<script>window.TEMA_CONTA = 'cliente';</script>
<script src="js/tema.js"></script>
```
Em `convite.html` (ainda sem conta no momento em que a tela carrega):
```html
<script>window.TEMA_CONTA = 'nenhuma';</script>
<script src="js/tema.js"></script>
```

- [ ] **Step 2: Testar cada uma logado como aluno**

Logar em `login.html` com `castrosavera@gmail.com` (aba "Sou aluno") ou `contabusinessvini@gmail.com`, ir em `app-aluno.html`. Alternar tema, conferir: menu lateral, cards de "Hoje", lista de exercícios, tabs de Mensagens/Evolução — tudo legível em claro. Confirmar F5 mantém o tema (veio de `clientes.tema`).

- [ ] **Step 3: Commit**

```bash
git add app-aluno.html anamnese.html convite.html
git commit -m "feat: wire theme toggle into aluno-facing pages"
```

---

### Task 6: Onda Personal — páginas x-dc

**Files:**
- Modify: `dashboard.html`, `alunos.html`, `produtos.html`, `financeiro.html`, `relatorios.html`, `agenda.html`, `perfil.html`, `configuracoes.html`, `assinatura.html`, `adicionar-aluno.html`

- [ ] **Step 1: Incluir o script em cada uma, antes de `</body>`**

```html
<script>window.TEMA_CONTA = 'trainer';</script>
<script src="js/tema.js"></script>
```

- [ ] **Step 2: Testar logado como Savera (`castrosavera@gmail.com`, aba "Sou personal")**

Passar por cada página da lista, alternando o tema e conferindo legibilidade (títulos, cards, tabelas, gráficos onde houver). Prestar atenção especial em `dashboard.html` (tem gráficos SVG com cor calculada) e `assinatura.html` (cards de plano).

- [ ] **Step 3: Commit**

```bash
git add dashboard.html alunos.html produtos.html financeiro.html relatorios.html agenda.html perfil.html configuracoes.html assinatura.html adicionar-aluno.html
git commit -m "feat: wire theme toggle into personal x-dc pages"
```

---

### Task 7: Onda Personal — páginas vanilla (converter `<style>` pra variáveis, igual Task 4)

**Files:**
- Modify: `montar-treino.html` (`<style>` nas linhas 10-137), `acervo.html` (`<style>` nas linhas 197-202 e 1535-1557 — o bloco 16-196 é `@font-face`, não precisa mexer), `aluno-detalhe.html` (`<style>` nas linhas 10-106)

- [ ] **Step 1: Em cada arquivo, repetir a conversão da Task 4**

Mesmo bloco de variáveis `:root` / `html[data-tema="claro"]` do Task 4, adaptado aos seletores específicos de cada arquivo (cada um tem suas próprias classes, mas os hex de fundo/borda/texto são os mesmos 10 valores centrais já mapeados).

- [ ] **Step 2: Incluir o script em cada uma, antes de `</body>`**

```html
<script>window.TEMA_CONTA = 'trainer';</script>
<script src="js/tema.js"></script>
```

- [ ] **Step 3: Testar logado como Savera**

`montar-treino.html`: abrir um treino de um aluno, alternar tema, conferir lista de exercícios e o toast de "desfazer" (Task anterior desta sessão) continuam legíveis nos dois temas. `acervo.html`: alternar tema nas abas de exercícios/alimentos/dietas. `aluno-detalhe.html`: alternar tema em pelo menos 3 abas diferentes (Anamnese, Treino, Avaliação Física).

- [ ] **Step 4: Commit**

```bash
git add montar-treino.html acervo.html aluno-detalhe.html
git commit -m "feat: convert remaining vanilla personal pages to CSS variables with theme toggle"
```

---

### Task 8: Onda Admin — `adm.html` + páginas restantes

**Files:**
- Modify: `adm.html` (converter `<style>` linhas 9-31, igual Task 4)

- [ ] **Step 1: Converter o `<style>` de `adm.html` pra variáveis, mesmo padrão da Task 4**

- [ ] **Step 2: Incluir o script antes de `</body>`**

```html
<script>window.TEMA_CONTA = 'nenhuma';</script>
<script src="js/tema.js"></script>
```
(`adm.html` é a tela de login do admin — ainda sem sessão quando carrega, igual `login.html`.)

- [ ] **Step 3: Testar**

Abrir `adm.html` sem estar logado, alternar tema, conferir formulário de login legível nos dois modos.

- [ ] **Step 4: Commit**

```bash
git add adm.html
git commit -m "feat: wire theme toggle into adm.html"
```

---

### Task 9: `index.html` e `redefinir-senha.html`

**Files:**
- Modify: `index.html`, `redefinir-senha.html`

- [ ] **Step 1: Incluir o script (sem sessão) antes de `</body>` nos dois**

```html
<script>window.TEMA_CONTA = 'nenhuma';</script>
<script src="js/tema.js"></script>
```

- [ ] **Step 2: Testar cada uma isoladamente**

`redefinir-senha.html`: abrir direto (sem link válido), confirmar que a tela de "link inválido" fica legível nos dois temas.

- [ ] **Step 3: Commit**

```bash
git add index.html redefinir-senha.html
git commit -m "feat: wire theme toggle into index.html and redefinir-senha.html"
```

---

## Self-Review

**Cobertura da spec:** infra (Task 1-2), botão sol/lua (Task 2), páginas x-dc via DOM-walk (Task 3, 5, 6), páginas vanilla via CSS vars (Task 4, 7, 8), persistência na conta com fallback local (Task 2), ondas aluno→personal→admin (Task 5→6/7→8), páginas sem sessão (Task 3, 8, 9). Todas as 24 páginas do app estão cobertas entre as Tasks 3, 5, 6, 7, 8 e 9.

**Consistência:** `temaTabelaDaConta()` (Task 2) mapeia exatamente os 3 valores de `window.TEMA_CONTA` usados em todas as tasks seguintes (`'trainer'`, `'cliente'`, `'admin'`) mais `'nenhuma'` pras páginas sem sessão — nenhuma task usa um valor fora desse conjunto.
