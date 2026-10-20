// Pesquisa de exercícios e alimentos: ignora acentos, maiúsculas, pontuação e
// a ordem das palavras. Cada termo relevante da busca precisa ser o começo de
// alguma palavra do nome ("abdominal solo" acha "Abdominal supra no solo",
// "extensao joelho" acha "Extensão de joelhos"); palavras de ligação ("de",
// "no", "com"...) não precisam ser digitadas. O nome exibido nunca é alterado.
// Mesma regra de public.normalizar_busca (migration 0067) e de
// supabase/functions/_shared/busca.ts — mudou aqui, mude lá também.
(function () {
  const DIACRITICOS = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');
  const LIGACAO = new Set(['a', 'o', 'as', 'os', 'e', 'de', 'da', 'do', 'das', 'dos', 'no', 'na', 'nos', 'nas', 'em', 'com', 'ao', 'aos', 'para', 'por']);

  function normalizar(s) {
    return String(s || '').normalize('NFD').replace(DIACRITICOS, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Termos relevantes da busca. Se o usuário digitou só palavras de ligação,
  // usa elas mesmas em vez de devolver tudo.
  function termos(q) {
    const todas = normalizar(q).split(' ').filter(Boolean);
    const relevantes = todas.filter(w => !LIGACAO.has(w));
    return relevantes.length ? relevantes : todas;
  }

  // Plural simples: "joelhos" também acha "joelho".
  function radical(t) {
    return t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t;
  }

  // Posição da primeira palavra do nome que começa com o termo, ou -1.
  function posicaoTermo(palavras, t) {
    const r = radical(t);
    return palavras.findIndex(p => p.startsWith(r));
  }

  // Menor = mais relevante; null = não combina.
  function pontuar(texto, q) {
    const ts = Array.isArray(q) ? q : termos(q);
    if (!ts.length) return 0;
    const nome = normalizar(texto);
    const palavras = nome.split(' ');
    let soma = 0;
    for (const t of ts) {
      const i = posicaoTermo(palavras, t);
      if (i < 0) return null;
      soma += i + (palavras[i] === t ? 0 : 0.5);
    }
    const frase = ts.join(' ');
    const bonusFrase = nome === frase ? -100 : nome.startsWith(frase) ? -50 : nome.includes(frase) ? -2 : 0;
    // Nome que começa pelo primeiro termo ("Leite, de vaca" numa busca por leite) vem antes.
    const bonusInicio = palavras[0].startsWith(radical(ts[0])) ? -3 : 0;
    return bonusFrase + bonusInicio + soma + palavras.length * 0.1;
  }

  function combina(texto, q) {
    return pontuar(texto, q) !== null;
  }

  // Filtra e ordena por relevância. Busca vazia devolve a lista como veio.
  function filtrar(lista, q, getTexto) {
    const ts = termos(q);
    if (!ts.length) return lista.slice();
    const get = getTexto || (x => x.nome);
    return lista
      .map((item, i) => ({ item, i, s: pontuar(get(item), ts) }))
      .filter(x => x.s !== null)
      .sort((a, b) => a.s - b.s || a.i - b.i)
      .map(x => x.item);
  }

  // Padrões ILIKE pra coluna `busca` (espaço inicial + nome normalizado): um
  // por termo, todos obrigatórios. "% mamao%" = alguma palavra começa com "mamao".
  function padroesIlike(q) {
    return termos(q).map(t => '% ' + radical(t) + '%');
  }

  window.BuscaInteligente = { normalizar, termos, pontuar, combina, filtrar, padroesIlike };
})();
