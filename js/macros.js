// Sugestão automática de macronutrientes a partir da meta calórica —
// fonte única usada por aluno-detalhe.html (aba TBM-GET) e
// montar-dieta.html, pra nunca divergir entre as duas telas.
//
// Princípio (não é "biotipo X = Y% fixo"): proteína por g/kg (peso total
// ou massa livre de gordura quando disponível, evitando proteína absurda
// em peso corporal alto), gordura numa faixa fisiológica mínima/máxima, e
// carboidrato sempre por DIFERENÇA pra fechar a meta calórica exata —
// nunca por fórmula própria. Baseado em faixas de referência ISSN/ACSM
// (proteína 1.6-2.2 g/kg pra a maioria dos objetivos de composição
// corporal; gordura mínima ~0.6-0.8 g/kg ou piso de 20-25% das calorias).
//
// Todas as faixas abaixo ficam isoladas nesse objeto de config — ajustar
// a lógica no futuro é editar esses números, não reescrever a função.
const MACROS_CONFIG = {
  proteinaGkgPorObjetivo: {
    manter: 1.8,
    emagrecer: 2.0,
    emagrecer_agressivo: 2.2,
    ganho_seco: 1.8,
    ganho_agressivo: 1.6
  },
  // Modificador aditivo (g/kg) por classificação corporal — desloca a
  // faixa, nunca substitui o cálculo por peso/massa magra.
  proteinaModificadorPorEstado: {
    magro: 0,
    magro_gordura_moderada: 0.05,
    falso_magro: 0.15,
    acima_peso: -0.1
  },
  proteinaGkgPisoDuro: 1.2, // nunca abaixo disso, mesmo em meta muito baixa
  gorduraGkgMinimo: 0.7,    // piso fisiológico (ácidos graxos essenciais, vitaminas lipossolúveis)
  gorduraGkgPisoDuro: 0.5,  // piso absoluto se precisar liberar espaço pra fechar a meta
  gorduraPercentMinimo: 0.25,
  gorduraPercentMaximo: 0.35,
  carboidratoMinimoG: 20 // piso de segurança pra nunca zerar carboidrato numa meta muito baixa
};

// Entrada: sexo/idade/altura não entram na fórmula em si (já estão
// embutidos na própria meta calórica, calculada via TMB/GET antes desta
// função) — ficam no parâmetro só pra a assinatura documentar a origem
// completa dos dados, como pedido.
function calcularMacrosMetaCalorica({ sexo, idade, peso, altura, nivelAtividade, objetivo, estadoAtual, metaCalorica, massaLivreGordura }) {
  const meta = Number(metaCalorica) || 0;
  const pesoTotal = Number(peso) || 0;
  const pesoRefProteina = massaLivreGordura && massaLivreGordura > 0 ? Number(massaLivreGordura) : pesoTotal;

  const baseGkg = MACROS_CONFIG.proteinaGkgPorObjetivo[objetivo] != null
    ? MACROS_CONFIG.proteinaGkgPorObjetivo[objetivo] : MACROS_CONFIG.proteinaGkgPorObjetivo.manter;
  const modGkg = MACROS_CONFIG.proteinaModificadorPorEstado[estadoAtual] || 0;
  const gkgProteina = Math.max(MACROS_CONFIG.proteinaGkgPisoDuro, baseGkg + modGkg);

  let proteina_g = gkgProteina * pesoRefProteina;
  let calorias_proteina = proteina_g * 4;

  const gorduraPisoGkg = MACROS_CONFIG.gorduraGkgMinimo * pesoTotal;
  const gorduraPisoPercent = (MACROS_CONFIG.gorduraPercentMinimo * meta) / 9;
  const gorduraTetoPercent = (MACROS_CONFIG.gorduraPercentMaximo * meta) / 9;
  let gordura_g = Math.min(Math.max(gorduraPisoGkg, gorduraPisoPercent), Math.max(gorduraTetoPercent, gorduraPisoGkg));
  let calorias_gordura = gordura_g * 9;

  // Se proteína + gordura já não deixam espaço mínimo pro carboidrato
  // (meta muito baixa, ou peso de referência alto), libera espaço
  // reduzindo primeiro a gordura até o piso duro, depois a proteína até
  // o piso duro — nunca deixa o carboidrato ficar negativo.
  let calorias_restantes = meta - calorias_proteina - calorias_gordura;
  const kcalMinCarbo = MACROS_CONFIG.carboidratoMinimoG * 4;

  if (calorias_restantes < kcalMinCarbo) {
    const gorduraPisoDuro = MACROS_CONFIG.gorduraGkgPisoDuro * pesoTotal;
    const kcalFaltando = kcalMinCarbo - calorias_restantes;
    const reduzGorduraKcal = Math.min(kcalFaltando, Math.max(0, (gordura_g - gorduraPisoDuro) * 9));
    gordura_g -= reduzGorduraKcal / 9;
    calorias_gordura = gordura_g * 9;
    calorias_restantes = meta - calorias_proteina - calorias_gordura;
  }

  if (calorias_restantes < kcalMinCarbo) {
    const proteinaPisoDuro = MACROS_CONFIG.proteinaGkgPisoDuro * pesoTotal;
    const kcalFaltando = kcalMinCarbo - calorias_restantes;
    const reduzProteinaKcal = Math.min(kcalFaltando, Math.max(0, (proteina_g - proteinaPisoDuro) * 4));
    proteina_g -= reduzProteinaKcal / 4;
    calorias_proteina = proteina_g * 4;
    calorias_restantes = meta - calorias_proteina - calorias_gordura;
  }

  const carboidrato_g = Math.max(0, calorias_restantes / 4);
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
