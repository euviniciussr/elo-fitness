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

// Uma regex só, combinando todas as cores escuras, aplicada numa passada
// única sobre o style ORIGINAL. Substituir cor por cor em passadas
// separadas (.split(a).join(b) repetido) tem um bug real aqui: `#10151f`
// é ao mesmo tempo destino da troca do texto (`#e5e9f0` → `#10151f`) e
// origem da troca do fundo de card (`#10151f` → `#ffffff`) — numa segunda
// passada, o texto que acabou de virar `#10151f` seria trocado de novo por
// engano. Uma regex com callback de lookup evita isso: cada match no
// string original vira o destino certo de uma vez, sem reprocessar saída.
const TEMA_REGEX_CLARO = new RegExp(Object.keys(TEMA_MAPA_CLARO).join('|'), 'gi');

function temaAplicarNoDom(tema) {
  document.documentElement.setAttribute('data-tema', tema);
  if (tema === 'claro') {
    document.querySelectorAll('[style]').forEach(function (el) {
      if (el.dataset.temaOriginal === undefined) {
        el.dataset.temaOriginal = el.getAttribute('style');
      }
      const style = el.dataset.temaOriginal.replace(TEMA_REGEX_CLARO, function (match) {
        return TEMA_MAPA_CLARO[match.toLowerCase()] || match;
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
