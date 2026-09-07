(async function () {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return;
  }
  if (!location.pathname.endsWith('assinatura.html')) {
    aplicarBloqueioAssinatura(session.user.id);
  }
})();

document.addEventListener('click', function (e) {
  const link = e.target.closest && e.target.closest('a[href="login.html"]');
  if (!link) return;
  e.preventDefault();
  supabaseClient.auth.signOut().finally(function () {
    window.location.href = 'login.html';
  });
}, true);

// Assinatura: 14 dias de trial + 3 dias de aviso, depois bloqueia escrita.
// Some silenciosamente pra qualquer sessão que não seja de um trainer
// (ex: app-aluno.html, onde quem loga é o cliente, não o profissional).
async function aplicarBloqueioAssinatura(userId) {
  const { data: trainer } = await supabaseClient
    .from('trainers')
    .select('status_assinatura, trial_termina_em, assinatura_valida_ate, plano_id, planos_assinatura(valor)')
    .eq('id', userId)
    .maybeSingle();
  if (!trainer || trainer.status_assinatura === 'isento') return;
  // Plano de R$0 (o "Grátis até 5 alunos") é permanente — sem data de
  // vencimento pra checar, igual isento. O limite de alunos em si é
  // reforçado em adicionar-aluno.html via planos_assinatura.limite_alunos.
  if (trainer.planos_assinatura && Number(trainer.planos_assinatura.valor) === 0) return;

  const baseStr = trainer.assinatura_valida_ate || trainer.trial_termina_em;
  if (!baseStr) return;

  const hojeStr = dataLocalStr();
  const limiteStr = somarDias(baseStr, 3);

  if (hojeStr <= baseStr) return;

  if (hojeStr <= limiteStr) {
    mostrarAvisoAssinatura(diffDias(hojeStr, limiteStr));
    return;
  }

  // Trial vencido (+ 3 dias de aviso) e nunca escolheu plano nenhum: cai
  // no plano permanente grátis em vez de ser bloqueado. Quem já tinha
  // um plano pago e ficou inadimplente (pagamento falhou) não entra aqui
  // porque status_assinatura já não é mais 'trial' nesse caso.
  if (trainer.status_assinatura === 'trial') {
    const { error } = await supabaseClient.functions.invoke('ativar-plano-gratis');
    if (!error) {
      mostrarAvisoPlanoGratis();
      return;
    }
  }

  bloquearEdicao();
}

function dataLocalStr(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function somarDias(dataStr, dias) {
  const [y, m, d] = dataStr.split('-').map(Number);
  return dataLocalStr(new Date(y, m - 1, d + dias));
}

function diffDias(deStr, ateStr) {
  const [y1, m1, d1] = deStr.split('-').map(Number);
  const [y2, m2, d2] = ateStr.split('-').map(Number);
  const ms = new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1);
  return Math.max(0, Math.round(ms / 86400000));
}

function mostrarAvisoAssinatura(diasRestantes) {
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#f97316;color:#fff;padding:10px 16px;font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;';
  banner.innerHTML = '<span>Seu período de teste terminou. Faltam ' + diasRestantes + ' dia(s) pra sua conta ser bloqueada.</span>'
    + '<a href="assinatura.html" style="background:#fff;color:#ea580c;border-radius:8px;padding:6px 14px;font-weight:700;font-size:13px;">Assinar agora</a>';
  document.body.prepend(banner);
}

function mostrarAvisoPlanoGratis() {
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#1e2633;color:#e5e9f0;padding:10px 16px;font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;';
  banner.innerHTML = '<span>Você está no plano grátis (até 5 alunos).</span>'
    + '<a href="assinatura.html" style="background:#f97316;color:#fff;border-radius:8px;padding:6px 14px;font-weight:700;font-size:13px;">Ver planos pagos</a>';
  document.body.prepend(banner);
}

function bloquearEdicao() {
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#dc2626;color:#fff;padding:10px 16px;font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;';
  banner.innerHTML = '<span>Sua assinatura está pendente. Você continua vendo seus dados, mas não consegue criar ou editar nada até assinar.</span>'
    + '<a href="assinatura.html" style="background:#fff;color:#dc2626;border-radius:8px;padding:6px 14px;font-weight:700;font-size:13px;">Assinar agora</a>';
  document.body.prepend(banner);

  const style = document.createElement('style');
  style.textContent = 'body.assinatura-bloqueada input, body.assinatura-bloqueada textarea, body.assinatura-bloqueada select { pointer-events:none !important; opacity:.5 !important; }';
  document.head.appendChild(style);
  document.body.classList.add('assinatura-bloqueada');
}
