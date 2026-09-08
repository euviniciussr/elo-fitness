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

const TEMA_MAPA_HEX = {
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

// O runtime x-dc renderiza cor via propriedade JS do CSSOM (não como texto
// cru no atributo), então o navegador devolve `style` já normalizado pra
// `rgb(r, g, b)` — o hex original do template não sobrevive no DOM final.
// Por isso o mapa de troca precisa reconhecer as duas formas: cada entrada
// hex abaixo gera automaticamente sua equivalente `rgb(...)`.
function temaHexParaRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 'rgb(' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(', ') + ')';
}
const TEMA_MAPA_CLARO = {};
Object.keys(TEMA_MAPA_HEX).forEach(function (hex) {
  TEMA_MAPA_CLARO[hex] = TEMA_MAPA_HEX[hex];
  TEMA_MAPA_CLARO[temaHexParaRgb(hex)] = TEMA_MAPA_HEX[hex];
});

const TEMA_CHAVE_LOCAL = 'elofitness_tema';

function temaAtual() {
  return localStorage.getItem(TEMA_CHAVE_LOCAL) || 'escuro';
}

// Uma regex só, combinando todas as cores escuras, aplicada numa passada
// única sobre o style ORIGINAL. Substituir cor por cor em passadas
// separadas (.split(a).join(b) repetido) tem um bug real aqui: `#10151f`
// é ao mesmo tempo destino da troca do texto (`#e5e9f0` → `#10151f`) e
// origem da troca do fundo de card (`#10151f` → `#ffffff`) — numa segunda
// passada, o texto que acabou de virar `#10151f` seria trocado de novo por
// engano. Uma regex com callback de lookup evita isso: cada match no
// string original vira o destino certo de uma vez, sem reprocessar saída.
function temaEscaparRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const TEMA_REGEX_CLARO = new RegExp(Object.keys(TEMA_MAPA_CLARO).map(temaEscaparRegex).join('|'), 'gi');

// Toda página tem uma regra base `html,body{background:#0a0d13;color:#e5e9f0}`
// no <style> do <head> — texto que não define a própria cor herda dali. Isso
// é uma regra de CSS, não um atributo style="" em elemento, então o
// DOM-walk abaixo nunca alcança. Sobrescrever direto via .style vence a
// regra (inline sempre tem mais especificidade que seletor de tag).
function temaAplicarBase(tema) {
  const claro = tema === 'claro';
  document.documentElement.style.background = claro ? '#f4f5f7' : '';
  document.documentElement.style.color = claro ? '#10151f' : '';
  document.body.style.background = claro ? '#f4f5f7' : '';
  document.body.style.color = claro ? '#10151f' : '';
}

function temaConverterElemento(el) {
  // html/body têm a cor controlada direto por temaAplicarBase — nunca
  // reprocessar aqui. `#10151f` é ao mesmo tempo o texto final do tema
  // claro E uma cor de fundo escura reconhecida pelo mapa; se a varredura
  // genérica tocasse o body de novo, veria o `#10151f` que acabou de
  // virar cor de texto e trocaria de novo pra `#ffffff`, quebrando tudo.
  if (el === document.body || el === document.documentElement || el.id === 'tema-toggle-btn') return;
  const style = el.getAttribute('style');
  if (!style) return;
  // Cacheia o original (pra restaurar se voltar pro escuro) na primeira vez
  // que este elemento é visto — inclusive quando ele só apareceu depois,
  // via o MutationObserver, não só na varredura inicial da página.
  if (el.dataset.temaOriginal === undefined) el.dataset.temaOriginal = style;
  const convertido = style.replace(TEMA_REGEX_CLARO, function (match) {
    return TEMA_MAPA_CLARO[match.toLowerCase()] || match;
  });
  if (convertido !== style) el.setAttribute('style', convertido);
}

function temaConverterArvore(raiz) {
  if (raiz.nodeType !== 1) return;
  if (raiz.hasAttribute && raiz.hasAttribute('style')) temaConverterElemento(raiz);
  if (raiz.querySelectorAll) raiz.querySelectorAll('[style]').forEach(temaConverterElemento);
}

// O atributo `style-hover="..."` usado nas páginas x-dc não vira um
// style="" inline — o runtime compila ele numa regra `:hover { ... }`
// de verdade numa <style> própria, com !important, e gera uma classe
// nova (ex: .scp0) por elemento renderizado. Isso fica fora do alcance
// do DOM-walk acima, que só olha atributo style="" — sem essa função,
// qualquer elemento com hover configurado volta pra cor escura assim
// que o mouse passa por cima (ou, em touch, ao tocar), mesmo com o
// tema claro ativo. Cacheia o texto original da regra (igual ao
// dataset.temaOriginal dos elementos) pra poder restaurar no escuro.
const temaHoverCache = new Map();
function temaConverterHoverRules() {
  const claro = temaAtual() === 'claro';
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch (e) { continue; }
    for (const rule of rules) {
      if (!rule.selectorText || rule.selectorText.indexOf(':hover') === -1) continue;
      if (!rule.style || !rule.style.cssText) continue;
      if (!temaHoverCache.has(rule)) temaHoverCache.set(rule, rule.style.cssText);
      const original = temaHoverCache.get(rule);
      const alvo = claro
        ? original.replace(TEMA_REGEX_CLARO, function (m) { return TEMA_MAPA_CLARO[m.toLowerCase()] || m; })
        : original;
      if (rule.style.cssText !== alvo) rule.style.cssText = alvo;
    }
  }
}

// O runtime x-dc re-renderiza a página inteira a cada mudança de estado
// (troca de aba, erro de validação, o "chooser" de tipo de conta etc.),
// criando ou substituindo elementos com a cor escura original de novo —
// uma conversão única no carregamento não é suficiente. Um
// MutationObserver reconverte qualquer coisa nova ou alterada enquanto o
// tema claro estiver ativo. Desconecta durante a própria escrita pra não
// entrar num loop reagindo à própria mudança.
let temaObserver = null;
let temaHoverInterval = null;

function temaObservar() {
  // NÃO retorna cedo só porque temaObserver já existe — depois de um
  // temaObserver.disconnect() (ao trocar pra escuro) a variável continua
  // apontando pro mesmo objeto, só que desconectado. Sem reconectar aqui,
  // a partir do segundo ciclo escuro→claro o observer fica "morto": para
  // de reagir a elementos novos (troca de aba, modais etc.), que ficam
  // presos na cor escura mesmo com o tema claro ativo.
  if (!temaObserver) temaObserver = new MutationObserver(function (mutacoes) {
    if (temaAtual() !== 'claro') return;
    temaObserver.disconnect();
    mutacoes.forEach(function (m) {
      if (m.type === 'attributes' && m.target) temaConverterElemento(m.target);
      if (m.type === 'childList') m.addedNodes.forEach(temaConverterArvore);
    });
    temaConverterHoverRules();
    temaObserver.observe(document.body, { attributes: true, attributeFilter: ['style'], subtree: true, childList: true });
  });
  temaObserver.observe(document.body, { attributes: true, attributeFilter: ['style'], subtree: true, childList: true });
}

function temaAplicarNoDom(tema) {
  document.documentElement.setAttribute('data-tema', tema);
  temaAplicarBase(tema);
  temaConverterHoverRules();
  if (tema === 'claro') {
    if (temaObserver) temaObserver.disconnect();
    temaConverterArvore(document.body);
    temaObservar();
    // Rede de segurança pras regras :hover: o x-dc injeta a regra CSS de
    // um style-hover num momento que não bate exatamente com a mutação
    // de DOM que insere o elemento (às vezes a regra chega um instante
    // depois) — o MutationObserver, que só enxerga DOM, pode processar
    // a varredura antes da regra existir. Uma varredura leve a cada
    // poucos segundos garante que ela seja pega logo em seguida.
    if (temaHoverInterval) clearInterval(temaHoverInterval);
    temaHoverInterval = setInterval(temaConverterHoverRules, 1500);
  } else {
    if (temaObserver) temaObserver.disconnect();
    if (temaHoverInterval) { clearInterval(temaHoverInterval); temaHoverInterval = null; }
    document.querySelectorAll('[data-tema-original]').forEach(function (el) {
      el.setAttribute('style', el.dataset.temaOriginal);
      delete el.dataset.temaOriginal;
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

function temaCriarBotao() {
  const btn = document.createElement('button');
  btn.id = 'tema-toggle-btn';
  btn.type = 'button';
  btn.title = 'Alternar tema claro/escuro';
  btn.addEventListener('click', function () {
    temaSalvar(temaAtual() === 'claro' ? 'escuro' : 'claro');
  });
  return btn;
}

// Páginas que têm um sino de notificação marcam onde o botão deve
// entrar (id="tema-toggle-anchor"), logo ao lado do sino, no mesmo
// fluxo do documento — assim ele rola junto com o resto do cabeçalho
// e nunca "flutua" separado do sino ao dar scroll. Páginas sem esse
// marcador (sem sino) usam um botão fixo no canto.
//
// O x-dc re-renderiza (recria) esses nós estáticos quando o estado da
// página muda (abrir notificações, trocar de aba, digitar numa busca
// etc.), o que apaga qualquer coisa inserida manualmente ali dentro —
// inclusive na primeira renderização, que acontece um instante DEPOIS
// do DOMContentLoaded. Por isso o botão precisa ser reinserido sempre
// que sumir, e não só uma vez no carregamento.
var TEMA_CSS_ANCORADO = 'position:relative;width:38px;height:38px;border-radius:10px;border:1px solid;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;';
// top:64px (não 16px) de propósito — páginas sem sino de notificação
// ainda podem ter outros links/botões no canto superior direito (ex:
// "Voltar" em montar-treino.html), e 16px ficava em cima deles.
// Descer alguns pixels funciona em qualquer página sem precisar saber
// a posição exata de cada uma.
var TEMA_CSS_FIXO = 'position:fixed;top:64px;right:16px;z-index:99998;width:38px;height:38px;border-radius:50%;border:1px solid;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.15);';

function temaGarantirBotaoNoLugar() {
  let btn = document.getElementById('tema-toggle-btn');
  const anchor = document.getElementById('tema-toggle-anchor');
  let mudou = false;
  if (anchor) {
    if (!btn) { btn = temaCriarBotao(); mudou = true; }
    // Reaplica o CSS "ancorado" sempre que o botão é movido pra
    // dentro do marcador — se ele tinha sido criado antes como
    // fallback fixo (marcador ainda não existia nesse instante), o
    // style.cssText antigo (position:fixed) precisa ser substituído,
    // senão ele continua "flutuando" por cima da página mesmo já
    // estando no lugar certo do DOM.
    if (btn.parentElement !== anchor) {
      anchor.appendChild(btn);
      btn.style.cssText = TEMA_CSS_ANCORADO;
      mudou = true;
    }
  } else if (!btn) {
    btn = temaCriarBotao();
    btn.style.cssText = TEMA_CSS_FIXO;
    document.body.appendChild(btn);
    mudou = true;
  }
  // Só mexe no botão (innerHTML/estilo) quando ele acabou de ser
  // criado ou reencaixado — chamar temaAtualizarBotao em toda
  // invocação reescreveria o innerHTML a cada tick do
  // MutationObserver, o que por sua vez dispara uma nova mutação e
  // gera um loop infinito.
  if (mudou) temaAtualizarBotao(temaAtual());
}

function temaInserirBotao() {
  temaGarantirBotaoNoLugar();
  const obs = new MutationObserver(function () { temaGarantirBotaoNoLugar(); });
  obs.observe(document.body, { childList: true, subtree: true });
}

(function temaInit() {
  temaAplicarNoDom(temaAtual());
  document.addEventListener('DOMContentLoaded', function () {
    temaInserirBotao();
    temaCarregarDaConta();
  });
})();
