# Tema claro (light mode)

## Problema

O app é 100% escuro hoje, cor por cor escrita direto no HTML de cada página
(sem CSS compartilhado, sem variáveis). Isso fica ruim de ler no celular sob
luz do sol — principalmente pro aluno, que confere treino/dieta na academia.

## Decisões já tomadas

- Alcance: app inteiro, incluindo o painel ADM.
- Alternância: botão sempre visível (sol/lua), não escondido em configurações.
- Persistência: vinculada à conta (banco), não só ao aparelho — troca de
  celular e o tema escolhido continua.
- Padrão pra quem nunca escolheu: continua escuro. Ninguém vê mudança até
  clicar no botão.

## Por que uma abordagem híbrida, não CSS-variables em tudo

O app tem duas "famílias" de página:

1. **Páginas x-dc** (dashboard, login, alunos, app-aluno, convite, e a
   maioria das outras) — cor é `style="color:#e5e9f0"` inline, repetida
   centenas de vezes, gerada por uma ferramenta de design. Reescrever cada
   ocorrência pra `var(--texto)` seria um refactor mecânico gigante nesses
   arquivos (alguns com 1000+ linhas), arriscado de revisar e de não quebrar
   nada visualmente.
2. **Páginas vanilla** (painel-adm, adm, montar-treino, acervo,
   aluno-detalhe) — já centralizam cor num bloco `<style>` com classes
   (`.sidebar`, `.badge` etc). Nessas, converter pra `var(--...)` é barato
   porque a cor já está num lugar só.

A paleta escura é extremamente consistente no app inteiro — um
levantamento real (`grep` em todos os `.html`) mostra que 11 tons de cor
respondem por mais de 2.700 das ocorrências totais. Isso torna viável uma
abordagem que a maioria dos apps não usaria: um script compartilhado
(`js/tema.js`) que percorre o DOM já renderizado e troca, atributo por
atributo de `style`, cada cor escura conhecida pela sua equivalente clara.
Como opera sobre o DOM final (não sobre o código-fonte), funciona até pra
cor calculada dinamicamente pelos componentes (ex: as cores de progresso
dos gráficos).

Para as páginas vanilla, em vez do DOM-walk, convertemos o bloco `<style>`
de cada uma pra usar variáveis CSS com um bloco de sobrescrita pra
`[data-theme="light"]` — mais simples e mais correto nesse caso específico,
já que lá a cor não está espalhada.

Alternativa descartada: reescrever toda cor inline pra `var()` em todo o
app. Tecnicamente "mais certo", mas um projeto de semanas com risco de
regressão visual alto pra um ganho que a abordagem híbrida já entrega.

## Arquitetura

### `js/tema.js` (novo, incluído em toda página)

Responsabilidades:
- **Aplicar o tema o mais cedo possível** pra evitar "flash" da cor errada:
  lê primeiro um cache em `localStorage` (síncrono, instantâneo) e aplica;
  depois busca a preferência real da conta (trainers/clientes/admins) e
  corrige se divergir (ex: usuário mudou de aparelho).
- **Mapa de cores fixo** dark → light (tabela completa abaixo). Ao aplicar
  o tema claro: percorre `document.querySelectorAll('[style]')`, e pra
  cada elemento substitui, dentro do valor do atributo `style`, qualquer
  hex conhecido do mapa pelo equivalente claro. Guarda o `style` original
  em `dataset.temaOriginal` no primeiro elemento tocado, pra poder voltar
  ao escuro sem re-renderizar a página (só restaura o original).
- **Seta `<html data-theme="claro|escuro">`** — usado pelas páginas
  vanilla, cujo `<style>` já sabe reagir a esse atributo via variáveis CSS.
- **Desenha o botão de alternância** (círculo fixo, canto superior direito,
  ícone sol/lua) — injetado por JS, então nenhuma página precisa de
  markup novo pra ter o botão.
- **Grava a mudança**: ao clicar, atualiza `localStorage` na hora (resposta
  instantânea) e dispara a escrita na tabela certa em background.

Cada página inclui o script assim, informando de qual tabela ler/gravar:
```html
<script>window.TEMA_CONTA = 'trainer';</script> <!-- ou 'cliente' / 'admin' -->
<script src="js/tema.js"></script>
```
Páginas sem sessão (login, convite, redefinir-senha) usam `'nenhuma'` —
tema só fica salvo em `localStorage` ali, já que ainda não há conta logada.

### Banco de dados

Nova coluna em três tabelas, todas com o mesmo formato:
```sql
alter table trainers add column tema text not null default 'escuro' check (tema in ('escuro', 'claro'));
alter table clientes add column tema text not null default 'escuro' check (tema in ('escuro', 'claro'));
alter table admins   add column tema text not null default 'escuro' check (tema in ('escuro', 'claro'));
```
RLS já cobre updates dessas tabelas pelo próprio dono da linha (padrão
existente — trainer edita a si mesmo, cliente edita a si mesmo via
`auth_user_id`), então não precisa de função nova, só a coluna.

### Mapa de cores (dark → light)

| Uso | Escuro (atual) | Claro (novo) |
|---|---|---|
| Fundo da página | `#0a0d13` | `#f4f5f7` |
| Fundo de input / área secundária | `#0d1119` | `#eef0f3` |
| Fundo de card/painel | `#10151f` | `#ffffff` |
| Fundo hover | `#131a26` / `#141a26` | `#e9ebef` |
| Borda sutil | `#171d29` | `#e4e7ec` |
| Borda padrão | `#1a2130` | `#dfe3e9` |
| Borda de input | `#1e2633` | `#d5dae2` |
| Borda forte (toast) | `#2a3444` | `#cbd2dc` |
| Texto principal | `#e5e9f0` | `#10151f` |
| Texto secundário | `#9aa4b2` | `#5b6472` |
| Texto terciário | `#66707e` | `#7c8593` |
| Texto bem apagado (rótulos de seção) | `#4a5364` | `#98a1ae` |
| Texto de nav (painel-adm) | `#c4cad4` | `#3a4452` |
| Laranja de marca | `#f97316` / `#ea580c` / `#fb923c` | *(sem mudança — funciona nos dois fundos)* |
| Verde de sucesso | `#4ade80` | `#16a34a` |
| Vermelho de erro | `#f87171` | `#dc2626` |
| Azul (badges, links) | `#60a5fa` / `#3b82f6` | `#2563eb` |
| Roxo | `#a855f7` | `#9333ea` |
| Amarelo/âmbar | `#facc15` / `#f59e0b` / `#f5b942` | `#b45309` |

Cores raras (poucas ocorrências cada, geral abaixo de 10 usos — fundos de
card de aviso específicos e variações de cinza):

| Escuro (atual) | Claro (novo) | Família |
|---|---|---|
| `#3a2418` | `#fdece3` | fundo de aviso laranja |
| `#1a1408` | `#fdf6e3` | fundo de aviso amarelo |
| `#0a1a10` | `#e9f9ee` | fundo de aviso verde |
| `#3a4352` | `#8b94a3` | texto/borda cinza-médio |
| `#141018` / `#151b28` | `#ffffff` | mesma família de `#10151f` (fundo de card) |
| `#c4cad4` / `#c7ccd6` / `#c3cad6` | `#3a4452` | mesma família de texto de nav |

### Botão de alternância

Círculo fixo, canto superior direito, com ícone de sol (mostrado quando o
tema atual é escuro — clicar vai pro claro) ou lua (mostrado quando o tema
atual é claro — clicar volta pro escuro). Fundo e borda do próprio botão
também trocam com o tema, pra ficar legível nos dois. z-index alto o
bastante pra ficar acima do conteúdo, mas testado contra os elementos fixos
que já existem (nav inferior do app-aluno, toast de desfazer do
montar-treino) pra não sobrepor nada.

### Ordem de implementação

O desenho cobre o app inteiro, mas a implementação é faseada — cada onda é
testável e revisável sozinha:

1. **Infra**: migration das 3 colunas, `js/tema.js` completo com o mapa de
   cores, botão funcionando de ponta a ponta em `login.html` (representando
   uma página x-dc) e `painel-adm.html` (representando uma página vanilla).
2. **Aluno**: `app-aluno.html`, `anamnese.html`, `convite.html`.
3. **Personal**: `dashboard.html`, `alunos.html`, `aluno-detalhe.html`,
   `montar-treino.html`, `montar-dieta.html`, `acervo.html`,
   `adicionar-aluno.html`, `produtos.html`, `financeiro.html`,
   `relatorios.html`, `agenda.html`, `perfil.html`, `configuracoes.html`,
   `assinatura.html`, `anamnese-editor.html`, `importar-ia.html`.
4. **Admin**: `painel-adm.html` (resto das telas), `adm.html`.

`redefinir-senha.html` e `index.html` entram na onda 1 (são simples, sem
sessão).

## Testes

- Alternar o tema numa página e confirmar que todo texto continua legível
  (contraste) nos dois modos.
- Trocar de tema, dar F5: tema se mantém (veio do banco, não só do cache).
- Logar em outro navegador com a mesma conta: tema salvo aparece lá
  também.
- Conferir que o botão de alternância não cobre o menu inferior do
  app-aluno nem o toast de desfazer do montar-treino.
- Conferir que gráficos (SVG) e badges de status continuam legíveis no
  tema claro.
