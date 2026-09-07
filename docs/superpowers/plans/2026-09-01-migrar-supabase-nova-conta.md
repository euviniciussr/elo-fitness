# Migração do Supabase para Nova Conta — Plano de Execução

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar o projeto Supabase atual (`bzjaawrzslnxwkdvwmkj`, org `vefzikkozjkdfwovlleo`) para um projeto novo em outra conta Supabase, levando junto: schema completo, dados de todas as tabelas, usuários de login (`auth.users`), fotos do bucket `fotos-evolucao` e as Edge Functions com seus secrets — sem perder nada, com uma janela curta de indisponibilidade no momento da troca final.

**Architecture:** Schema é recriado no projeto novo aplicando as 34 migrations já versionadas em `supabase/migrations/` (isso já recria o bucket `fotos-evolucao` e as RLS policies de storage, pois estão definidas como SQL na migration 0006). Os dados são movidos com `pg_dump`/`psql` (schemas `public` + `auth`, dados apenas — sem tabelas efêmeras de sessão). Os arquivos do bucket são copiados objeto a objeto via `supabase storage cp`. As Edge Functions são redeployadas e os secrets recriados manualmente (valores não são exportáveis). Por fim troca-se a URL/key no client (`js/supabase-client.js`) e faz-se o deploy.

**Tech Stack:** Supabase CLI 2.111.0 (já instalado), `psql`/`pg_dump` (vem com o CLI, ou `brew install libpq`), bash.

**Premissas assumidas** (o usuário confirmou "todos os dados, login e o que tem salvo" mas não respondeu sobre downtime nem se ainda não tinha projeto novo — já confirmado que **ainda não existe** projeto novo):
- Aceita-se uma janela curta de indisponibilidade no corte final (mais simples e seguro que sincronização ao vivo). Se isso não for aceitável, avisar antes de rodar a Task 8.
- "Tudo que tem salvo" inclui as fotos do bucket `fotos-evolucao` (fotos de evolução dos alunos e foto ao finalizar treino) — são dados de usuário, não fazem sentido ficar de fora.
- Edge Functions e secrets (`FATSECRET_CLIENT_ID`/`FATSECRET_CLIENT_SECRET`) também migram, senão a busca de alimentos (TACO/FatSecret) quebra no projeto novo.

---

### Task 0: Criar o projeto novo e reunir credenciais

**Files:** nenhum (ação manual no dashboard Supabase + terminal)

- [ ] **Passo 1: Criar organização/projeto na conta nova**

No navegador, logado na conta Supabase de destino: https://supabase.com/dashboard → **New project**. Nome sugerido: `elo-fitness` (ou o mesmo nome do atual, `perfomaaiV2`). Escolher a região mais próxima da atual (para manter latência). Anotar a **senha do banco de dados** definida na criação — vai ser necessária várias vezes abaixo.

- [ ] **Passo 2: Guardar os valores do FatSecret**

Os secrets atuais (`FATSECRET_CLIENT_ID`, `FATSECRET_CLIENT_SECRET`) não podem ser lidos de volta do projeto antigo via CLI (`supabase secrets list` só mostra os nomes, não os valores). Se você não tem esses valores salvos em algum gerenciador de senhas, pegue-os agora em https://platform.fatsecret.com/ (My Apps) antes de continuar — sem isso a busca de alimentos vai quebrar no projeto novo.

- [ ] **Passo 3: Anotar o ref do projeto novo**

No dashboard do projeto novo: **Project Settings → General → Reference ID**. Vai ser usado como `<NEW_REF>` nos comandos abaixo.

- [ ] **Passo 4: Login do CLI na conta nova (se for uma conta Supabase diferente da logada agora)**

```bash
supabase login
```

Isso abre o navegador para autenticar. Se a conta nova for logada com o mesmo usuário/browser, pode ser necessário logout da sessão CLI atual primeiro (`supabase logout`) antes de logar na conta certa — confirme com `supabase projects list` que o projeto novo aparece na lista antes de seguir.

---

### Task 1: Congelar escritas no app antigo (janela de manutenção)

**Files:** nenhum

- [ ] **Passo 1: Avisar os usuários (se aplicável) e evitar novos logins/gravações durante a migração**

Como o app roda como páginas estáticas (Vercel) direto contra o Supabase, a forma mais simples de "congelar" é fazer a migração de dados (Task 3 em diante) num horário de baixo uso e, no momento do dump final de dados, considerá-lo como o corte oficial — qualquer gravação feita **depois** do dump da Task 3 não vai para o projeto novo. Não é necessário tirar o site do ar; só evite avisar "pode usar" para trainers/alunos até a Task 9 confirmar que o cutover terminou.

---

### Task 2: Recriar o schema no projeto novo (a partir das migrations)

**Files:**
- Usa: `supabase/migrations/*.sql` (34 arquivos já existentes, sem alteração)

- [ ] **Passo 1: Linkar o CLI ao projeto novo**

```bash
cd "/Users/viniciusrocha/Projetos CODE/elo-fitness"
supabase link --project-ref <NEW_REF>
```

Quando pedir a senha do banco, usar a senha anotada na Task 0 Passo 1.

- [ ] **Passo 2: Aplicar todas as migrations no projeto novo**

```bash
supabase db push --linked
```

Expected: lista as 34 migrations (`0001_init.sql` até `0034_timer_descanso.sql`) e aplica todas sem erro. Isso recria tabelas, functions, triggers, RLS policies **e** o bucket `fotos-evolucao` com suas policies (definidos em `0006_aluno_e_nutricao.sql:238-278`).

- [ ] **Passo 3: Verificar que o schema bateu**

```bash
supabase migration list --linked
```

Expected: todas as 34 migrations aparecem com `✓` tanto em "Local" quanto em "Remote".

---

### Task 3: Migrar os dados (tabelas `public` + usuários de login em `auth`)

**Files:**
- Cria (fora do repo, dados sensíveis): `$BACKUP_DIR/data.sql`

- [ ] **Passo 1: Preparar diretório de backup fora do repositório**

```bash
export BACKUP_DIR="/private/tmp/claude-501/-Users-viniciusrocha-Projetos-CODE-perfomaaiV2/7f4fc26c-0c45-4d0d-a25f-6fcc1acb2d95/scratchpad/supabase-migration"
mkdir -p "$BACKUP_DIR"
```

Esse diretório contém dados pessoais e hashes de senha reais — nunca commitar no git, e apagar ao final (Task 9).

- [ ] **Passo 2: Pegar as connection strings dos dois projetos**

No dashboard de **cada** projeto: **Project Settings → Database → Connection string → URI** (modo "Session pooler" ou "Direct connection"). Elas têm o formato:

```
postgresql://postgres.<ref>:<SENHA-URL-ENCODED>@aws-0-<região>.pooler.supabase.com:5432/postgres
```

```bash
export OLD_DB_URL="postgresql://postgres.bzjaawrzslnxwkdvwmkj:<SENHA_ANTIGA>@aws-0-<regiao>.pooler.supabase.com:5432/postgres"
export NEW_DB_URL="postgresql://postgres.<NEW_REF>:<SENHA_NOVA>@aws-0-<regiao>.pooler.supabase.com:5432/postgres"
```

A senha precisa estar **percent-encoded** se tiver caracteres especiais (`@`, `#`, `/` etc).

- [ ] **Passo 3: Dump dos dados do projeto antigo (public + auth, sem tabelas de sessão efêmeras)**

```bash
cd "/Users/viniciusrocha/Projetos CODE/elo-fitness"
supabase link --project-ref bzjaawrzslnxwkdvwmkj
supabase db dump --linked --data-only \
  --schema public,auth \
  -x auth.audit_log_entries \
  -x auth.flow_state \
  -x auth.refresh_tokens \
  -x auth.sessions \
  -x auth.mfa_challenges \
  -x auth.mfa_factors \
  -x auth.one_time_tokens \
  -x auth.sso_providers \
  -x auth.sso_domains \
  -x auth.saml_providers \
  -x auth.saml_relay_states \
  -f "$BACKUP_DIR/data.sql"
```

Expected: gera `$BACKUP_DIR/data.sql` sem erro. As tabelas excluídas são sessões/tokens ativos e SSO — não fazem parte de "dados salvos" do app; usuários vão simplesmente logar de novo com a mesma senha (o hash da senha em si, que é o que importa, está em `auth.users` e **está incluído**).

- [ ] **Passo 4: Restaurar os dados no projeto novo**

```bash
psql "$NEW_DB_URL" -f "$BACKUP_DIR/data.sql"
```

Expected: roda sem erros de constraint (a ordem de `auth.users` antes de `public.clientes`/`public.trainers` é resolvida automaticamente pelo `pg_dump` via dependência de FK).

- [ ] **Passo 5: Verificar contagem de linhas tabela por tabela**

```bash
for t in agendamentos alimentos anamnese_respostas anamnese_respostas_dinamicas \
  anamnese_templates cardio_protocolos clientes convites dietas exercicios \
  feedbacks_treino food_favoritos food_recentes food_search_cache \
  formulas_alimentares fotos_evolucao notificacoes pagamentos \
  refeicoes_predefinidas registros_peso serie_cargas series_predefinidas \
  taco_alimentos tbca_alimentos tecnicas_avancadas trainers treino_execucoes \
  treino_exercicio_execucoes treino_exercicios treino_serie_execucoes treinos; do
  old=$(psql "$OLD_DB_URL" -tAc "select count(*) from public.$t")
  new=$(psql "$NEW_DB_URL" -tAc "select count(*) from public.$t")
  status="OK"; [ "$old" != "$new" ] && status="MISMATCH"
  echo "$t: old=$old new=$new $status"
done
old_users=$(psql "$OLD_DB_URL" -tAc "select count(*) from auth.users")
new_users=$(psql "$NEW_DB_URL" -tAc "select count(*) from auth.users")
echo "auth.users: old=$old_users new=$new_users"
```

Expected: toda linha termina em `OK`, e `auth.users: old=N new=N` com os mesmos números. Se alguma tabela der `MISMATCH`, parar e investigar antes de seguir (não passar para a Task 4).

---

### Task 4: Migrar os arquivos do bucket `fotos-evolucao`

**Files:**
- Cria (fora do repo): `$BACKUP_DIR/fotos-evolucao/` (cópia local temporária dos arquivos)

- [ ] **Passo 1: Baixar todos os arquivos do bucket do projeto antigo**

```bash
supabase link --project-ref bzjaawrzslnxwkdvwmkj
supabase storage cp --linked -r "ss:///fotos-evolucao" "$BACKUP_DIR/fotos-evolucao" --jobs 4
```

Expected: baixa todos os objetos do bucket para `$BACKUP_DIR/fotos-evolucao/`, preservando a estrutura de pastas (`<cliente_id>/...`).

- [ ] **Passo 2: Subir os arquivos para o bucket do projeto novo**

O bucket já existe (criado pela Task 2, via migration 0006). Fazer upload preservando os caminhos:

```bash
supabase link --project-ref <NEW_REF>
supabase storage cp --linked -r "$BACKUP_DIR/fotos-evolucao/" "ss:///fotos-evolucao" --jobs 4
```

- [ ] **Passo 3: Verificar contagem de objetos**

```bash
old_files=$(find "$BACKUP_DIR/fotos-evolucao" -type f | wc -l)
new_count=$(psql "$NEW_DB_URL" -tAc "select count(*) from storage.objects where bucket_id = 'fotos-evolucao'")
echo "arquivos baixados: $old_files | objetos no bucket novo: $new_count"
```

Expected: os dois números batem (ou o segundo é levemente maior/menor por causa de placeholder files do storage — investigar se a diferença for grande).

---

### Task 5: Migrar Edge Functions e secrets

**Files:**
- Usa: `supabase/functions/*` (sem alteração)

- [ ] **Passo 1: Deploy de todas as functions no projeto novo**

```bash
cd "/Users/viniciusrocha/Projetos CODE/elo-fitness"
supabase link --project-ref <NEW_REF>
supabase functions deploy --linked
```

Expected: `food-search`, `food-get`, `food-barcode`, `food-autocomplete` aparecem deployadas sem erro. `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são injetadas automaticamente pelo runtime do projeto novo — não precisa configurar.

- [ ] **Passo 2: Configurar os secrets do FatSecret**

```bash
supabase secrets set --linked \
  FATSECRET_CLIENT_ID="<valor anotado na Task 0>" \
  FATSECRET_CLIENT_SECRET="<valor anotado na Task 0>"
```

- [ ] **Passo 3: Testar uma function**

```bash
curl -i "https://<NEW_REF>.supabase.co/functions/v1/food-search?q=arroz" \
  -H "Authorization: Bearer <NEW_ANON_KEY>"
```

Expected: `200 OK` com resultados de busca de alimentos (confirma que o secret do FatSecret está correto).

---

### Task 6: Reconfigurar Auth settings no projeto novo

**Files:** nenhum (dashboard)

Configurações de `Authentication → URL Configuration` e `Authentication → Providers` **não fazem parte do banco de dados** e não são migradas por `db push`/`db dump`. Conferir no projeto antigo (dashboard) e replicar manualmente no novo:

- [ ] **Passo 1:** `Authentication → URL Configuration` — copiar **Site URL** e **Redirect URLs** (domínio do app em produção, ex: Vercel).
- [ ] **Passo 2:** `Authentication → Providers` — conferir se só usa email/senha ou se há OAuth (Google etc). Se houver, recriar as credenciais do provider no projeto novo (client id/secret não migram).
- [ ] **Passo 3:** `Authentication → Emails` — se os templates de email (convite, recuperação de senha) foram customizados no projeto antigo, copiar o HTML para o projeto novo.

---

### Task 7: Atualizar o client do app com as credenciais novas

**Files:**
- Modify: `js/supabase-client.js:2-3`

- [ ] **Passo 1: Trocar URL e anon key**

Pegar em **Project Settings → API** do projeto novo: `Project URL` e `anon` / `publishable` key.

```javascript
// Anon/publishable key is safe to expose client-side — access is enforced by RLS policies in Supabase.
const SUPABASE_URL = 'https://<NEW_REF>.supabase.co';
const SUPABASE_ANON_KEY = '<NEW_ANON_KEY>';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

- [ ] **Passo 2: Conferir que não há outra referência hardcoded**

```bash
cd "/Users/viniciusrocha/Projetos CODE/elo-fitness"
grep -rln "bzjaawrzslnxwkdvwmkj" --include="*.js" --include="*.html" --include="*.ts" --include="*.json" .
```

Expected: nenhum resultado fora de `js/supabase-client.js` (já confirmado antes do plano: só esse arquivo e `supabase/functions/_shared/supabase.ts`, que usa `Deno.env.get` — não precisa mudar).

---

### Task 8: Verificação end-to-end antes do cutover

**Files:** nenhum

- [ ] **Passo 1: Testar login local apontando pro projeto novo**

Com `js/supabase-client.js` já apontando pro projeto novo (Task 7), abrir `login.html` localmente (ex: `python3 -m http.server` na pasta do repo) e logar com um usuário trainer real que já existia no banco antigo. Expected: login funciona com a **mesma senha de antes** (confirma que `auth.users` migrou certo).

- [ ] **Passo 2: Testar leitura de dados**

Navegar em `alunos.html` / `dashboard.html` do trainer logado. Expected: lista de alunos, treinos e dados aparecem, iguais ao que existia no projeto antigo.

- [ ] **Passo 3: Testar fotos**

Abrir `aluno-detalhe.html` de um aluno que tenha foto de evolução salva. Expected: a foto carrega (confirma que o `createSignedUrls` do bucket novo funciona e o arquivo foi copiado certo na Task 4).

- [ ] **Passo 4: Testar busca de alimentos (edge function)**

Em `montar-dieta.html`, buscar um alimento. Expected: resultados aparecem (confirma Task 5).

---

### Task 9: Cutover, deploy e limpeza

**Files:**
- Modify: `js/supabase-client.js` (já commitado na Task 7)

- [ ] **Passo 1: Repetir a Task 3 (dump/restore de dados) uma última vez**

Se passou tempo entre a Task 3 e agora e o app antigo continuou em uso, rodar de novo os Passos 3–5 da Task 3 (e o Passo 1–3 da Task 4 se houve fotos novas) para pegar as gravações mais recentes. Esse é o corte oficial — a partir daqui, o app antigo deve parar de receber gravações.

- [ ] **Passo 2: Commit e deploy do client atualizado**

```bash
cd "/Users/viniciusrocha/Projetos CODE/elo-fitness"
git add js/supabase-client.js
git commit -m "chore: migrar client para novo projeto Supabase

Claude-Session: https://claude.ai/code/session_01MrtRezn1s7eVDDLNe6MQqB"
git push
```

(Confirmar com o usuário antes deste push, conforme protocolo de segurança em ações que afetam sistemas compartilhados.) Se o deploy é via Vercel automático no push, aguardar o build finalizar e testar em produção (repetir os testes da Task 8, agora no domínio real).

- [ ] **Passo 3: Manter o projeto antigo pausado, não deletado**

No dashboard do projeto antigo (`bzjaawrzslnxwkdvwmkj`): não excluir ainda. Deixar como está por pelo menos alguns dias como rede de segurança, e só considerar excluir/pausar depois de confirmar que o app novo está estável em produção.

- [ ] **Passo 4: Apagar os backups locais sensíveis**

```bash
rm -rf "$BACKUP_DIR"
```

Esses arquivos contêm hashes de senha e dados pessoais de alunos — não devem ficar soltos no disco depois que a migração for validada.

---

## Self-review

- **Cobertura:** schema (Task 2), dados de tabelas (Task 3), login/`auth.users` (Task 3), fotos/storage (Task 4), edge functions + secrets (Task 5), auth settings não-SQL (Task 6), client do app (Task 7), verificação (Task 8), corte final + limpeza (Task 9) — cobre "todos os dados, login e o que tem salvo" conforme pedido.
- **Placeholders:** os únicos valores entre `<...>` são credenciais que só existem depois que o usuário cria o projeto novo (Task 0) — não há como ter esses valores de antemão; todo o resto do plano tem comandos completos.
- **Risco maior sinalizado:** secrets do FatSecret não são recuperáveis via CLI do projeto antigo — Task 0 Passo 2 avisa para separar isso primeiro.
