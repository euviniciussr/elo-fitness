// Lista oficial de categorias de exercício (exercicios.categoria é texto).
// Espelha public.canonizar_categoria_exercicio (migration 0067), que também
// canoniza no banco tudo que é gravado — mudou aqui, mude lá também. O select
// estático do acervo.html repete esta lista (o runtime não aceita sc-for
// dentro de <select>).
(function () {
  const LISTA = [
    'Peitoral', 'Dorsal', 'Deltoide', 'Quadríceps', 'Isquiotibiais', 'Glúteos',
    'Bíceps', 'Tríceps', 'Antebraço', 'Panturrilha', 'Ativação', 'Alongamentos',
    'Mobilidade', 'Fortalecimento MMII', 'Trapézio', 'Adutor', 'Core', 'Abdômen',
    'Lombar', 'Pliometria', 'Potência e aceleração'
  ];
  const DIACRITICOS = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');
  const chave = s => String(s || '').normalize('NFD').replace(DIACRITICOS, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function canonica(c) {
    const k = chave(c);
    if (!k) return null;
    if (k === 'alongamento') return 'Alongamentos';
    return LISTA.find(x => chave(x) === k) || String(c).trim().replace(/\s+/g, ' ');
  }

  // Lista oficial + categorias que já existem nos dados (ex.: antigas), sem
  // duplicar variações, em ordem alfabética.
  function paraFiltro(exercicios) {
    const porChave = new Map(LISTA.map(c => [chave(c), c]));
    (exercicios || []).forEach(e => {
      const c = canonica(e && e.categoria);
      if (c && !porChave.has(chave(c))) porChave.set(chave(c), c);
    });
    return Array.from(porChave.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  window.CategoriasExercicio = { LISTA, canonica, paraFiltro };
})();
