// Selo "Feito por Glaz Technology" — mesmo visual do rodapé do site
// (elo-fitness-site/src/components/shared/glaz-credit.tsx). Incluído só nas
// telas públicas (login, convite, redefinir senha). Reage ao tema claro via
// <html data-tema="claro"> (js/tema.js).
(function () {
  const style = document.createElement('style');
  style.textContent =
    '.glaz-credit{display:flex;align-items:center;gap:8px;width:fit-content;margin:28px auto 20px;padding:6px 14px 6px 6px;' +
    'font-size:12px;font-weight:500;line-height:1;font-family:inherit;color:#8a8a8a;text-decoration:none;background:rgba(255,255,255,.03);' +
    'border:1px solid rgba(255,255,255,.08);border-radius:999px;transition:border-color .2s,color .2s;}' +
    '.glaz-credit img{width:18px;height:18px;border-radius:50%;box-shadow:0 0 0 1px rgba(255,255,255,.2);display:block;}' +
    '.glaz-credit strong{color:#e8e6e2;font-weight:700;transition:color .2s;}' +
    '.glaz-credit:hover{border-color:rgba(34,211,238,.45);color:#b9b6b1;}' +
    '.glaz-credit:hover strong{color:#22D3EE;}' +
    'html[data-tema="claro"] .glaz-credit{color:#6b6b6b;background:rgba(0,0,0,.03);border-color:rgba(0,0,0,.1);}' +
    'html[data-tema="claro"] .glaz-credit img{box-shadow:0 0 0 1px rgba(0,0,0,.1);}' +
    'html[data-tema="claro"] .glaz-credit strong{color:#101010;}';
  document.head.appendChild(style);

  // Página x-dc (login) já traz o <a class="glaz-credit"> no template — o
  // runtime re-renderiza e apagaria um nó inserido por fora. Nas demais o
  // selo é criado aqui: dentro do .wrap centralizado (convite, redefinir
  // senha — senão cai abaixo da dobra por causa do min-height:100vh) ou no
  // fim do <body>.
  if (document.querySelector('.glaz-credit')) return;
  const a = document.createElement('a');
  a.className = 'glaz-credit';
  a.href = 'https://www.glaztechnology.com/';
  a.target = '_blank';
  a.rel = 'noopener';
  a.innerHTML = '<img src="/assets/glaz-logo.png" alt=""><span>Feito por <strong>Glaz Technology</strong></span>';
  const wrap = document.querySelector('.wrap');
  if (wrap) { wrap.style.flexDirection = 'column'; wrap.appendChild(a); }
  else document.body.appendChild(a);
})();
