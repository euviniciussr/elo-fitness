// "Use a Elo como app" — convite para instalar, mostrado na hora certa:
//
// - Nunca aparece no computador, nem para quem já usa pelo ícone (display-mode
//   standalone) ou já instalou neste aparelho (evento appinstalled).
// - Não interrompe a primeira olhada: aparece a partir da 2ª visita (em dias
//   diferentes) ou depois de ~25 s de uso na primeira.
// - Android/Chrome: o botão chama o instalador nativo (beforeinstallprompt),
//   um toque e pronto. Sem ele (outros navegadores), abre o tutorial.
// - iPhone/Safari: a Apple não deixa instalar por código, então o botão abre
//   o vídeo com o passo a passo. Dentro do WhatsApp/Instagram explica que
//   precisa abrir no Safari e oferece copiar o link.
// - Dispensou: volta só depois de 7 dias; depois de 3 dispensas, não volta.
// - Telas de entrada (convite e login): é o primeiro contato do aluno, então
//   o convite aparece já na 1ª visita — e também no computador, explicando
//   que é para abrir no celular (com o vídeo).
// - Link direto pro tutorial: qualquer página com #instalar no fim da URL.
//
// Classes com prefixo pf- de propósito: o CSS mobile das páginas força
// display:block em todo div filho do body que não comece com "pf-".
(function () {
  var CHAVE = 'elofitness_instalar';
  var VIDEO = '/assets/tutorial/instalar-app-iphone.mp4?v=3';
  var ADIAR_DIAS = 7, MAX_DISPENSAS = 3, ESPERA_PRIMEIRA_MS = 25000, ESPERA_MS = 2500;

  function hojeStr() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function ler() {
    try { return JSON.parse(localStorage.getItem(CHAVE) || '{}') || {}; } catch (e) { return {}; }
  }
  function gravar(dados) { try { localStorage.setItem(CHAVE, JSON.stringify(dados)); } catch (e) {} }
  function atualizar(fn) { var d = ler(); fn(d); gravar(d); return d; }

  var ua = navigator.userAgent || '';
  var ehIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var ehAndroid = /Android/.test(ua);
  var appInterno = /FBAN|FBAV|Instagram|WhatsApp|Line\/|Twitter|TikTok/i.test(ua);
  var ehSafari = ehIOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) && !appInterno;
  function rodandoComoApp() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }

  var paginaAtual = location.pathname.split('/').pop().replace(/\.html$/, '');
  var telaDeEntrada = paginaAtual === 'convite' || paginaAtual === 'login' || location.pathname.indexOf('/c/') === 0;

  // Área usada por último (para o /app abrir no lugar certo quem tem os dois cadastros).
  try {
    var pagina = location.pathname.split('/').pop().replace(/\.html$/, '');
    if (pagina === 'app-aluno') localStorage.setItem('elofitness_area', 'aluno');
    else if (pagina === 'dashboard') localStorage.setItem('elofitness_area', 'personal');
  } catch (e) {}

  var promptNativo = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); // a gente mostra o convite no nosso tempo
    promptNativo = e;
    var b = document.querySelector('.pf-inst-banner .pf-inst-ver');
    if (b && (ehIOS || ehAndroid)) b.textContent = 'Instalar';
  });
  window.addEventListener('appinstalled', function () {
    atualizar(function (d) { d.instalado = true; });
    removerBanner();
  });

  var css =
    '.pf-inst-banner{position:fixed;left:12px;right:12px;bottom:calc(70px + env(safe-area-inset-bottom));z-index:100003;display:flex;align-items:center;gap:10px;background:#10151f;border:1px solid rgba(249,115,22,.45);border-radius:14px;padding:10px 12px;box-shadow:0 10px 30px rgba(0,0,0,.45);font-family:inherit;color:#e5e9f0;animation:pfInstSobe .35s ease-out;}' +
    '@keyframes pfInstSobe{from{transform:translateY(20px);opacity:0;}to{transform:none;opacity:1;}}' +
    '.pf-inst-banner img{width:34px;height:34px;border-radius:9px;flex-shrink:0;}' +
    '.pf-inst-txt{flex:1;min-width:0;font-size:12.5px;line-height:1.35;color:#9aa4b2;}' +
    '.pf-inst-txt b{display:block;font-size:13.5px;color:#e5e9f0;}' +
    '.pf-inst-ver{width:auto;flex-shrink:0;margin:0;background:linear-gradient(135deg,#f97316,#ea580c);color:#fff;border:none;border-radius:9px;padding:8px 12px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap;}' +
    '.pf-inst-x{width:auto;flex-shrink:0;margin:0;background:none;border:none;color:#66707e;font-size:20px;line-height:1;padding:2px 4px;cursor:pointer;}' +
    '.pf-inst-modal{position:fixed;inset:0;z-index:100010;background:rgba(0,0,0,.7);display:flex;align-items:flex-start;justify-content:center;padding:16px 12px;overflow-y:auto;}' +
    '.pf-inst-box{width:100%;max-width:420px;background:#10151f;border:1px solid #1a2130;border-radius:16px;padding:18px;color:#e5e9f0;font-family:inherit;}' +
    '.pf-inst-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;}' +
    '.pf-inst-head h2{margin:0;font-size:17px;font-weight:800;}' +
    '.pf-inst-box video{display:block;width:100%;max-height:62vh;object-fit:contain;background:#000;border-radius:12px;}' +
    '.pf-inst-box h3{font-size:13.5px;font-weight:800;margin:16px 0 6px;}' +
    '.pf-inst-box ol{margin:0;padding-left:20px;font-size:13px;line-height:1.55;color:#c4cad4;}' +
    '.pf-inst-nota{font-size:12.5px;color:#f59e0b;background:rgba(245,158,11,.08);border-radius:10px;padding:10px 12px;margin:0 0 12px;line-height:1.45;}' +
    '.pf-inst-copiar{display:block;margin-top:8px;background:#f97316;color:#fff;border:none;border-radius:8px;padding:8px 12px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;}' +
    '.pf-inst-ok{width:100%;margin-top:16px;background:#1e2633;color:#e5e9f0;border:none;border-radius:10px;padding:11px;font:inherit;font-size:13.5px;font-weight:700;cursor:pointer;}' +
    'html[data-tema="claro"] .pf-inst-banner,html[data-tema="claro"] .pf-inst-box{background:#ffffff;color:#0a0a0a;border-color:#e7e7ea;}' +
    'html[data-tema="claro"] .pf-inst-banner{border-color:rgba(249,115,22,.45);box-shadow:0 10px 30px rgba(0,0,0,.15);}' +
    'html[data-tema="claro"] .pf-inst-txt{color:#71717a;}html[data-tema="claro"] .pf-inst-txt b{color:#0a0a0a;}' +
    'html[data-tema="claro"] .pf-inst-box ol{color:#3f3f46;}' +
    'html[data-tema="claro"] .pf-inst-ok{background:#e4e4e7;color:#0a0a0a;}' +
    '.pf-inst-banner.pf-inst-entrada{bottom:calc(12px + env(safe-area-inset-bottom));}' +
    '@media (min-width:861px){.pf-inst-banner,.pf-inst-banner.pf-inst-entrada{left:auto;right:20px;bottom:20px;max-width:400px;}}' +
    // Enquanto o aviso está na tela, reserva o espaço dele no fim da página:
    // nas telas de entrada (conteúdo centralizado) o selo da Glaz sobe acima
    // dele; nas demais, o fim da página rola até ficar acima do aviso.
    'html.pf-inst-ativo .glaz-credit{margin-bottom:calc(var(--pf-inst-h,0px) + 24px) !important;}' +
    'html.pf-inst-ativo body{padding-bottom:var(--pf-inst-h,0px);}';

  function injetarCss() {
    if (document.getElementById('pf-inst-css')) return;
    var s = document.createElement('style');
    s.id = 'pf-inst-css';
    s.textContent = css;
    document.head.appendChild(s);
  }

  var passosIPhone =
    '<h3>No iPhone (Safari)</h3><ol>' +
    '<li>Abra a Elo no <b>Safari</b>.</li>' +
    '<li>Toque em <b>Compartilhar</b> (o quadrado com a seta para cima). Se não aparecer, toque nos <b>···</b> da barra de endereço.</li>' +
    '<li>Role a lista e toque em <b>Adicionar à Tela de Início</b>.</li>' +
    '<li>Deixe <b>Abrir como app web</b> ligado e toque em <b>Adicionar</b>.</li></ol>';
  var passosAndroid =
    '<h3>No Android (Chrome)</h3><ol>' +
    '<li>Abra a Elo no <b>Chrome</b>.</li>' +
    '<li>Toque no menu <b>⋮</b> no canto de cima.</li>' +
    '<li>Toque em <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>) e confirme.</li></ol>';

  function linkDoApp() { return location.origin + '/app'; }

  function abrirTutorial() {
    injetarCss();
    var velho = document.querySelector('.pf-inst-modal');
    if (velho) velho.remove();
    var modal = document.createElement('div');
    modal.className = 'pf-inst-modal';
    var nota = '';
    if (!ehIOS && !ehAndroid) {
      nota = '<div class="pf-inst-nota">A Elo vira app no <b>celular</b>: abra <b>' + location.host + '</b> no navegador do celular, entre na sua conta e siga os passos abaixo.</div>';
    } else if (appInterno || (ehIOS && !ehSafari)) {
      nota = '<div class="pf-inst-nota">Você abriu a Elo ' + (appInterno ? 'dentro de outro app (WhatsApp, Instagram…)' : 'num navegador diferente do Safari') +
        '. Para instalar, abra o link no ' + (ehIOS ? '<b>Safari</b>' : '<b>Chrome</b>') + '.' +
        '<button type="button" class="pf-inst-copiar">Copiar link</button></div>';
    }
    modal.innerHTML =
      '<div class="pf-inst-box" role="dialog" aria-modal="true" aria-label="Usar a Elo como app">' +
        '<div class="pf-inst-head"><h2>Use a Elo como app</h2><button type="button" class="pf-inst-x" aria-label="Fechar">×</button></div>' +
        nota +
        (ehAndroid ? passosAndroid + '<video src="' + VIDEO + '" muted loop playsinline controls preload="none"></video>' + passosIPhone
                   : '<video src="' + VIDEO + '" autoplay muted loop playsinline controls preload="metadata"></video>' + passosIPhone + passosAndroid) +
        '<button type="button" class="pf-inst-ok">Entendi</button>' +
      '</div>';
    document.body.appendChild(modal);
    var fechar = function () { modal.remove(); };
    modal.addEventListener('click', function (e) { if (e.target === modal) fechar(); });
    modal.querySelector('.pf-inst-x').addEventListener('click', fechar);
    modal.querySelector('.pf-inst-ok').addEventListener('click', function () { dispensar(); fechar(); });
    var copiar = modal.querySelector('.pf-inst-copiar');
    if (copiar) copiar.addEventListener('click', function () {
      var ok = function () { copiar.textContent = 'Link copiado! Cole no ' + (ehIOS ? 'Safari' : 'Chrome'); };
      if (navigator.clipboard) navigator.clipboard.writeText(linkDoApp()).then(ok, function () { prompt('Copie o link:', linkDoApp()); });
      else prompt('Copie o link:', linkDoApp());
    });
  }

  // No computador o objetivo é o celular: o botão sempre abre o tutorial.
  async function instalar() {
    if (!promptNativo || !(ehIOS || ehAndroid)) { abrirTutorial(); return; }
    var p = promptNativo;
    promptNativo = null; // o navegador só deixa usar uma vez
    p.prompt();
    try {
      var escolha = await p.userChoice;
      if (escolha && escolha.outcome === 'accepted') { atualizar(function (d) { d.instalado = true; }); removerBanner(); }
      else dispensar();
    } catch (e) { abrirTutorial(); }
  }

  function removerBanner() {
    var b = document.querySelector('.pf-inst-banner');
    if (b) b.remove();
    document.documentElement.classList.remove('pf-inst-ativo');
  }

  // Espaço reservado = altura do aviso + distância dele até o rodapé.
  function reservarEspaco(b) {
    var medir = function () {
      if (!b.isConnected) return;
      var r = b.getBoundingClientRect();
      document.documentElement.style.setProperty('--pf-inst-h', Math.ceil(window.innerHeight - r.top) + 'px');
    };
    document.documentElement.classList.add('pf-inst-ativo');
    medir();
    window.addEventListener('resize', medir);
  }

  function dispensar() {
    atualizar(function (d) { d.dispensas = (d.dispensas || 0) + 1; d.ultimaDispensa = Date.now(); });
    removerBanner();
  }

  function deveMostrar() {
    if (!(ehIOS || ehAndroid) && !telaDeEntrada) return false;
    if (rodandoComoApp()) return false;
    var d = ler();
    if (d.instalado) return false;
    if ((d.dispensas || 0) >= MAX_DISPENSAS) return false;
    if (d.ultimaDispensa && Date.now() - d.ultimaDispensa < ADIAR_DIAS * 86400000) return false;
    return true;
  }

  function mostrarBanner() {
    if (!deveMostrar() || document.querySelector('.pf-inst-banner') || document.querySelector('.pf-inst-modal')) return;
    injetarCss();
    var b = document.createElement('div');
    b.className = 'pf-inst-banner';
    var celular = ehIOS || ehAndroid;
    var sub = !celular ? 'Depois de criar a conta, abra no celular e coloque o ícone na tela.'
      : (appInterno || (ehIOS && !ehSafari)) ? 'Abra no ' + (ehIOS ? 'Safari' : 'Chrome') + ' para instalar.'
      : ehAndroid ? 'Acesso direto pelo ícone, em tela cheia.' : 'Coloque o ícone na tela do celular.';
    b.innerHTML =
      '<img src="/assets/brand/favicon-180.png" alt="">' +
      '<div class="pf-inst-txt"><b>Use a Elo como app</b>' + sub + '</div>' +
      '<button type="button" class="pf-inst-ver">' + (!celular ? 'Ver vídeo' : promptNativo ? 'Instalar' : 'Ver como') + '</button>' +
      '<button type="button" class="pf-inst-x" aria-label="Agora não">×</button>';
    if (telaDeEntrada) b.className += ' pf-inst-entrada'; // sem barra inferior aqui
    b.querySelector('.pf-inst-ver').addEventListener('click', instalar);
    b.querySelector('.pf-inst-x').addEventListener('click', dispensar);
    document.body.appendChild(b);
    reservarEspaco(b);
  }

  function iniciar() {
    if (rodandoComoApp()) { atualizar(function (d) { d.instalado = true; }); return; }
    if (location.hash === '#instalar') { abrirTutorial(); return; }
    // Conta visitas em dias diferentes: na 1ª, espera a pessoa usar um pouco.
    var d = atualizar(function (x) {
      if (x.ultimoDia !== hojeStr()) { x.visitas = (x.visitas || 0) + 1; x.ultimoDia = hojeStr(); }
    });
    setTimeout(mostrarBanner, telaDeEntrada || (d.visitas || 1) >= 2 ? ESPERA_MS : ESPERA_PRIMEIRA_MS);
  }

  window.EloInstalarApp = { abrir: abrirTutorial, instalar: instalar };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
