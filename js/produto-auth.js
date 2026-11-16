// Entrar / criar conta dentro do fluxo de compra de produto digital
// (produto.html e meus-produtos.html). Mesmo Supabase Auth do login.html:
// conta nova nasce com cadastro de aluno (handle_new_trainer, tipo 'aluno'
// → contas_aluno, migration 0059). E-mail que já tem conta nunca vira
// conta duplicada — cai no "entrar" com a senha existente.
const ProdutoAuth = (() => {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // container: elemento onde o formulário é desenhado.
  // aoEntrar(user): chamado com a sessão ativa.
  function montar(container, aoEntrar, opts) {
    opts = opts || {};
    let modo = opts.modo || 'cadastro';
    let msg = '';
    let msgOk = false;

    function render() {
      const cad = modo === 'cadastro';
      container.innerHTML =
        '<div class="pa-tabs">' +
          '<button type="button" class="pa-tab' + (cad ? ' sel' : '') + '" data-m="cadastro">Criar conta</button>' +
          '<button type="button" class="pa-tab' + (!cad ? ' sel' : '') + '" data-m="login">Já tenho conta</button>' +
        '</div>' +
        (cad ? '<label>Seu nome</label><input id="pa-nome" autocomplete="name" placeholder="Nome completo">' : '') +
        '<label>E-mail</label><input id="pa-email" type="email" autocomplete="email" placeholder="voce@email.com">' +
        '<label>Senha</label><input id="pa-senha" type="password" autocomplete="' + (cad ? 'new-password' : 'current-password') + '" placeholder="' + (cad ? 'Mínimo de 6 caracteres' : 'Sua senha') + '">' +
        (msg ? '<div class="' + (msgOk ? 'pa-ok' : 'pa-erro') + '">' + esc(msg) + '</div>' : '') +
        '<button type="button" class="pa-btn" id="pa-enviar">' + (cad ? 'Criar conta e continuar' : 'Entrar e continuar') + '</button>' +
        (!cad ? '<button type="button" class="pa-link" id="pa-esqueci">Esqueci minha senha</button>' : '');
      container.querySelectorAll('.pa-tab').forEach(b => b.addEventListener('click', () => { modo = b.dataset.m; msg = ''; render(); }));
      container.querySelector('#pa-enviar').addEventListener('click', enviar);
      container.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') enviar(); }));
      const esq = container.querySelector('#pa-esqueci');
      if (esq) esq.addEventListener('click', esqueci);
    }

    function valores() {
      const g = id => { const e = container.querySelector('#' + id); return e ? e.value.trim() : ''; };
      return { nome: g('pa-nome'), email: g('pa-email').toLowerCase(), senha: (container.querySelector('#pa-senha') || {}).value || '' };
    }

    async function esqueci() {
      const { email } = valores();
      if (!email) { msg = 'Digite seu e-mail acima.'; msgOk = false; render(); return; }
      await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/redefinir-senha' });
      msg = 'Se houver conta com esse e-mail, enviamos o link para redefinir a senha.'; msgOk = true;
      render();
      container.querySelector('#pa-email').value = email;
    }

    async function enviar() {
      const v = valores();
      const btn = container.querySelector('#pa-enviar');
      if (!v.email || !v.senha || (modo === 'cadastro' && !v.nome)) { msg = 'Preencha todos os campos.'; msgOk = false; render(); refill(v); return; }
      if (modo === 'cadastro' && v.senha.length < 6) { msg = 'A senha precisa ter pelo menos 6 caracteres.'; msgOk = false; render(); refill(v); return; }
      btn.disabled = true; btn.textContent = 'Aguarde…';

      if (modo === 'cadastro') {
        const { data, error } = await supabaseClient.auth.signUp({
          email: v.email, password: v.senha, options: { data: { nome: v.nome, tipo: 'aluno' } }
        });
        const jaExiste = (error && /already|registered|exists/i.test(error.message))
          || (!error && data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0);
        if (jaExiste) {
          // Tenta entrar com a senha digitada; se não bater, pede a senha da conta existente.
          const r = await supabaseClient.auth.signInWithPassword({ email: v.email, password: v.senha });
          if (!r.error && r.data.user) { aoEntrar(r.data.user); return; }
          modo = 'login'; msg = 'Esse e-mail já tem conta na Elo. Entre com a senha dela.'; msgOk = false;
          render(); refill(v); return;
        }
        if (error) { msg = error.message; msgOk = false; render(); refill(v); return; }
        if (data && data.session) {
          try { supabaseClient.functions.invoke('enviar-email', { body: { tipo: 'boas_vindas' } }); } catch (e) {}
          aoEntrar(data.user);
          return;
        }
        modo = 'login'; msg = 'Conta criada! Confirme pelo e-mail que enviamos e depois entre aqui.'; msgOk = true;
        render(); refill(v); return;
      }

      const { data, error } = await supabaseClient.auth.signInWithPassword({ email: v.email, password: v.senha });
      if (error) {
        msg = error.message === 'Email not confirmed' ? 'Confirme seu e-mail antes de entrar.' : 'E-mail ou senha inválidos.';
        msgOk = false; render(); refill(v); return;
      }
      aoEntrar(data.user);
    }

    function refill(v) {
      const set = (id, val) => { const e = container.querySelector('#' + id); if (e && val) e.value = val; };
      set('pa-nome', v.nome); set('pa-email', v.email);
    }

    render();
  }

  return { montar };
})();
