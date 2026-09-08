# Gestão de treinos: excluir, copiar entre alunos, nomenclatura de repetições

## Contexto

Três ajustes na interface do Personal (`montar-treino.html`) e na do aluno
(`app-aluno.html`), sem alterar cálculo, execução ou carga.

## 1. Excluir treino

- Botão "🗑 Excluir treino" ao lado do já existente "⎘ Duplicar treino" em
  `renderTreinoBody` (`montar-treino.html`), estilo `btn-ghost` como usado em
  todo o resto do app (ex.: `aluno-detalhe.html`).
- Confirmação via `window.confirm('Excluir "' + treino.nome + '"? Essa ação
  não pode ser desfeita.')` — mesmo padrão de todas as exclusões existentes
  no app (nenhum modal customizado novo).
- `delete from treinos where id = treino.id` — o schema já cascade-deleta
  `treino_exercicios`, `serie_cargas`, `treino_exercicio_execucoes`,
  `treino_serie_execucoes`, `treino_execucoes` e `feedbacks_treino` (linhas
  com aquele `treino_id`) via FK `on delete cascade`. `exercicios` e
  `tecnicas_avancadas` são globais por trainer (não pertencem ao treino), e
  outros alunos/treinos não referenciam essa linha — nada mais é afetado.
- Após excluir: remove do array `treinos` em memória, reindexa `activeIndex`
  (`Math.min(i, treinos.length - 1)`); se a divisão ficar com 0 treinos,
  volta para `alunos.html` (não existe hoje uma tela de "divisão vazia").
- Bug lateral corrigido: `duplicarTreino` calcula `ordem: treinos.length`,
  que pode colidir com uma `ordem` já existente depois que uma exclusão criar
  buracos na sequência. Passa a usar `max(ordem existente) + 1`.

## 2. Copiar para outro aluno (nova função, separada de "Duplicar treino")

- Novo botão "↷ Copiar para outro aluno" ao lado dos outros dois.
- Abre um modal (reaproveitando o padrão `modal-overlay`/`modal-box` já
  usado no arquivo) com um `<select>` dos `clientes` do trainer (mesmo
  padrão simples já usado em "Enviar pro aluno" — sem os alunos já
  vinculados a esse split, incluindo o próprio aluno atual) e um botão
  "Copiar treino" desabilitado até escolher um aluno.
- Ao confirmar, mostra "Copiar este treino para {nome}?" com
  "Cancelar"/"Copiar treino" dentro do próprio modal (segunda etapa, mesmo
  modal) antes de gravar.
- Implementação: cria um `split_id` novo (o treino copiado vira uma divisão
  independente de 1 treino para o aluno destino, mesmo padrão de
  `usarTemplate`), insere a linha `treinos` (`cliente_id` do destino,
  mesmo `nome`, `dias_semana` copiado, `habilitado: false` — mesmo padrão
  já usado quando um template é aplicado a um aluno, fica oculto até o
  Personal revisar e habilitar), depois insere as linhas `treino_exercicios`
  copiando todos os campos de configuração (`exercicio_id`, `ordem`,
  `series`, `series_aquecimento`, `intervalo_descanso`, `descanso_segundos`,
  `tecnica_avancada`, `tecnica_instrucoes`, `observacoes`, `carga`,
  remapeando `grupo_id` pra um novo uuid por grupo — mesma técnica já usada
  em `usarTemplate`). Não copia `serie_cargas`, `treino_exercicio_execucoes`,
  `treino_serie_execucoes`, `treino_execucoes`, `feedbacks_treino` (histórico
  e dados específicos do aluno de origem).
- `exercicio_id` e `tecnica_avancada` continuam apontando pros registros já
  existentes na biblioteca do trainer (compartilhada entre todos os alunos
  dele) — como os dois alunos pertencem ao mesmo trainer, a cópia não
  precisa duplicar exercícios nem técnicas nem vídeos, e a RLS já impede
  copiar de/para aluno de outro trainer.
- Resultado 100% independente: como é um `treino_exercicios` novo (linhas
  novas, ids novos), editar o treino do aluno 2 depois não toca nenhuma
  linha do aluno 1.

## 3. Corrigir cópia incompleta do "Duplicar treino" existente

`duplicarTreino` hoje não copia `grupo_id` (perde agrupamento Super
Set/Bi-Set/Tri-Set), `observacoes`, `tecnica_instrucoes` nem `carga`. Extraio
a lógica de cópia de `treino_exercicios` (com remapeamento de `grupo_id`)
para uma função compartilhada `copiarExerciciosParaTreino(origemTreino,
destinoTreinoId)`, usada tanto por `duplicarTreino` quanto pela nova
"Copiar para outro aluno". Efeito: duplicar dentro do mesmo aluno passa a
preservar tudo que já devia preservar — sem mudar o comportamento visível
pro Personal (mesmos botões, mesmo fluxo), só corrige o que faltava.

## 4. Nomenclatura "Repetições" na interface do aluno

Em `app-aluno.html`, cada série válida hoje renderiza
`Série {{numero}} — {{texto}}` (ex.: "Série 1 — 8 a 10"), com um cabeçalho de
seção "Séries válidas" logo acima (visível só quando o exercício também tem
aquecimento) — a proximidade visual entre esse cabeçalho e o valor de
repetição é a origem da confusão relatada. Ajuste: passa a renderizar
`Série {{numero}} — Repetições: {{texto}}`, deixando explícito, em qualquer
formato (`8`, `8 a 10`, `10 a 12`, `15`, etc.) que aquele valor é a faixa de
repetição daquela série — sem tocar em `seriesLinhas`/`expandirSeriesLinhas`
(parsing), no check de série feita, nem no campo de carga. Puramente textual.

## Testes manuais (checklist do pedido original)

Fluxo treino: criar treino, duplicar, confirmar botão excluir existe,
excluir o duplicado, confirmar que só ele sumiu, exercícios continuam no
banco global, outro aluno não é afetado.

Fluxo copiar: aluno 1 → treino existente → copiar pra outro aluno → buscar
aluno 2 → confirmar → abrir aluno 2 → treino criado com exercícios/séries/
repetições/técnicas certos → editar treino do aluno 2 → treino do aluno 1
intacto → cargas/histórico/feedback do aluno 1 não vieram junto.

Fluxo interface do aluno: exercício com 2 séries válidas, 8 a 10 repetições
→ aparece "Repetições: 8 a 10" em vez de "Séries válidas: 8 a 10" → testar
com 1 série, com faixa, com número fixo.
