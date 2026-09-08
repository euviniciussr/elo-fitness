# Gestão de treinos: excluir, copiar entre alunos, nomenclatura Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir excluir um treino da programação de um aluno, copiar um treino para outro aluno de forma independente, e corrigir a nomenclatura "Séries válidas" → "Repetições" na interface do aluno — sem alterar cálculo, execução ou carga.

**Architecture:** Duas apps estáticas (`montar-treino.html`, `app-aluno.html`), sem build/bundler, sem test runner automatizado (projeto Vercel puramente estático). Verificação é manual/por leitura de código, não `pytest`/`jest`. Todo o trabalho reaproveita padrões já existentes no próprio arquivo (`.btn.btn-secondary`, `.modal-overlay`/`.modal-box`, `window.confirm`, `crypto.randomUUID()` pra `grupo_id`).

**Tech Stack:** HTML/CSS/JS vanilla, Supabase JS client v2 (`supabaseClient`), deploy Vercel (push em `main` = deploy automático).

---

### Task 1: Corrigir cópia incompleta de `duplicarTreino` (extrair helper compartilhado)

**Files:**
- Modify: `montar-treino.html:863-894` (função `duplicarTreino`)

`duplicarTreino` hoje só copia `exercicio_id, ordem, series_aquecimento, series, intervalo_descanso, descanso_segundos, tecnica_avancada` — perde `observacoes`, `tecnica_instrucoes`, `carga` e `grupo_id` (agrupamento Super Set/Bi-Set/Tri-Set). Extraio a cópia de `treino_exercicios` pra uma função `copiarExerciciosParaTreino`, usada aqui e na Task 3.

- [ ] **Step 1: Substituir o corpo de `duplicarTreino` e adicionar o helper**

Trocar (linhas 863-894):

```javascript
async function duplicarTreino(treino) {
  const usados = new Set(treinos.map(t => t.nome));
  let novoNome = null;
  const m = treino.nome.match(/^Treino ([A-Z])$/);
  if (m) {
    const livre = LETRAS.find(l => !usados.has('Treino ' + l));
    if (livre) novoNome = 'Treino ' + livre;
  }
  if (!novoNome) novoNome = treino.nome + ' (cópia)';

  const { data: novo, error } = await supabaseClient.from('treinos').insert({
    trainer_id: userId, cliente_id: treino.cliente_id, nome: novoNome,
    dias_semana: treino.dias_semana || [], habilitado: true,
    split_id: splitId, ordem: treinos.length
  }).select().single();
  if (error) { alert('Não foi possível duplicar: ' + error.message); return; }

  const exs = treino._exercicios || [];
  if (exs.length) {
    await supabaseClient.from('treino_exercicios').insert(exs.map((te, i) => ({
      treino_id: novo.id, exercicio_id: te.exercicio_id,
      ordem: i, series_aquecimento: te.series_aquecimento, series: te.series, intervalo_descanso: te.intervalo_descanso,
      descanso_segundos: te.descanso_segundos, tecnica_avancada: te.tecnica_avancada
    })));
  }

  novo._exercicios = [];
  await loadExerciciosDoTreino(novo);
  treinos.push(novo);
  activeIndex = treinos.length - 1;
  renderMontar();
}
```

Por:

```javascript
// Copia treino_exercicios de `origemTreino` (objeto com ._exercicios já
// carregado) pra `destinoTreinoId`, preservando todos os campos de
// configuração (inclusive grupo_id de combos Super/Bi/Tri-Set, remapeado
// pra um novo uuid por grupo) e SEM copiar nada específico do aluno de
// origem (carga registrada, execuções, feedback — essas tabelas nem são
// tocadas aqui, só treino_exercicios).
async function copiarExerciciosParaTreino(origemTreino, destinoTreinoId) {
  const exs = origemTreino._exercicios || [];
  if (!exs.length) return;
  const grupoMap = {};
  await supabaseClient.from('treino_exercicios').insert(exs.map((te, i) => {
    let novoGrupoId = null;
    if (te.grupo_id) {
      if (!grupoMap[te.grupo_id]) grupoMap[te.grupo_id] = crypto.randomUUID();
      novoGrupoId = grupoMap[te.grupo_id];
    }
    return {
      treino_id: destinoTreinoId, exercicio_id: te.exercicio_id, ordem: i,
      series_aquecimento: te.series_aquecimento, series: te.series,
      intervalo_descanso: te.intervalo_descanso, descanso_segundos: te.descanso_segundos,
      tecnica_avancada: te.tecnica_avancada, tecnica_instrucoes: te.tecnica_instrucoes,
      observacoes: te.observacoes, carga: te.carga, grupo_id: novoGrupoId
    };
  }));
}

async function duplicarTreino(treino) {
  const usados = new Set(treinos.map(t => t.nome));
  let novoNome = null;
  const m = treino.nome.match(/^Treino ([A-Z])$/);
  if (m) {
    const livre = LETRAS.find(l => !usados.has('Treino ' + l));
    if (livre) novoNome = 'Treino ' + livre;
  }
  if (!novoNome) novoNome = treino.nome + ' (cópia)';

  const maiorOrdem = treinos.reduce((max, t) => Math.max(max, t.ordem), -1);
  const { data: novo, error } = await supabaseClient.from('treinos').insert({
    trainer_id: userId, cliente_id: treino.cliente_id, nome: novoNome,
    dias_semana: treino.dias_semana || [], habilitado: true,
    split_id: splitId, ordem: maiorOrdem + 1
  }).select().single();
  if (error) { alert('Não foi possível duplicar: ' + error.message); return; }

  await copiarExerciciosParaTreino(treino, novo.id);

  novo._exercicios = [];
  await loadExerciciosDoTreino(novo);
  treinos.push(novo);
  activeIndex = treinos.length - 1;
  renderMontar();
}
```

Mudanças: (a) `ordem: treinos.length` → `ordem: maiorOrdem + 1` (evita colisão depois que uma exclusão criar buracos na sequência — Task 2); (b) corpo de cópia de exercícios extraído pro helper, agora incluindo `tecnica_instrucoes`, `observacoes`, `carga` e `grupo_id` remapeado.

- [ ] **Step 2: Verificar manualmente**

Ler o trecho editado de volta (`sed -n '860,930p' montar-treino.html`) e conferir: chaves/parênteses balanceados, `copiarExerciciosParaTreino` declarada antes de `duplicarTreino` usá-la (ordem de declaração não importa em function declarations, mas confirmar que não virou `const`/arrow function por engano).

- [ ] **Step 3: Commit**

```bash
cd "/Users/viniciusrocha/Projetos CODE/elo-fitness"
git add montar-treino.html
git commit -m "fix: preserve grupo_id, observacoes, tecnica_instrucoes and carga when duplicating a treino"
```

---

### Task 2: Excluir treino

**Files:**
- Modify: `montar-treino.html:992-1016` (`renderMontar`) e `montar-treino.html:1192-1211` (`renderTreinoBody`, `nomeRow`)

- [ ] **Step 1: Adicionar `excluirTreino` e o botão**

Adicionar logo depois do fechamento de `duplicarTreino` (após o `}` que fecha a função, resultado da Task 1):

```javascript
async function excluirTreino(treino) {
  if (!window.confirm('Excluir "' + treino.nome + '"? Essa ação não pode ser desfeita.')) return;
  const { error } = await supabaseClient.from('treinos').delete().eq('id', treino.id);
  if (error) { alert('Não foi possível excluir: ' + error.message); return; }

  const i = treinos.indexOf(treino);
  treinos.splice(i, 1);
  if (treinos.length === 0) {
    window.location.href = 'alunos.html';
    return;
  }
  activeIndex = Math.min(i, treinos.length - 1);
  formMode = { type: 'add' };
  renderMontar();
}
```

Em `renderTreinoBody` (`montar-treino.html:1208-1210`), trocar:

```javascript
  const duplicarBtn = el('<button type="button" class="btn btn-secondary" style="white-space:nowrap;">⎘ Duplicar treino</button>');
  duplicarBtn.addEventListener('click', () => duplicarTreino(treino));
  nomeRow.appendChild(duplicarBtn);
```

Por:

```javascript
  const duplicarBtn = el('<button type="button" class="btn btn-secondary" style="white-space:nowrap;">⎘ Duplicar treino</button>');
  duplicarBtn.addEventListener('click', () => duplicarTreino(treino));
  nomeRow.appendChild(duplicarBtn);
  const excluirBtn = el('<button type="button" class="btn btn-secondary" style="white-space:nowrap;color:var(--erro);">🗑 Excluir treino</button>');
  excluirBtn.addEventListener('click', () => excluirTreino(treino));
  nomeRow.appendChild(excluirBtn);
```

- [ ] **Step 2: Verificar manualmente**

Conferir que `nomeRow` (um flex row) comporta 3 botões (Duplicar, Excluir, e o de Copiar da Task 3) sem quebrar layout — `style="white-space:nowrap;"` já evita quebra de texto; o container é flex, então eles ficam lado a lado.

- [ ] **Step 3: Commit**

```bash
git add montar-treino.html
git commit -m "feat: allow deleting a treino from a student's programação"
```

---

### Task 3: Copiar para outro aluno

**Files:**
- Modify: `montar-treino.html:1208-1213` (novo botão em `nomeRow`, depois do de Excluir)
- Modify: `montar-treino.html` (nova função `abrirModalCopiarParaAluno`, colocar logo após `excluirTreino`)

- [ ] **Step 1: Adicionar a função do modal**

```javascript
function abrirModalCopiarParaAluno(treino) {
  const outrosAlunos = clientes.filter(c => c.id !== treino.cliente_id);
  const overlay = el('<div class="modal-overlay"></div>');
  const box = el('<div class="modal-box" style="max-width:420px;"></div>');
  box.appendChild(el('<h2>Copiar treino para outro aluno</h2>'));

  if (!outrosAlunos.length) {
    box.appendChild(el('<div class="sub" style="margin:0;">Você não tem outro aluno cadastrado ainda.</div>'));
    const fecharBtn = el('<button type="button" class="btn btn-secondary" style="margin-top:16px;">Fechar</button>');
    fecharBtn.addEventListener('click', () => overlay.remove());
    box.appendChild(fecharBtn);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    return;
  }

  const label = el('<label>Selecione o aluno para receber este treino</label>');
  const sel = el('<select><option value="">Escolha o aluno…</option></select>');
  outrosAlunos.forEach(c => sel.appendChild(el('<option value="' + c.id + '">' + c.nome + '</option>')));
  const erro = el('<div class="erro" style="display:none;"></div>');
  const confirmWrap = el('<div style="display:none;margin-top:14px;"></div>');
  const confirmTexto = el('<div class="sub" style="margin:0 0 14px;"></div>');
  const btnRow = el('<div style="display:flex;gap:10px;"></div>');
  const cancelBtn = el('<button type="button" class="btn btn-secondary" style="flex:1;">Cancelar</button>');
  const copiarBtn = el('<button type="button" class="btn btn-primary" style="flex:1;">Copiar treino</button>');
  cancelBtn.addEventListener('click', () => { confirmWrap.style.display = 'none'; });
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(copiarBtn);
  confirmWrap.appendChild(confirmTexto);
  confirmWrap.appendChild(btnRow);

  const escolherBtn = el('<button type="button" class="btn btn-primary" style="margin-top:14px;width:100%;" disabled>Copiar treino</button>');
  sel.addEventListener('change', () => { escolherBtn.disabled = !sel.value; erro.style.display = 'none'; });
  escolherBtn.addEventListener('click', () => {
    const aluno = outrosAlunos.find(c => c.id === sel.value);
    if (!aluno) return;
    confirmTexto.textContent = 'Copiar este treino para ' + aluno.nome + '?';
    confirmWrap.style.display = '';
  });

  copiarBtn.addEventListener('click', async () => {
    const aluno = outrosAlunos.find(c => c.id === sel.value);
    if (!aluno) return;
    copiarBtn.disabled = true;
    copiarBtn.textContent = 'Copiando…';
    const novoSplitId = crypto.randomUUID();
    const { data: novo, error } = await supabaseClient.from('treinos').insert({
      trainer_id: userId, cliente_id: aluno.id, nome: treino.nome,
      dias_semana: treino.dias_semana || [], habilitado: false,
      split_id: novoSplitId, ordem: 0
    }).select().single();
    if (error) {
      erro.textContent = error.message;
      erro.style.display = '';
      copiarBtn.disabled = false;
      copiarBtn.textContent = 'Copiar treino';
      return;
    }
    await copiarExerciciosParaTreino(treino, novo.id);
    overlay.remove();
    alert('Treino copiado para ' + aluno.nome + '. Ele está oculto pro aluno até você habilitar a visibilidade na divisão dele.');
  });

  box.appendChild(label);
  box.appendChild(sel);
  box.appendChild(erro);
  box.appendChild(escolherBtn);
  box.appendChild(confirmWrap);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}
```

- [ ] **Step 2: Adicionar o botão em `nomeRow`**

Depois do bloco do `excluirBtn` (adicionado na Task 2), acrescentar:

```javascript
  const copiarBtn = el('<button type="button" class="btn btn-secondary" style="white-space:nowrap;">↷ Copiar para outro aluno</button>');
  copiarBtn.addEventListener('click', () => abrirModalCopiarParaAluno(treino));
  nomeRow.appendChild(copiarBtn);
```

- [ ] **Step 3: Verificar manualmente**

Conferir que `copiarExerciciosParaTreino` (definida na Task 1) é reaproveitada sem duplicar lógica; conferir que `clientes` (array global já carregado em `init()`) tem `{id, nome}` — confere com o uso em `renderAplicarBox` (linha ~1671-1673).

- [ ] **Step 4: Commit**

```bash
git add montar-treino.html
git commit -m "feat: add 'copiar para outro aluno' as a separate action from duplicar treino"
```

---

### Task 4: Nomenclatura "Repetições" na interface do aluno

**Files:**
- Modify: `app-aluno.html:512`

- [ ] **Step 1: Trocar o texto do template**

Trocar:

```html
                              <div style="font-size:12.5px;color:{{ sv.textoColor }};text-decoration:{{ sv.decoration }};">Série {{ sv.numero }} — {{ sv.texto }}</div>
```

Por:

```html
                              <div style="font-size:12.5px;color:{{ sv.textoColor }};text-decoration:{{ sv.decoration }};">Série {{ sv.numero }} — Repetições: {{ sv.texto }}</div>
```

Não mexe em `sv.texto` (continua sendo a linha crua digitada pelo personal, em qualquer formato — `8`, `8 a 10`, `10 a 12`, `15`...), em `seriesLinhas`/`expandirSeriesLinhas` (parsing), no check de série feita nem no campo de carga logo abaixo.

- [ ] **Step 2: Verificar manualmente**

Ler `app-aluno.html:508-513` de volta e confirmar que só o texto mudou, nenhum atributo `sc-*` foi tocado.

- [ ] **Step 3: Commit**

```bash
git add app-aluno.html
git commit -m "fix: label repetition values as 'Repetições' instead of bare text next to 'Séries válidas' header"
```

---

### Task 5: Verificação final e deploy

- [ ] **Step 1: Revisão estática completa do diff**

```bash
git diff HEAD~4 -- montar-treino.html app-aluno.html
```

Conferir visualmente: nenhuma função existente foi removida ou teve assinatura alterada (`renderMontar`, `renderTreinoBody`, `loadExerciciosDoTreino`, `usarTemplate`, `criarDivisao` continuam intocadas), `duplicarTreino` continua exportando o mesmo comportamento visível (mesmo botão, mesmo texto), nada em `app-aluno.html` fora da linha 512 mudou.

- [ ] **Step 2: Checklist manual (navegador) — só se houver ambiente de teste isolado disponível**

Não há test runner automatizado neste projeto. Validação real depende de abrir `montar-treino.html`/`app-aluno.html` logado como trainer/aluno de teste. Isso NÃO deve ser feito na sessão real de Chrome do usuário (risco de sobrescrever o localStorage/sessão logada real — ver nota de isolamento de testes do projeto). Se o usuário disponibilizar um perfil/conta de teste isolado, rodar o checklist do spec (`docs/superpowers/specs/2026-09-08-gestao-treinos-personal-aluno-design.md`, seção "Testes manuais"). Caso contrário, reportar explicitamente que a UI não foi testada ao vivo.

- [ ] **Step 3: Push (deploy automático via Vercel)**

```bash
git push origin main
```

Vercel deploya automaticamente a partir de `main` (projeto `perfomaai-v2`, sem passo de build — arquivos estáticos servidos diretamente).

---

## Self-Review

**Cobertura do spec:** item 1-3 (excluir) → Task 2. Item 4-7 (copiar pra outro aluno, independência, campos copiados, nomes separados) → Task 1 (helper compartilhado + fix de campos) + Task 3. Item 8-10 (nomenclatura) → Task 4. Item 11 (testes) → Task 5, com ressalva sobre ausência de test runner e risco de sessão de teste — reportado explicitamente em vez de simulado.

**Placeholders:** nenhum “TODO”/“implementar depois” — todo código é completo e colável.

**Consistência de tipos/nomes:** `copiarExerciciosParaTreino(origemTreino, destinoTreinoId)` definida na Task 1, usada sem alteração de assinatura nas Tasks 1 e 3. `excluirTreino(treino)` definida e usada na Task 2. `abrirModalCopiarParaAluno(treino)` definida e usada na Task 3.
