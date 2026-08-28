# Ajustes: Meu Treino, Técnica Personalizada, Substituíveis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three additive, independent changes to the student/trainer apps: (1) restructure "Meu treino" in app-aluno.html to show a treino list before exercise detail, (2) let the trainer override a técnica avançada's instructions per prescription, (3) let the trainer attach calorie-equivalent substitute foods to any diet item, shown to the student but never summed into totals.

**Architecture:** No test runner exists in this repo (reconstructed static HTML/JS, no package.json/build step). Verification is manual: static review + loading each page in isolation. All three changes are purely additive — no existing column, function, or template block is removed or repurposed. TBCA/FatSecret integration, `computeNutrients`/`toGrams`/`buildItemFromFood` (`js/food-measures.js`), diet Opção 1/Opção 2, daily totals, and the training assembly schema are untouched.

**Tech Stack:** Static HTML pages with two patterns — `app-aluno.html` uses the in-house dc-runtime (`{{ }}` bindings, `sc-if`/`sc-for`, `class Component extends DCLogic`); `montar-treino.html` / `montar-dieta.html` are vanilla JS (`el()` DOM builder, global mutable state, `render()`). Supabase Postgres + RLS, migrations in `supabase/migrations/*.sql`.

---

## Context already confirmed in the codebase (do not re-derive)

- `treino_exercicios` (migration `0001_init.sql`) already has generic `observacoes` (separate from technique) and `tecnica_avancada` (FK-by-text-id into `tecnicas_avancadas`).
- `tecnicas_avancadas` (migration `0012_tecnicas_avancadas.sql`) already has a per-trainer, editable `observacao` field, and it already renders to the student in app-aluno.html (`e.tecnicaObs`, lines ~454-456, sourced from `tecnica.observacao` at line ~978). The gap is only that this text is shared across every exercise that reuses the same técnica — the trainer cannot say something different for one specific prescription. Feature 2 closes exactly that gap, additively.
- Diet items live in `dietas.refeicoes` (jsonb, migration `0006_aluno_e_nutricao.sql`) — `refeicoes: [{ nome, opcoes: [{ nome, itens: [...] }] }]`. `montar-dieta.html`'s `salvarDieta()` (line ~494-498) passes `itens` straight through, so any extra key added to an item object (e.g. `substituiveis`) persists with zero schema/query changes.
- `js/food-measures.js` mirrors `supabase/functions/_shared/food/measures.ts` and exposes `computeNutrients(food, quantidade, unidade)`, `toGrams(food, quantidade, unidade)`, `availableMeasures(food)`, `foodMeasureLabel`. `montar-dieta.html`'s `buildItemFromFood(food, quantidade, unidade)` (line 259) turns a `NormalizedFood` + qty into the same item shape used everywhere (`nome, quantidade_g, kcal, proteina_g, carboidrato_g, gordura_g, fibra_g, sodio_mg, quantidade, unidade, food_source, food_source_id`). Reused as-is for substitute items.
- `app-aluno.html`'s diet totals (`somaItens`, `somaDiaria`, `totalDiario`) iterate `opcao.itens` only — nesting `substituiveis` inside an item is automatically excluded from every total, satisfying "não somar substituíveis" with no extra guard code.
- `app-aluno.html`'s treino tab already groups exercises per treino/divisão in `divisoesData` (line ~984) — the "flat list" problem is purely a template/render-vals issue, not a data-model one.

---

## Task 1 — Migration: per-prescription técnica instructions

**Files:**
- Create: `supabase/migrations/0026_tecnica_instrucoes_por_prescricao.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Permite ao trainer sobrescrever, só para esta prescrição específica, a
-- explicação de uma técnica avançada reutilizável (tecnicas_avancadas.observacao
-- continua sendo o texto padrão/fallback quando nenhuma sobrescrita é dada).
-- Aditivo: nenhuma coluna existente muda, nenhuma linha é reescrita.

alter table treino_exercicios add column if not exists tecnica_instrucoes text;

comment on column treino_exercicios.tecnica_instrucoes is
  'Explicação da técnica avançada específica desta prescrição. Quando nulo, o app usa tecnicas_avancadas.observacao (texto padrão do trainer para essa técnica) como fallback.';
```

- [ ] **Step 2: Apply the migration**

Run: `cd "/Users/viniciusrocha/Projetos CODE/perfomaaiV2" && supabase db push --linked` (or `supabase migration up --linked` per whichever the project already uses — check `supabase/functions` deployment notes / prior session history for the exact command used for migrations 0024/0025 before running).

Expected: migration applies with no errors; `select column_name from information_schema.columns where table_name = 'treino_exercicios' and column_name = 'tecnica_instrucoes';` returns one row.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0026_tecnica_instrucoes_por_prescricao.sql
git commit -m "feat: add per-prescription override for técnica avançada instructions"
```

---

## Task 2 — Trainer UI: editable técnica instructions per exercise

**Files:**
- Modify: `montar-treino.html:1174-1233` (exercise add/edit modal — técnica select + preview block)

Currently `tecObsPreview` (line 1176) is a **read-only** div showing the técnica's shared `observacao`. Replace it with an **editable textarea** that defaults to the técnica's shared text but can be customized per exercise, saved to the new `tecnica_instrucoes` column.

- [ ] **Step 1: Replace the read-only preview with an editable textarea**

Replace lines 1174-1227 with:

```javascript
  const tecWrap = el('<div><label>Técnica avançada</label></div>');
  const tecSel = el('<select></select>');
  const tecObsWrap = el('<div style="display:none;"></div>');
  const tecObsLabel = el('<label style="margin-top:10px;display:block;">Como realizar esta técnica? (edite se, nesta prescrição, for diferente do padrão)</label>');
  const tecObsTa = el('<textarea maxlength="500" placeholder="Ex: realizar a série até a falha, reduzir a carga em 20% e continuar até a falha novamente…"></textarea>');
  tecObsWrap.appendChild(tecObsLabel);
  tecObsWrap.appendChild(tecObsTa);

  const NOVA_TECNICA_VALUE = '__nova__';

  const popularTecSel = (valorSelecionado) => {
    tecSel.innerHTML = '';
    tecSel.appendChild(el('<option value="nenhuma">Nenhuma técnica avançada</option>'));
    tecnicasLib.forEach(t => {
      const opt = el('<option></option>');
      opt.value = t.id;
      opt.textContent = t.nome;
      tecSel.appendChild(opt);
    });
    tecSel.appendChild(el('<option value="' + NOVA_TECNICA_VALUE + '">+ Criar nova técnica</option>'));
    tecSel.value = valorSelecionado;
    if (tecSel.value !== valorSelecionado) tecSel.value = 'nenhuma';
  };

  // Ao trocar de técnica, a caixa de instruções é reiniciada com o padrão
  // daquela técnica (o trainer pode editar livremente a partir daí). Só na
  // carga inicial de um exercício já salvo é que usamos o texto específico
  // já gravado nesta prescrição (editTe.tecnica_instrucoes), se houver.
  const atualizarObsBox = (usarInstrucoesSalvas) => {
    const t = tecnicaPorId(tecSel.value);
    if (!t) { tecObsWrap.style.display = 'none'; tecObsTa.value = ''; return; }
    tecObsWrap.style.display = '';
    if (usarInstrucoesSalvas && editTe && editTe.tecnica_instrucoes) {
      tecObsTa.value = editTe.tecnica_instrucoes;
    } else {
      tecObsTa.value = t.observacao || '';
    }
  };

  const isComboDefault = () => {
    const biSet = tecnicasLib.find(t => t.nome === 'Bi-set');
    return biSet ? biSet.id : 'nenhuma';
  };

  popularTecSel(editTe ? (editTe.tecnica_avancada || 'nenhuma') : (isCombo ? isComboDefault() : 'nenhuma'));
  atualizarObsBox(true);

  tecSel.addEventListener('change', () => {
    if (tecSel.value === NOVA_TECNICA_VALUE) {
      const valorAnterior = 'nenhuma';
      abrirModalTecnica({
        tecnica: null,
        onSaved: (nova) => { popularTecSel(nova.id); atualizarObsBox(false); }
      });
      tecSel.value = valorAnterior;
      return;
    }
    atualizarObsBox(false);
  });

  tecWrap.appendChild(tecSel);
  form.appendChild(tecWrap);
  form.appendChild(tecObsWrap);
```

- [ ] **Step 2: Add `.tecnica-obs-preview` textarea styling**

The existing `.tecnica-obs-preview` CSS rule (`montar-treino.html:125`) styled a `<div>`. Add a sibling rule so the new `<textarea>` inside `tecObsWrap` matches the form's other textareas — find the existing generic `textarea` rule used by `descansoTa`/`obsTa` in the same modal (search `form textarea` or the shared input styling near the top `<style>` block) and confirm `tecObsTa` inherits it automatically (it's a plain `<textarea>`, same as `descansoTa`/`obsTa`, so no new CSS should be needed — verify by reading the `<style>` block once before this step and only add a rule if `textarea` isn't already styled generically).

- [ ] **Step 3: Persist `tecnica_instrucoes` in the save payload**

In the same file, the `addBtn` click handler builds `payload` around line 1252. Change:

```javascript
    const payload = {
      exercicio_id: escolhido.id,
      series: seriesTa.value.trim() || null,
      carga: cargaInput.value.trim() || null,
      intervalo_descanso: descansoTa.value.trim() || null,
      tecnica_avancada: tecSel.value,
      tecnica_instrucoes: tecSel.value === 'nenhuma' ? null : (tecObsTa.value.trim() || null),
      observacoes: obsTa.value.trim() || null
    };
```

- [ ] **Step 4: Manual verification**

Open `montar-treino.html` for a treino with an existing exercise that has "Drop set" applied. Confirm: (a) the textarea shows the técnica's shared text by default; (b) editing it and saving updates only that exercise's row (`select tecnica_instrucoes from treino_exercicios where id = '<id>'`); (c) a second exercise using the same "Drop set" técnica still shows the *original* shared text (untouched) when opened.

- [ ] **Step 5: Commit**

```bash
git add montar-treino.html
git commit -m "feat: allow per-exercise override of técnica avançada instructions"
```

---

## Task 3 — Student UI: show the per-prescription técnica text

**Files:**
- Modify: `app-aluno.html:978` (renderVals `exData` mapping)

- [ ] **Step 1: Fall back to the shared técnica text only when no override exists**

Change line 978 from:

```javascript
        tecnicaObs: tecnica ? (tecnica.observacao || '') : '',
```

to:

```javascript
        tecnicaObs: te.tecnica_instrucoes || (tecnica ? tecnica.observacao : '') || '',
```

No query change needed — `loadTreino()` already does `.select('*, exercicios(...)')` on `treino_exercicios` (`app-aluno.html:872`), so `te.tecnica_instrucoes` is already present in `te` once Task 1's migration is applied.

- [ ] **Step 2: Manual verification**

With the exercise edited in Task 2 Step 4, reload `app-aluno.html` as that student (see "Browser testing isolation" — use a separate/incognito profile, never the user's real logged-in Chrome tabs) and confirm the "Como realizar" text under "Variação: Drop set" shows the per-exercise override, while a sibling exercise using the same técnica without an override shows the técnica's shared text.

- [ ] **Step 3: Commit**

```bash
git add app-aluno.html
git commit -m "feat: prefer per-prescription técnica instructions on student app"
```

---

## Task 4 — Student UI: restructure "Meu treino" into list → detail

**Files:**
- Modify: `app-aluno.html` — state (line ~770-778), `renderVals()` treino block (lines ~966-1005, ~1106-1195), template (lines ~392-465)

- [ ] **Step 1: Add `treinoSelecionadoId` to state**

At `app-aluno.html:770-778`, change the `state` block's first line from:

```javascript
    tab: 'hoje', feitos: [],
```

to:

```javascript
    tab: 'hoje', feitos: [], treinoSelecionadoId: null,
```

- [ ] **Step 2: Track the treino id on each divisão**

At `app-aluno.html:984-991`, `divisoesData` is built without an `id`. Change:

```javascript
    const divisoesData = divisoesOrdenadas.map(tr => {
      const exs = exData.filter(e => e.treinoId === tr.id);
      const contagem = {};
      exs.forEach(e => { if (e.categoria) contagem[e.categoria] = (contagem[e.categoria] || 0) + 1; });
      const grupos = Object.keys(contagem).sort((a, b) => contagem[b] - contagem[a]);
      const dias = (tr.dias_semana || []).slice().sort((a, b) => a - b).map(d => DIA_LABELS_LONGO[d]);
      return { id: tr.id, nome: tr.nome, subtitulo: grupos.join(' e '), diasLabel: dias.length ? dias.join(', ') : '', exercicios: exs, semExercicios: exs.length === 0 };
    });
```

(only change: `return { id: tr.id, nome: ...` now includes `id`.)

- [ ] **Step 3: Make "Ver treino de hoje" jump straight into that treino's detail**

At `app-aluno.html:1127`, change:

```javascript
      irTreino: go('treino'), irAgenda: go('agenda'), irMensagens: go('mensagens'),
```

to:

```javascript
      irTreino: () => this.setState({ tab: 'treino', treinoSelecionadoId: treinoHoje ? treinoHoje.id : null }),
      irAgenda: go('agenda'), irMensagens: go('mensagens'),
```

(`treinoHoje` is already computed above at line 1046, in scope.)

- [ ] **Step 4: Replace the `divisoes:` block with list/detail split**

At `app-aluno.html:1170-1192`, replace the existing `divisoes: divisoesData.map(...)` block with:

```javascript
      mostrarListaTreinos: !this.state.treinoSelecionadoId && divisoesData.length > 0,
      divisoesLista: divisoesData.map(dv => ({
        id: dv.id,
        nome: dv.nome,
        subtitulo: dv.subtitulo,
        diasLabel: dv.diasLabel,
        qtdLabel: dv.exercicios.length + (dv.exercicios.length === 1 ? ' exercício' : ' exercícios'),
        isHoje: !!(treinoHoje && dv.id === treinoHoje.id),
        onSelecionar: () => this.setState({ treinoSelecionadoId: dv.id })
      })),
      onVoltarListaTreinos: () => this.setState({ treinoSelecionadoId: null }),
      mostrarDetalheTreino: !!this.state.treinoSelecionadoId,
      divisoes: divisoesData.filter(dv => dv.id === this.state.treinoSelecionadoId).map(dv => ({
        nome: dv.nome,
        subtitulo: dv.subtitulo,
        diasLabel: dv.diasLabel,
        semExercicios: dv.semExercicios,
        exercicios: dv.exercicios.map(e => {
          const i = e.idx;
          const done = feitos[i];
          return {
            nome: e.nome, seriesLinhas: e.seriesLinhas, carga: e.carga, descanso: e.descanso, observacoes: e.observacoes,
            tecnica: e.tecnica, tecnicaObs: e.tecnicaObs,
            temVideo: !!e.videoUrl,
            onVerVideo: () => { if (e.videoUrl) this.setState({ videoModalUrl: e.videoUrl }); },
            border: done ? 'rgba(74,222,128,.2)' : '#1a2130',
            check: done ? '✓' : '',
            checkBg: done ? 'rgba(74,222,128,.12)' : '#131a26',
            checkBorder: done ? 'rgba(74,222,128,.3)' : '#1e2633',
            decoration: done ? 'line-through' : 'none',
            nomeColor: done ? '#66707e' : '#e5e9f0',
            onCheck: () => this.setState(s => { const f = s.feitos.slice(); f[i] = !f[i]; return { feitos: f }; })
          };
        })
      })),
```

This keeps `divisoes` in exactly the same shape the existing template `<sc-for>` already consumes (Step 5 doesn't touch the exercise-card markup at all) — it's just filtered down to 0 or 1 entries by `treinoSelecionadoId`.

- [ ] **Step 5: Template — gate the existing detail block, add the list block and a back button**

At `app-aluno.html:409-465`, the block currently is:

```html
        <div style="display:flex;flex-direction:column;gap:28px;">
          <sc-for list="{{ divisoes }}" as="dv" hint-placeholder-count="2">
            ...
          </sc-for>
        </div>
```

Replace it with (list screen first, detail screen — the existing `<sc-for>` block, unchanged internally — gated behind `mostrarDetalheTreino`, plus a back button):

```html
        <sc-if value="{{ mostrarListaTreinos }}" hint-placeholder-val="{{ false }}">
          <div style="display:flex;flex-direction:column;gap:10px;">
            <sc-for list="{{ divisoesLista }}" as="dv" hint-placeholder-count="4">
              <div sc-camel-on-click="{{ dv.onSelecionar }}" style="background:#10151f;border:1px solid #1a2130;border-radius:14px;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;">
                <div style="min-width:0;">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <div style="font-size:15px;font-weight:800;">{{ dv.nome }}</div>
                    <sc-if value="{{ dv.isHoje }}" hint-placeholder-val="{{ false }}">
                      <span style="font-size:10px;font-weight:800;color:#f97316;background:rgba(249,115,22,.12);padding:3px 8px;border-radius:6px;text-transform:uppercase;letter-spacing:.03em;">hoje</span>
                    </sc-if>
                  </div>
                  <div style="font-size:12px;color:#9aa4b2;margin-top:4px;">{{ dv.subtitulo }}<sc-if value="{{ dv.diasLabel }}" hint-placeholder-val="{{ false }}"> · {{ dv.diasLabel }}</sc-if></div>
                </div>
                <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
                  <span style="font-size:11.5px;color:#66707e;">{{ dv.qtdLabel }}</span>
                  <span style="color:#4a5364;">›</span>
                </div>
              </div>
            </sc-for>
          </div>
        </sc-if>

        <sc-if value="{{ mostrarDetalheTreino }}" hint-placeholder-val="{{ false }}">
          <button type="button" sc-camel-on-click="{{ onVoltarListaTreinos }}" style="background:none;border:none;color:#9aa4b2;font-family:inherit;font-size:12.5px;font-weight:700;padding:0 0 14px;cursor:pointer;display:flex;align-items:center;gap:5px;">← Meus treinos</button>
          <div style="display:flex;flex-direction:column;gap:28px;">
            <sc-for list="{{ divisoes }}" as="dv" hint-placeholder-count="1">
              <div>
                <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #1a2130;">
                  <div style="font-size:15.5px;font-weight:800;letter-spacing:.02em;">{{ dv.nome }}</div>
                  <sc-if value="{{ dv.subtitulo }}" hint-placeholder-val="{{ true }}">
                    <div style="font-size:12px;color:#9aa4b2;">{{ dv.subtitulo }}</div>
                  </sc-if>
                  <sc-if value="{{ dv.diasLabel }}" hint-placeholder-val="{{ true }}">
                    <div style="font-size:11px;color:#66707e;margin-left:auto;">{{ dv.diasLabel }}</div>
                  </sc-if>
                </div>
                <sc-if value="{{ dv.semExercicios }}" hint-placeholder-val="{{ false }}">
                  <div style="font-size:12.5px;color:#66707e;">Seu personal ainda não adicionou exercícios nesta divisão.</div>
                </sc-if>
                <div style="display:flex;flex-direction:column;gap:12px;">
                  <sc-for list="{{ dv.exercicios }}" as="e" hint-placeholder-count="4">
                    <div style="background:#10151f;border:1px solid {{ e.border }};border-radius:14px;padding:16px 20px;">
                      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
                        <div sc-camel-on-click="{{ e.onCheck }}" style="width:36px;height:36px;flex-shrink:0;border-radius:10px;background:{{ e.checkBg }};border:1px solid {{ e.checkBorder }};display:flex;align-items:center;justify-content:center;font-size:14px;color:#4ade80;font-weight:800;cursor:pointer;">{{ e.check }}</div>
                        <div style="flex:1;min-width:0;">
                          <div style="font-size:14.5px;font-weight:700;text-decoration:{{ e.decoration }};color:{{ e.nomeColor }};">{{ e.nome }}</div>
                        </div>
                        <sc-if value="{{ e.temVideo }}" hint-placeholder-val="{{ true }}">
                          <span sc-camel-on-click="{{ e.onVerVideo }}" style="font-size:12px;font-weight:700;color:#3b82f6;background:rgba(59,130,246,.1);padding:6px 13px;border-radius:8px;cursor:pointer;flex-shrink:0;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:3px;flex-shrink:0;"><circle cx="12" cy="12" r="9"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg> vídeo</span>
                        </sc-if>
                      </div>
                      <div style="border-top:1px solid #171d29;margin-top:12px;padding-top:12px;display:flex;flex-direction:column;gap:5px;">
                        <sc-for list="{{ e.seriesLinhas }}" as="ln" hint-placeholder-count="3">
                          <div style="font-size:12.5px;color:#c7ccd6;">• {{ ln }}</div>
                        </sc-for>
                        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:4px;font-size:12px;color:#9aa4b2;">
                          <sc-if value="{{ e.carga }}" hint-placeholder-val="{{ true }}">
                            <span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><path d="M6.5 6.5 17.5 17.5"></path><rect x="2" y="9" width="4" height="6" rx="1"></rect><rect x="18" y="9" width="4" height="6" rx="1"></rect></svg>Carga: {{ e.carga }}</span>
                          </sc-if>
                          <sc-if value="{{ e.descanso }}" hint-placeholder-val="{{ true }}">
                            <span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15.5 15.5"></polyline></svg>Descanso {{ e.descanso }}</span>
                          </sc-if>
                        </div>
                        <sc-if value="{{ e.observacoes }}" hint-placeholder-val="{{ true }}">
                          <div style="font-size:12px;color:#9aa4b2;margin-top:4px;line-height:1.5;">Observação: {{ e.observacoes }}</div>
                        </sc-if>
                        <sc-if value="{{ e.tecnica }}" hint-placeholder-val="{{ true }}">
                          <div style="background:rgba(168,85,247,.06);border:1px solid rgba(168,85,247,.2);border-radius:10px;padding:10px 12px;margin-top:6px;">
                            <div style="font-size:11px;font-weight:800;color:#a855f7;margin-bottom:3px;">Variação: {{ e.tecnica }}</div>
                            <sc-if value="{{ e.tecnicaObs }}" hint-placeholder-val="{{ true }}">
                              <div style="font-size:12px;color:#9aa4b2;line-height:1.5;">Como realizar: {{ e.tecnicaObs }}</div>
                            </sc-if>
                          </div>
                        </sc-if>
                      </div>
                    </div>
                  </sc-for>
                </div>
              </div>
            </sc-for>
          </div>
        </sc-if>
```

- [ ] **Step 6: Manual verification**

Load `app-aluno.html` as a student with 2+ treinos (e.g. Treino A/B). Confirm: (a) "Meu treino" tab shows only the list of treino cards, no exercises; (b) clicking a card shows only that treino's exercises plus the "← Meus treinos" back button; (c) clicking back returns to the list; (d) from the "Hoje" tab, "Ver treino de hoje" jumps directly into today's treino detail (not the list); (e) the `treinoConcluido` finish-feedback section (line ~467, untouched) still appears/functions after finishing all exercises of the currently open treino, same as before — note this pre-existing section computes `doneCount`/`todos` from the *entire* `feitos` array across all treinos, not just the open one, which is unchanged pre-existing behavior, not something this task alters.

- [ ] **Step 7: Commit**

```bash
git add app-aluno.html
git commit -m "feat: restructure Meu Treino into a treino list before exercise detail"
```

---

## Task 5 — Pure function: solve substitute quantity for calorie equivalence

**Files:**
- Modify: `js/food-measures.js`
- Modify: `supabase/functions/_shared/food/measures.ts` (mirror, per the file's own header comment — keep both copies in sync)

- [ ] **Step 1: Add `kcalPerUnit` and `solveQuantityForKcal` to `js/food-measures.js`**

Append to the end of `js/food-measures.js` (after the existing `computeNutrients`):

```javascript
// kcal entregue por 1 unidade de `unidade` deste alimento, sem o
// arredondamento de computeNutrients (arredondar a taxa antes de escalar
// pra uma quantidade grande amplificaria o erro) — usada só por
// solveQuantityForKcal, que resolve a quantidade de um substituto
// equivalente em calorias ao alimento original (Parte "Substituíveis").
function kcalPerUnit(food, unidade) {
  if (food.isLiquid && unidade === 'ml') return (food.kcal || 0) / 100;
  const gramsPerUnit = toGrams(food, 1, unidade);
  if (gramsPerUnit == null || !isFinite(gramsPerUnit)) return null;
  return (food.kcal || 0) / 100 * gramsPerUnit;
}

// Dado um alimento substituto e uma meta de kcal (a kcal do alimento
// original que ele vai substituir), resolve quantos `unidade` desse
// substituto entregam a mesma kcal. kcal é linear em quantidade pra uma
// unidade fixa, então isso é só inverter kcalPerUnit — nenhuma lógica de
// conversão nova além da já usada em toGrams/computeNutrients.
function solveQuantityForKcal(food, targetKcal, unidade) {
  const rate = kcalPerUnit(food, unidade);
  if (!rate || !isFinite(rate)) return null;
  const qtd = targetKcal / rate;
  return isFinite(qtd) && qtd > 0 ? round1(qtd) : null;
}
```

- [ ] **Step 2: Manual verification (no test runner — quick Node check)**

Run:

```bash
cd "/Users/viniciusrocha/Projetos CODE/perfomaaiV2" && node -e "
$(cat js/food-measures.js)
const pao = { kcal: 150, isLiquid: false, measures: [{ unidade: 'unidade', grams: 50 }] };
console.log('tapioca 50kcal/100g ->', solveQuantityForKcal({ kcal: 300, isLiquid: false, measures: [] }, 150, 'g'), 'g (esperado 50)');
console.log('bebida isotonica 40kcal/100ml ->', solveQuantityForKcal({ kcal: 40, isLiquid: true, measures: [] }, 150, 'ml'), 'ml (esperado 375)');
console.log('sem conversao pra unidade cadastrada ->', solveQuantityForKcal({ kcal: 300, isLiquid: false, measures: [] }, 150, 'colher_sopa'), '(esperado null)');
"
```

Expected output: `50`, `375`, `null`.

- [ ] **Step 3: Mirror the same two functions into the TypeScript copy**

Read `supabase/functions/_shared/food/measures.ts` first to match its existing style (types, exports), then append equivalent typed versions of `kcalPerUnit` and `solveQuantityForKcal`, exported the same way the file already exports `computeNutrients`/`toGrams`. This mirror isn't consumed by Task 6-7 (those run client-side against `js/food-measures.js` only) — it's kept in sync per the file's own stated convention, for whichever future Edge Function needs server-side substitute calculation.

- [ ] **Step 4: Commit**

```bash
git add js/food-measures.js supabase/functions/_shared/food/measures.ts
git commit -m "feat: add calorie-equivalence solver for substitute foods"
```

---

## Task 6 — Trainer UI: manage substituíveis per diet item

**Files:**
- Modify: `montar-dieta.html` — item row template (lines ~452-471), new picker function (near `abrirFoodPicker`, after line ~992), `abrirEditarItem` save handler (line ~742-744)

- [ ] **Step 1: Preserve `substituiveis` when an item's quantity/food is edited**

At `montar-dieta.html:739-747`, the save handler of `abrirEditarItem` currently does:

```javascript
    saveBtn.addEventListener('click', () => {
      const qtd = Number(state.qtd);
      if (!qtd || qtd <= 0) { state.erro = 'Informe uma quantidade válida.'; renderForm(); return; }
      const novoItem = buildItemFromFood(state.food, qtd, state.unidade);
      if (!novoItem) { state.erro = 'Sem conversão disponível pra essa unidade.'; renderForm(); return; }
      opcao.itens[index] = novoItem;
      overlay.remove();
      if (onSaved) onSaved();
    });
```

`buildItemFromFood` returns a fresh object with no `substituiveis` key, which would silently delete any substitutes already registered on that item. Change the assignment line to:

```javascript
      novoItem.substituiveis = it.substituiveis || [];
      opcao.itens[index] = novoItem;
```

- [ ] **Step 2: Add a "Substituíveis" control to each item row**

At `montar-dieta.html:452-471`, the `opcao.itens.forEach` loop builds `row`/`left`/`right` for each item. Insert a substituíveis button into `right`, before `editBtn`:

```javascript
    const subCount = (it.substituiveis || []).length;
    const subBtn = el('<button type="button" class="item-sub-btn" title="Alimentos substitutos equivalentes">Substituíveis' + (subCount ? ' (' + subCount + ')' : '') + '</button>');
    subBtn.addEventListener('click', () => abrirGerenciarSubstituiveis(it, render));
    right.appendChild(subBtn);
```

(Insert this block right before the existing `const editBtn = el('<button type="button" class="item-edit" ...`.)

- [ ] **Step 3: Add `.item-sub-btn` CSS**

Find the existing `.item-edit`/`.item-remove` CSS rules in `montar-dieta.html`'s `<style>` block (small icon-button style) and add a sibling rule right after them:

```css
.item-sub-btn{background:none;border:1px solid #1e2633;color:#9aa4b2;font-family:inherit;font-size:10.5px;font-weight:700;padding:4px 9px;border-radius:7px;cursor:pointer;flex-shrink:0;}
.item-sub-btn:hover{color:#f97316;border-color:rgba(249,115,22,.3);}
```

- [ ] **Step 4: Render substituíveis under the item row (trainer sees what's saved)**

Still inside the `opcao.itens.forEach` loop (`montar-dieta.html:452-471`), after `box.appendChild(row);`, add:

```javascript
    if (it.substituiveis && it.substituiveis.length) {
      const subList = el('<div style="margin:2px 0 6px 0;padding-left:4px;border-left:2px solid #1e2633;"></div>');
      it.substituiveis.forEach((s, si) => {
        const subRow = el('<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:3px 0 3px 10px;"></div>');
        const subQtdLabel = (s.quantidade != null && s.unidade)
          ? s.quantidade + ' ' + foodMeasureLabel(s.unidade)
          : s.quantidade_g + 'g';
        subRow.appendChild(el('<span style="font-size:11.5px;color:#9aa4b2;">↳ ' + s.nome + ' — ' + subQtdLabel + ' · ' + s.kcal + ' kcal</span>'));
        const subRmBtn = el('<button type="button" class="item-remove" style="font-size:11px;">×</button>');
        subRmBtn.addEventListener('click', () => { it.substituiveis.splice(si, 1); render(); });
        subRow.appendChild(subRmBtn);
        subList.appendChild(subRow);
      });
      box.appendChild(subList);
    }
```

- [ ] **Step 5: Add `abrirGerenciarSubstituiveis` — search/select/quantity flow scoped to one item**

Add this new function after `abrirFoodPicker` ends (after `montar-dieta.html:992`, matching indentation/style of the file). It reuses `fpFetchSearch`, `fpCarregarFavoritosRecentes`, `hydrate`, `availableMeasures`, `computeNutrients`, `buildItemFromFood`, `solveQuantityForKcal` — all already defined earlier in the file/loaded scripts — and does **not** modify `abrirFoodPicker`:

```javascript
// Fluxo de "Substituíveis": igual ao seletor de alimentos (abrirFoodPicker),
// mas escopado a UM item já salvo na refeição — em vez de perguntar a
// quantidade, sugere automaticamente quantos g/ml/unidade do substituto
// equivalem à kcal do alimento original (solveQuantityForKcal, Parte
// "Substituíveis"), deixando o profissional revisar/ajustar antes de
// salvar. Empurra pra it.substituiveis — nunca pra opcao.itens, então
// nunca entra nos totais (somaItens só itera itens).
function abrirGerenciarSubstituiveis(item, onChange) {
  const state = { step: 'lista', query: '', results: [], favoritos: [], recentes: [], loading: false, warning: null, selected: null, qtd: null, unidade: 'g', erro: '' };
  if (!item.substituiveis) item.substituiveis = [];

  const overlay = el('<div class="fp-overlay"></div>');
  const modal = el('<div class="fp-modal"></div>');
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });
  document.body.appendChild(overlay);

  let bodyEl = null;

  function fechar() { overlay.remove(); onChange(); }

  function buscar(q) {
    state.query = q;
    clearTimeout(fpDebounceTimer);
    if (!q.trim()) { state.results = []; state.warning = null; renderResultsBody(); return; }
    state.loading = true; renderResultsBody();
    fpDebounceTimer = setTimeout(async () => {
      const r = await fpFetchSearch(q.trim());
      if (state.query !== q) return;
      state.results = r.results; state.warning = r.warning; state.loading = false; renderResultsBody();
    }, 400);
  }

  async function selecionar(food) {
    let full = food;
    if (food.source === 'FATSECRET' && (!food.measures || !food.measures.length)) {
      state.loading = true; renderModal();
      try {
        const { data, error } = await supabaseClient.functions.invoke('food-get', { body: { source: food.source, source_id: food.sourceId } });
        if (error || !data || !data.food) throw error || new Error('sem dados');
        full = data.food;
      } catch (err) {
        state.loading = false; state.erro = 'Não deu pra carregar os detalhes desse alimento agora.'; renderModal(); return;
      }
    }
    state.selected = full;
    state.unidade = full.isLiquid ? 'ml' : 'g';
    const sugestao = solveQuantityForKcal(full, item.kcal || 0, state.unidade);
    state.qtd = sugestao != null ? sugestao : (full.isLiquid ? 200 : 100);
    state.step = 'quantidade';
    state.loading = false;
    state.erro = '';
    renderModal();
  }

  function confirmarSubstituto() {
    const qtd = Number(state.qtd);
    if (!qtd || qtd <= 0) { state.erro = 'Informe uma quantidade válida.'; renderModal(); return; }
    const novoSub = buildItemFromFood(state.selected, qtd, state.unidade);
    if (!novoSub) { state.erro = 'Sem conversão disponível pra essa unidade.'; renderModal(); return; }
    item.substituiveis.push(novoSub);
    state.step = 'lista';
    state.selected = null;
    renderModal();
  }

  function renderResultRow(food) {
    const row = el('<div class="fp-result"></div>');
    const left = el('<div style="min-width:0;"></div>');
    left.appendChild(el('<div class="fp-result-nome">' + food.nome + (food.brandName ? ' — ' + food.brandName : '') + '</div>'));
    const subParts = [];
    if (food.kcal != null) subParts.push(round1(food.kcal) + ' kcal/100' + (food.isLiquid ? 'ml' : 'g'));
    subParts.push(food.source === 'APP' ? 'sua base' : (food.source === 'TBCA' ? 'TBCA' : 'FatSecret'));
    left.appendChild(el('<div class="fp-result-sub">' + subParts.join(' · ') + '</div>'));
    row.appendChild(left);
    row.addEventListener('click', () => selecionar(food));
    return row;
  }

  function renderResultsBody() {
    if (!bodyEl) return;
    bodyEl.innerHTML = '';
    if (state.warning === 'fatsecret_unavailable' || state.warning === 'fatsecret_unavailable_stale_cache' || state.warning === 'edge_function_unavailable') {
      bodyEl.appendChild(el('<div class="fp-warning">Não foi possível consultar produtos externos no momento. Mostrando só a sua base local.</div>'));
    }
    if (!state.query.trim()) {
      if (state.favoritos.length) {
        bodyEl.appendChild(el('<div class="fp-section-label">Favoritos</div>'));
        state.favoritos.forEach((f) => bodyEl.appendChild(renderResultRow(hydrate(f))));
      }
      if (state.recentes.length) {
        bodyEl.appendChild(el('<div class="fp-section-label">Recentes</div>'));
        state.recentes.forEach((r) => bodyEl.appendChild(renderResultRow(hydrate(r))));
      }
      if (!state.favoritos.length && !state.recentes.length) {
        bodyEl.appendChild(el('<div class="fp-empty">Digite pra buscar um alimento substituto.</div>'));
      }
    } else if (state.loading) {
      bodyEl.appendChild(el('<div class="fp-empty">Buscando…</div>'));
    } else if (!state.results.length) {
      bodyEl.appendChild(el('<div class="fp-empty">Nenhum alimento encontrado pra "' + state.query + '".</div>'));
    } else {
      state.results.forEach((f) => bodyEl.appendChild(renderResultRow(f)));
    }
  }

  function renderListaStep() {
    modal.appendChild(el('<div style="font-size:14.5px;font-weight:800;">' + item.nome + '</div>'));
    modal.appendChild(el('<div style="font-size:12px;color:#66707e;margin-top:2px;">' + item.kcal + ' kcal — os substitutos abaixo entregam a mesma kcal, o aluno escolhe um, nunca soma ao total.</div>'));

    if (item.substituiveis.length) {
      const list = el('<div style="margin-top:12px;"></div>');
      item.substituiveis.forEach((s, si) => {
        const row = el('<div class="tecnica-row"></div>');
        const info = el('<div></div>');
        const qtdLabel = (s.quantidade != null && s.unidade) ? s.quantidade + ' ' + foodMeasureLabel(s.unidade) : s.quantidade_g + 'g';
        info.appendChild(el('<div class="tecnica-row-nome"></div>')).textContent = s.nome;
        info.appendChild(el('<div class="tecnica-row-obs"></div>')).textContent = qtdLabel + ' · ' + s.kcal + ' kcal';
        row.appendChild(info);
        const rmBtn = el('<button type="button" class="btn-icon">×</button>');
        rmBtn.addEventListener('click', () => { item.substituiveis.splice(si, 1); renderModal(); });
        row.appendChild(rmBtn);
        list.appendChild(row);
      });
      modal.appendChild(list);
    }

    const addBtn = el('<button type="button" class="btn btn-secondary" style="width:100%;margin-top:12px;">+ Adicionar substituível</button>');
    addBtn.addEventListener('click', () => { state.step = 'busca'; renderModal(); });
    modal.appendChild(addBtn);

    const doneBtn = el('<button type="button" class="btn btn-primary" style="width:100%;margin-top:8px;">Concluir</button>');
    doneBtn.addEventListener('click', fechar);
    modal.appendChild(doneBtn);
  }

  function renderBuscaStep() {
    const backBtn = el('<button type="button" class="fp-link-btn" style="margin-bottom:8px;">← Voltar</button>');
    backBtn.addEventListener('click', () => { state.step = 'lista'; renderModal(); });
    modal.appendChild(backBtn);

    const searchInput = el('<input class="fp-search" placeholder="Buscar alimento substituto… (ex: tapioca, batata-doce)" autocomplete="off">');
    searchInput.value = state.query;
    searchInput.addEventListener('input', () => buscar(searchInput.value));
    modal.appendChild(searchInput);
    setTimeout(() => searchInput.focus(), 0);

    bodyEl = el('<div class="fp-body"></div>');
    modal.appendChild(bodyEl);
    renderResultsBody();
  }

  function renderQuantidadeStep() {
    const food = state.selected;
    const backBtn = el('<button type="button" class="fp-link-btn" style="margin-bottom:8px;">← Voltar</button>');
    backBtn.addEventListener('click', () => { state.step = 'busca'; renderModal(); });
    modal.appendChild(backBtn);

    modal.appendChild(el('<div style="font-size:14.5px;font-weight:800;">' + food.nome + (food.brandName ? ' — ' + food.brandName : '') + '</div>'));
    modal.appendChild(el('<div style="font-size:11.5px;color:#66707e;margin-top:2px;">Quantidade sugerida pra equivaler a ' + (item.kcal || 0) + ' kcal — ajuste se quiser.</div>'));

    const measures = availableMeasures(food);
    const row = el('<div class="fp-qty-row"></div>');
    const qtdInput = el('<input type="number" min="0" step="any">');
    qtdInput.value = state.qtd;
    qtdInput.addEventListener('input', () => { state.qtd = qtdInput.value; renderPreview(); });
    const unidadeSelect = el('<select></select>');
    measures.forEach((m) => {
      const opt = el('<option value="' + m.unidade + '">' + foodMeasureLabel(m.unidade, m.label) + '</option>');
      if (m.unidade === state.unidade) opt.selected = true;
      unidadeSelect.appendChild(opt);
    });
    unidadeSelect.addEventListener('change', () => {
      state.unidade = unidadeSelect.value;
      const sugestao = solveQuantityForKcal(food, item.kcal || 0, state.unidade);
      if (sugestao != null) { state.qtd = sugestao; qtdInput.value = sugestao; }
      renderPreview();
    });
    row.appendChild(qtdInput); row.appendChild(unidadeSelect);
    modal.appendChild(row);

    const previewBox = el('<div></div>');
    modal.appendChild(previewBox);
    function renderPreview() {
      const n = computeNutrients(food, Number(state.qtd) || 0, state.unidade);
      previewBox.innerHTML = '';
      if (!n) { previewBox.appendChild(el('<div class="erro" style="margin-top:10px;">Sem conversão pra essa unidade.</div>')); return; }
      const box = el('<div class="fp-macros-preview"></div>');
      [['Kcal', n.kcal, ''], ['Proteínas', n.proteinaG, 'g'], ['Carboidratos', n.carboidratoG, 'g'], ['Gorduras', n.gorduraG, 'g'], ['Fibras', n.fibraG, 'g']]
        .forEach(([label, val, suf]) => box.appendChild(el('<div class="t">' + label + ': <b>' + val + suf + '</b></div>')));
      previewBox.appendChild(box);
    }
    renderPreview();

    if (state.erro) modal.appendChild(el('<div class="erro">' + state.erro + '</div>'));

    const confirmBtn = el('<button type="button" class="btn btn-primary" style="width:100%;margin-top:16px;">Salvar substituível</button>');
    confirmBtn.addEventListener('click', confirmarSubstituto);
    modal.appendChild(confirmBtn);
  }

  function renderModal() {
    modal.innerHTML = '';
    const head = el('<div class="fp-head"></div>');
    head.appendChild(el('<div class="fp-title">Substituíveis</div>'));
    const closeBtn = el('<button type="button" class="fp-close">×</button>');
    closeBtn.addEventListener('click', fechar);
    head.appendChild(closeBtn);
    modal.appendChild(head);

    if (state.loading && state.step === 'busca' && !state.selected) { modal.appendChild(el('<div class="fp-empty">Carregando…</div>')); return; }
    if (state.step === 'lista') renderListaStep();
    else if (state.step === 'busca') renderBuscaStep();
    else if (state.step === 'quantidade') renderQuantidadeStep();
  }

  fpCarregarFavoritosRecentes().then((r) => { state.favoritos = r.favoritos; state.recentes = r.recentes; if (bodyEl) renderResultsBody(); });
  renderModal();
}
```

- [ ] **Step 6: Manual verification**

Open `montar-dieta.html` for an existing diet, add "Pão francês — 1 unidade" to the café da manhã, click "Substituíveis", search "tapioca", select it — confirm the quantity field auto-fills to roughly the gram amount that matches the pão's kcal (verify against `solveQuantityForKcal` from Task 5's Node check), adjust if desired, save, confirm it lists under the item with a "×" to remove, and confirm `salvarDieta()` persists it (reload the page and see it's still there — check via `select refeicoes from dietas where id = '<id>'` that `substituiveis` appears inside the item's JSON).

- [ ] **Step 7: Commit**

```bash
git add montar-dieta.html
git commit -m "feat: let trainer attach calorie-equivalent substitute foods to a diet item"
```

---

## Task 7 — Student UI: show substituíveis under each diet item

**Files:**
- Modify: `app-aluno.html` — `refeicoesData` mapping (line ~1017), template (lines ~527-532)

- [ ] **Step 1: Include substituíveis in the mapped item data**

At `app-aluno.html:1017`, change:

```javascript
            itens: (op.itens || []).map(it => ({ nome: it.nome, qtdLabel: itemQtdLabel(it), kcal: Math.round(it.kcal || 0) + ' kcal' })),
```

to:

```javascript
            itens: (op.itens || []).map(it => ({
              nome: it.nome, qtdLabel: itemQtdLabel(it), kcal: Math.round(it.kcal || 0) + ' kcal',
              temSubstituiveis: !!(it.substituiveis && it.substituiveis.length),
              substituiveis: (it.substituiveis || []).map(s => ({ nome: s.nome, qtdLabel: itemQtdLabel(s) }))
            })),
```

(`itemQtdLabel` is already defined above at line 1000 and is generic — works on any object with `quantidade`/`quantidade_g`/`unidade`, no changes needed to it.)

- [ ] **Step 2: Render the substitutes list under each item**

At `app-aluno.html:527-532`, the item row is:

```html
                      <sc-for list="{{ op.itens }}" as="it" hint-placeholder-count="3">
                        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;">
                          <span style="font-size:12.5px;color:#e5e9f0;">{{ it.nome }} <span style="color:#66707e;">— {{ it.qtdLabel }}</span></span>
                          <span style="font-size:12.5px;font-weight:700;color:#c7ccd6;flex-shrink:0;">{{ it.kcal }}</span>
                        </div>
                      </sc-for>
```

Replace with:

```html
                      <sc-for list="{{ op.itens }}" as="it" hint-placeholder-count="3">
                        <div>
                          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;">
                            <span style="font-size:12.5px;color:#e5e9f0;">{{ it.nome }} <span style="color:#66707e;">— {{ it.qtdLabel }}</span></span>
                            <span style="font-size:12.5px;font-weight:700;color:#c7ccd6;flex-shrink:0;">{{ it.kcal }}</span>
                          </div>
                          <sc-if value="{{ it.temSubstituiveis }}" hint-placeholder-val="{{ false }}">
                            <div style="margin:3px 0 0 4px;padding-left:8px;border-left:2px solid #1e2633;">
                              <div style="font-size:10px;color:#66707e;margin-bottom:1px;">substituíveis (escolha um, não some ao pão)</div>
                              <sc-for list="{{ it.substituiveis }}" as="s" hint-placeholder-count="2">
                                <div style="font-size:11.5px;color:#9aa4b2;">• {{ s.nome }} — {{ s.qtdLabel }}</div>
                              </sc-for>
                            </div>
                          </sc-if>
                        </div>
                      </sc-for>
```

- [ ] **Step 3: Manual verification**

Reload `app-aluno.html` as the student used in Task 6's verification. Confirm: (a) "Pão francês — 1 unidade" shows the tapioca alternative underneath in a visually distinct, smaller/indented style; (b) "Total da refeição" and "Total diário" values are unchanged from before Task 6/7 (substitutes are not summed); (c) an item with no substitutes shows no extra block.

- [ ] **Step 4: Commit**

```bash
git add app-aluno.html
git commit -m "feat: show diet item substituíveis on student app without affecting totals"
```

---

## Self-review notes (already applied above, kept for traceability)

- **Spec coverage:** §1/1.1/1.2 → Task 4. §2/2.1/2.2/3/3.1 → Tasks 1-3 (existing `tecnicas_avancadas.observacao` already covered the "no fixed universal text, trainer writes it" requirement; Tasks 1-3 close the "specific to this prescription" gap additively). §4-14 → Tasks 5-7 (search→select→auto-calc→review→save flow = §10 exactly; not-summed-into-totals = §12, structurally guaranteed since `substituiveis` never enters `opcao.itens`; Opção 1/2 vs Substituíveis distinction = §14, untouched — `opcao.itens[].substituiveis` is per-item, orthogonal to the existing `refeicao.opcoes` array). §15/16 → satisfied by every task being additive-only against the exact tables/functions named in §16's "do not alter" list.
- **Type/name consistency:** `tecnica_instrucoes` (DB column, JS field) used identically in Tasks 1-3. `substituiveis` (item field), `buildItemFromFood`, `solveQuantityForKcal`, `abrirGerenciarSubstituiveis` used identically across Tasks 5-7. `treinoSelecionadoId`, `divisoesLista`, `mostrarListaTreinos`, `mostrarDetalheTreino`, `onVoltarListaTreinos` used identically within Task 4.
- **No placeholders:** every step above has complete, copy-pasteable code — none deferred to "later" or a TODO.
