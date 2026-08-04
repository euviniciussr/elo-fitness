(async function () {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
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
