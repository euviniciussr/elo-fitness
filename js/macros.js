// Sugestão automática de macronutrientes a partir da meta calórica —
// fonte única usada por aluno-detalhe.html (aba TBM-GET) e
// montar-dieta.html, pra nunca divergir entre as duas telas.
//
// Regra fixa por peso corporal (não por % de calorias, nunca por
// objetivo/atividade — esses já determinam a META CALÓRICA em si, essa
// função só distribui a meta entre os 3 macros): proteína e gordura por
// g/kg de peso, carboidrato sempre por DIFERENÇA pra fechar a meta exata.
const MACROS_CONFIG = {
  proteinaGkgPadrao: 1.8,
  proteinaGkgFalsoMagro: 2.0, // única exceção: estado_atual = 'falso_magro'
  gorduraGkg: 0.8
};

// sexo/idade/altura/nivelAtividade/objetivo/massaLivreGordura não entram
// mais na conta (já estão embutidos na própria meta calórica, calculada
// via TMB/GET antes desta função) — ficam no parâmetro só por
// compatibilidade com quem já chama essa função, sem precisar mudar os
// call sites em aluno-detalhe.html/montar-dieta.html.
function calcularMacrosMetaCalorica({ sexo, idade, peso, altura, nivelAtividade, objetivo, estadoAtual, metaCalorica, massaLivreGordura }) {
  const meta = Number(metaCalorica) || 0;
  const pesoTotal = Number(peso) || 0;
  const gkgProteina = estadoAtual === 'falso_magro' ? MACROS_CONFIG.proteinaGkgFalsoMagro : MACROS_CONFIG.proteinaGkgPadrao;

  const proteina_g = gkgProteina * pesoTotal;
  const gordura_g = MACROS_CONFIG.gorduraGkg * pesoTotal;
  const calorias_proteina = proteina_g * 4;
  const calorias_gordura = gordura_g * 9;
  const carboidrato_g = Math.max(0, (meta - calorias_proteina - calorias_gordura) / 4);
  const calorias_carboidrato = carboidrato_g * 4;

  return {
    proteina_g, gordura_g, carboidrato_g,
    calorias_proteina, calorias_gordura, calorias_carboidrato,
    calorias_totais: calorias_proteina + calorias_gordura + calorias_carboidrato
  };
}

// Reaproveitada pela edição manual: profissional muda proteína e/ou
// gordura, carboidrato sempre fecha o resto da meta (item 10 do pedido).
// Nunca deixa carboidrato negativo (retorna 0 nesse caso — a UI mostra a
// diferença pro profissional perceber que passou da meta).
function fecharCarboidratoNaMeta(metaCalorica, proteina_g, gordura_g) {
  const meta = Number(metaCalorica) || 0;
  const kcalRestante = meta - (Number(proteina_g) || 0) * 4 - (Number(gordura_g) || 0) * 9;
  return Math.max(0, kcalRestante / 4);
}

function macrosFmt(n) {
  return Math.round(Number(n) || 0);
}
