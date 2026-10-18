// "Use a Elo como app": no celular, enquanto a Elo é aberta pelo navegador,
// mostra um aviso acima da barra inferior que abre o tutorial (vídeo do
// iPhone + passos do Android). Some quando a página já roda pelo ícone da
// tela de início (display-mode standalone) ou quando a pessoa dispensa.
// Classes com prefixo pf- de propósito: o CSS mobile das páginas força
// display:block em todo div filho do body que não comece com "pf-".
(function () {
  var CHAVE = 'elofitness_instalar_dispensado';
  var VIDEO = '/assets/tutorial/instalar-app-iphone.mp4';

  function ler() { try { return localStorage.getItem(CHAVE); } catch (e) { return null; } }
  function gravar() { try { localStorage.setItem(CHAVE, '1'); } catch (e) {} }

  var ua = navigator.userAgent || '';
  var ehIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var ehAndroid = /Android/.test(ua);
  var ehSafari = ehIOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|Instagram|FBAN|FBAV|WhatsApp/.test(ua);
  function instalado() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }

  var css =
    '.pf-inst-banner{position:fixed;left:12px;right:12px;bottom:calc(70px + env(safe-area-inset-bottom));z-index:100003;display:flex;align-items:center;gap:10px;background:#10151f;border:1px solid rgba(249,115,22,.45);border-radius:14px;padding:10px 12px;box-shadow:0 10px 30px rgba(0,0,0,.45);font-family:inherit;color:#e5e9f0;}' +
    '.pf-inst-banner img{width:34px;height:34px;border-radius:9px;flex-shrink:0;}' +
    '.pf-inst-txt{flex:1;min-width:0;font-size:12.5px;line-height:1.35;}' +
    '.pf-inst-txt b{display:block;font-size:13.5px;}' +
    '.pf-inst-ver{background:linear-gradient(135deg,#f97316,#ea580c);color:#fff;border:none;border-radius:9px;padding:8px 12px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap;}' +
    '.pf-inst-x{background:none;border:none;color:#66707e;font-size:20px;line-height:1;padding:2px 4px;cursor:pointer;}' +
    '.pf-inst-modal{position:fixed;inset:0;z-index:100010;background:rgba(0,0,0,.7);display:flex;align-items:flex-start;justify-content:center;padding:16px 12px;overflow-y:auto;}' +
    '.pf-inst-box{width:100%;max-width:420px;background:#10151f;border:1px solid #1a2130;border-radius:16px;padding:18px;color:#e5e9f0;font-family:inherit;}' +
    '.pf-inst-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;}' +
    '.pf-inst-head h2{margin:0;font-size:17px;font-weight:800;}' +
    '.pf-inst-box video{display:block;width:100%;max-height:62vh;object-fit:contain;background:#000;border-radius:12px;}' +
    '.pf-inst-box h3{font-size:13.5px;font-weight:800;margin:16px 0 6px;}' +
    '.pf-inst-box ol{margin:0;padding-left:20px;font-size:13px;line-height:1.55;color:#c4cad4;}' +
    '.pf-inst-nota{font-size:12px;color:#f59e0b;margin-top:8px;line-height:1.45;}' +
    '.pf-inst-ok{width:100%;margin-top:16px;background:#1e2633;color:#e5e9f0;border:none;border-radius:10px;padding:11px;font:inherit;font-size:13.5px;font-weight:700;cursor:pointer;}' +
    'html[data-tema="claro"] .pf-inst-banner,html[data-tema="claro"] .pf-inst-box{background:#ffffff;color:#0a0a0a;border-color:#e7e7ea;}' +
    'html[data-tema="claro"] .pf-inst-banner{border-color:rgba(249,115,22,.45);box-shadow:0 10px 30px rgba(0,0,0,.15);}' +
    'html[data-tema="claro"] .pf-inst-box ol{color:#3f3f46;}' +
    'html[data-tema="claro"] .pf-inst-ok{background:#e4e4e7;color:#0a0a0a;}' +
    '@media (min-width:861px){.pf-inst-banner{left:auto;right:20px;bottom:20px;max-width:380px;}}';

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
    '<li>Toque em <b>Adicionar à tela inicial</b> (ou <b>Instalar app</b>) e confirme.</li></ol>';

  function abrir() {
    injetarCss();
    var velho = document.querySelector('.pf-inst-modal');
    if (velho) velho.remove();
    var modal = document.createElement('div');
    modal.className = 'pf-inst-modal';
    var nota = ehIOS && !ehSafari
      ? '<div class="pf-inst-nota">Você está num navegador diferente do Safari (ou dentro de outro app, como o WhatsApp). Copie o link e abra no Safari para conseguir adicionar à tela de início.</div>'
      : '';
    modal.innerHTML =
      '<div class="pf-inst-box" role="dialog" aria-modal="true" aria-label="Usar a Elo como app">' +
        '<div class="pf-inst-head"><h2>Use a Elo como app</h2><button type="button" class="pf-inst-x" aria-label="Fechar">×</button></div>' +
        '<video src="' + VIDEO + '" autoplay muted loop playsinline controls preload="metadata"></video>' +
        nota + (ehAndroid ? passosAndroid + passosIPhone : passosIPhone + passosAndroid) +
        '<button type="button" class="pf-inst-ok">Entendi</button>' +
      '</div>';
    document.body.appendChild(modal);
    var fechar = function () { modal.remove(); };
    modal.addEventListener('click', function (e) { if (e.target === modal) fechar(); });
    modal.querySelector('.pf-inst-x').addEventListener('click', fechar);
    modal.querySelector('.pf-inst-ok').addEventListener('click', function () {
      gravar();
      var b = document.querySelector('.pf-inst-banner');
      if (b) b.remove();
      fechar();
    });
  }

  function mostrarBanner() {
    if (instalado() || ler() || document.querySelector('.pf-inst-banner')) return;
    if (!(ehIOS || ehAndroid)) return; // só no celular/tablet
    injetarCss();
    var b = document.createElement('div');
    b.className = 'pf-inst-banner';
    b.innerHTML =
      '<img src="/assets/brand/favicon-180.png" alt="">' +
      '<div class="pf-inst-txt"><b>Use a Elo como app</b>Coloque o ícone na tela do celular.</div>' +
      '<button type="button" class="pf-inst-ver">Ver como</button>' +
      '<button type="button" class="pf-inst-x" aria-label="Dispensar">×</button>';
    b.querySelector('.pf-inst-ver').addEventListener('click', abrir);
    b.querySelector('.pf-inst-x').addEventListener('click', function () { gravar(); b.remove(); });
    document.body.appendChild(b);
  }

  window.EloInstalarApp = { abrir: abrir };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(mostrarBanner, 1500); });
  else setTimeout(mostrarBanner, 1500);
})();
