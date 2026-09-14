// Cálculo e helpers de evolução da Avaliação Física — fonte única usada por
// aluno-detalhe.html (profissional) e app-aluno.html (aluno), pra garantir
// que os dois lados sempre mostrem exatamente o mesmo número.
//
// Metodologia (não alterar sem pedido explícito): Jackson & Pollock 7
// dobras (densidade corporal) + Siri (% de gordura). Os valores intermediários
// (soma, densidade, % gordura) NUNCA são arredondados aqui — arredondamento
// é só na apresentação (toFixed/toLocaleString no HTML/PDF).

const DOBRAS_CAMPOS_PADRAO = [
  ['peitoral', 'Peitoral'],
  ['axilar_media', 'Axilar média'],
  ['triceps', 'Tríceps'],
  ['subescapular', 'Subescapular'],
  ['supra_iliaca', 'Supra-ilíaca'],
  ['abdominal', 'Abdominal'],
  ['coxa', 'Coxa']
];

function avaliacaoDobrasDeRegistro(av) {
  return {
    peitoral: av.dobra_peitoral, axilar_media: av.dobra_axilar_media, triceps: av.dobra_triceps,
    subescapular: av.dobra_subescapular, supra_iliaca: av.dobra_supra_iliaca, abdominal: av.dobra_abdominal, coxa: av.dobra_coxa
  };
}

function calcularComposicaoPollock(sexo, idade, dobras) {
  const soma = DOBRAS_CAMPOS_PADRAO.reduce((acc, [chave]) => acc + (Number(dobras[chave]) || 0), 0);
  const densidade = sexo === 'M'
    ? 1.112 - 0.00043499 * soma + 0.00000055 * soma * soma - 0.00028826 * idade
    : 1.097 - 0.00046971 * soma + 0.00000056 * soma * soma - 0.00012828 * idade;
  const percGordura = (495 / densidade) - 450;
  return { soma, densidade, percGordura };
}

// Snapshot completo de uma avaliação: soma, densidade, % gordura, massa de
// gordura, massa livre de gordura (nunca "massa muscular").
function avaliacaoResultado(av) {
  const { soma, densidade, percGordura } = calcularComposicaoPollock(av.sexo, av.idade, avaliacaoDobrasDeRegistro(av));
  const massaGorda = av.peso_kg * (percGordura / 100);
  const massaMagra = av.peso_kg - massaGorda;
  return { soma, densidade, percGordura, massaGorda, massaMagra };
}

// `a` = mais antiga, `b` = mais recente. % gordura em pontos percentuais
// (diferença direta, não variação relativa) — é o que o produto pede.
function diffAvaliacoes(a, b) {
  const ra = avaliacaoResultado(a), rb = avaliacaoResultado(b);
  return {
    peso: b.peso_kg - a.peso_kg,
    percGordura: rb.percGordura - ra.percGordura,
    massaGorda: rb.massaGorda - ra.massaGorda,
    massaMagra: rb.massaMagra - ra.massaMagra
  };
}

function fmtNum(n, casas) {
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

// "↓ 3,7 kg" / "↑ 1,7 kg" / "→ 0,0 kg" — usado nos cards de resumo.
function fmtDiffSeta(n, casas, sufixo) {
  const seta = n > 0.0001 ? '↑' : (n < -0.0001 ? '↓' : '→');
  return seta + ' ' + fmtNum(Math.abs(n), casas) + (sufixo || '');
}

// "+1,7 kg" / "-3,7 kg" — usado na tabela primeira x atual.
function fmtDiffSinal(n, casas, sufixo) {
  const sinal = n > 0.0001 ? '+' : (n < -0.0001 ? '-' : '');
  return sinal + fmtNum(Math.abs(n), casas) + (sufixo || '');
}

function fmtDataBr(dataStr) {
  return new Date(dataStr + 'T00:00:00').toLocaleDateString('pt-BR');
}

// Ordena por data (mais antiga primeiro) — todas as funções de evolução
// dependem dessa ordem.
function ordenarAvaliacoesAsc(lista) {
  return (lista || []).slice().sort((a, b) => a.data < b.data ? -1 : a.data > b.data ? 1 : 0);
}
