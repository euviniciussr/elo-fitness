// Foto de perfil (personal e aluno). Bucket público `fotos-perfil` (0050):
// cada conta só escreve na própria pasta `<auth.uid()>/...`.
//
// Antes de enviar, a foto é reduzida e convertida pra JPEG no próprio
// aparelho: foto de celular vem com 3–12MB e às vezes em HEIC (iPhone), que
// o Chrome/Android não exibem. Se o navegador não conseguir decodificar a
// imagem, envia o arquivo original.
const FotoPerfil = (function () {
  const LADO_MAX = 512;

  function carregarImagem(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('imagem inválida')); };
      img.src = url;
    });
  }

  async function comprimir(file) {
    try {
      const img = await carregarImagem(file);
      const escala = Math.min(1, LADO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * escala));
      const h = Math.max(1, Math.round(img.naturalHeight * escala));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const blob = await new Promise(function (r) { canvas.toBlob(r, 'image/jpeg', 0.85); });
      if (blob) return { blob: blob, ext: 'jpg', tipo: 'image/jpeg' };
    } catch (e) {}
    const ext = ((file.name || '').split('.').pop() || 'jpg').toLowerCase();
    return { blob: file, ext: ext, tipo: file.type || 'image/jpeg' };
  }

  // Envia e devolve { path, url } ou lança erro com mensagem legível.
  async function enviar(file, prefixo) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error('Sessão expirada. Entre de novo.');
    const f = await comprimir(file);
    const path = user.id + '/' + prefixo + '-' + Date.now() + '.' + f.ext;
    const { error } = await supabaseClient.storage.from('fotos-perfil').upload(path, f.blob, { upsert: true, contentType: f.tipo });
    if (error) throw new Error(error.message);
    return { path: path, url: urlPublica(path) };
  }

  function urlPublica(path) {
    return path ? supabaseClient.storage.from('fotos-perfil').getPublicUrl(path).data.publicUrl : '';
  }

  // Remove fotos antigas da própria pasta (mantém a atual). Falha é ignorada.
  async function limparAntigas(prefixo, pathAtual) {
    try {
      const { data: { user } } = await supabaseClient.auth.getUser();
      const { data } = await supabaseClient.storage.from('fotos-perfil').list(user.id, { limit: 100 });
      const velhas = (data || []).map(function (o) { return user.id + '/' + o.name; })
        .filter(function (p) { return p !== pathAtual && p.indexOf(user.id + '/' + prefixo + '-') === 0; });
      if (velhas.length) await supabaseClient.storage.from('fotos-perfil').remove(velhas);
    } catch (e) {}
  }

  return { enviar: enviar, urlPublica: urlPublica, limparAntigas: limparAntigas };
})();
