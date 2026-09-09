# Copiar treino = copiar a programação completa

**Bug reportado:** "Copiar para outro aluno" copiava só a divisão aberta (ex.: só o Treino A), em vez da programação inteira (A+B+C+D). Repetir a ação por divisão também criava splits separados no destino.

**Causa raiz:** `abrirModalCopiarParaAluno(treino)` operava sobre a aba ativa (`treinos[activeIndex]`), não sobre o array `treinos` (todas as divisões do split aberto).

**Correção** (`montar-treino.html`):
- `abrirModalCopiarParaAluno()` agora não recebe mais um `treino` — opera sobre o array global `treinos` inteiro.
- Um único `insert` em lote cria todas as divisões no destino sob **um único** `split_id` novo (mesmo padrão de `usarTemplate`), preservando `ordem`.
- Pra cada divisão, `copiarExerciciosParaTreino` (já existente, inalterado) copia a estrutura completa (séries, aquecimento, descanso, técnicas, observações, carga prescrita, grupos de Super/Bi/Tri-Set) sem tocar em histórico/carga registrada/feedback do aluno de origem.
- Se o aluno de destino já tiver alguma programação, o modal avisa explicitamente antes de confirmar ("já possui uma programação... deseja adicionar mesmo assim?") — nunca apaga a programação existente automaticamente.
- Botão renomeado pra "↷ Copiar programação para outro aluno", deixando claro que não é por divisão.

**Não alterado:** `duplicarTreino` (duplicar uma divisão dentro do mesmo aluno) e `excluirTreino` (excluir uma divisão específica, com confirmação, já implementado anteriormente) — ambos já corretos.

**Verificação:** revisão estática do diff + checagem de sintaxe (`node -e "new Function(...)"` no bloco `<script>`). Sem test runner automatizado no projeto; validação ao vivo no navegador (fluxo completo: copiar A+B+C+D pra outro aluno, editar/excluir uma divisão no destino, confirmar que o aluno de origem não é afetado) fica pendente de uma conta de teste isolada — não foi feita na sessão real do Chrome do usuário.
