// Espelho em JS puro (sem build) de supabase/functions/_shared/food/measures.ts
// — usado só pelo frontend pra recalcular kcal/macros em tempo real
// (Parte 18) sem round-trip ao servidor a cada troca de quantidade/unidade.
// Qualquer mudança na lógica de conversão precisa ser replicada nos dois
// arquivos (são poucas linhas, de propósito, pra manter isso barato).

const MEASURE_LABELS = {
  unidade: 'unidade',
  fatia: 'fatia',
  colher_sopa: 'colher de sopa',
  colher_cha: 'colher de chá',
  xicara: 'xícara',
  copo: 'copo',
  concha: 'concha',
};

function foodMeasureLabel(unidade, fallback) {
  return MEASURE_LABELS[unidade] || fallback || unidade;
}

// "g" sempre disponível; "ml" só se o alimento for líquido (Parte 15/17);
// medidas caseiras só se a fonte informou a conversão (Parte 19).
function availableMeasures(food) {
  const base = food.isLiquid
    ? [{ unidade: 'ml', label: 'ml', ml: 1 }, { unidade: 'g', label: 'g', grams: 1 }]
    : [{ unidade: 'g', label: 'g', grams: 1 }];
  const extras = (food.measures || []).filter((m) => m.unidade !== 'g' && m.unidade !== 'ml');
  return base.concat(extras);
}

function toGrams(food, quantidade, unidade) {
  if (unidade === 'g') return quantidade;
  if (unidade === 'ml') {
    const mlMeasure = (food.measures || []).find((m) => m.unidade === 'ml' && m.grams != null);
    if (mlMeasure && mlMeasure.grams) return (quantidade * mlMeasure.grams) / (mlMeasure.ml || 1);
    return null;
  }
  const measure = (food.measures || []).find((m) => m.unidade === unidade);
  if (!measure || measure.grams == null) return null;
  return quantidade * measure.grams;
}

function round1(n) { return Math.round(n * 10) / 10; }

// Referência dos 6 macros do NormalizedFood é sempre "por 100" (g ou ml).
function computeNutrients(food, quantidade, unidade) {
  let base;
  if (food.isLiquid && unidade === 'ml') {
    base = quantidade;
  } else {
    base = toGrams(food, quantidade, unidade);
  }
  if (base == null || !isFinite(base)) return null;
  const f = base / 100;
  return {
    kcal: round1((food.kcal || 0) * f),
    proteinaG: round1((food.proteinaG || 0) * f),
    carboidratoG: round1((food.carboidratoG || 0) * f),
    gorduraG: round1((food.gorduraG || 0) * f),
    fibraG: round1((food.fibraG || 0) * f),
    sodioMg: round1((food.sodioMg || 0) * f),
  };
}
