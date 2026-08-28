// Conversão de unidade -> gramas/ml e cálculo de macro pra uma quantidade
// escolhida (Partes 15-19). Um único ponto de verdade: usado tanto pela
// Edge Function food-get (pra montar a lista de medidas de um alimento)
// quanto, em espelho, pelo frontend (montar-dieta.html) pra recalcular em
// tempo real sem round-trip ao servidor a cada troca de quantidade/unidade.

import type { FoodMeasure, NormalizedFood } from "./types.ts";

export const GRAM_MEASURE: FoodMeasure = { unidade: "g", label: "g", grams: 1 };
export const ML_MEASURE: FoodMeasure = { unidade: "ml", label: "ml", ml: 1 };

// Rótulos amigáveis pras medidas caseiras mais comuns (Parte 16). O
// `unidade` é o slug estável; o `label` é só apresentação.
export const MEASURE_LABELS: Record<string, string> = {
  unidade: "unidade",
  fatia: "fatia",
  colher_sopa: "colher de sopa",
  colher_cha: "colher de chá",
  xicara: "xícara",
  copo: "copo",
  concha: "concha",
};

export function labelFor(unidade: string, fallback?: string): string {
  return MEASURE_LABELS[unidade] || fallback || unidade;
}

// Medidas sempre disponíveis pra um alimento (Parte 15/17): "g" sempre;
// "ml" só quando o alimento é líquido. Medidas caseiras só entram se a
// fonte informou uma conversão (Parte 19 — nunca inventar uma conversão).
export function availableMeasures(food: Pick<NormalizedFood, "isLiquid" | "measures">): FoodMeasure[] {
  const base: FoodMeasure[] = food.isLiquid ? [ML_MEASURE, GRAM_MEASURE] : [GRAM_MEASURE];
  const extras = (food.measures || []).filter((m) => m.unidade !== "g" && m.unidade !== "ml");
  return [...base, ...extras];
}

// Converte "quantidade na unidade escolhida" pra gramas (referência
// nutricional canônica, Parte 18). Retorna null se a unidade não tiver
// conversão conhecida pro alimento (não deveria acontecer se a UI só
// oferece unidades vindas de `availableMeasures`, mas fica defensivo).
export function toGrams(food: Pick<NormalizedFood, "isLiquid" | "measures">, quantidade: number, unidade: string): number | null {
  if (unidade === "g") return quantidade;
  if (unidade === "ml") {
    // Nunca assume 1ml = 1g (Parte 17). Só converte ml->g se a própria
    // fonte informou uma densidade equivalente via medida "ml" com grams.
    const mlMeasure = (food.measures || []).find((m) => m.unidade === "ml" && m.grams != null);
    if (mlMeasure?.grams) return (quantidade * mlMeasure.grams) / (mlMeasure.ml || 1);
    // Sem densidade conhecida: ml é a própria unidade de referência
    // (perReference "per100ml" já cobre o cálculo direto, ver computeNutrients).
    return null;
  }
  const measure = (food.measures || []).find((m) => m.unidade === unidade);
  if (!measure || measure.grams == null) return null;
  return quantidade * measure.grams;
}

export interface ComputedNutrients {
  kcal: number;
  proteinaG: number;
  carboidratoG: number;
  gorduraG: number;
  fibraG: number;
  sodioMg: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Referência dos 6 macros é sempre "por 100" (g ou ml, conforme
// food.isLiquid) — Parte 18. `quantidade`/`unidade` é o que o usuário
// escolheu na tela.
export function computeNutrients(
  food: Pick<NormalizedFood, "isLiquid" | "measures" | "kcal" | "proteinaG" | "carboidratoG" | "gorduraG" | "fibraG" | "sodioMg">,
  quantidade: number,
  unidade: string,
): ComputedNutrients | null {
  let base: number | null;
  if (food.isLiquid && unidade === "ml") {
    base = quantidade; // per100ml direto
  } else {
    base = toGrams(food, quantidade, unidade);
  }
  if (base == null) return null;
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

// kcal entregue por 1 unidade de `unidade` deste alimento, sem o
// arredondamento de computeNutrients (arredondar a taxa antes de escalar
// pra uma quantidade grande amplificaria o erro) — usada só por
// solveQuantityForKcal, que resolve a quantidade de um substituto
// equivalente em calorias ao alimento original ("Substituíveis").
export function kcalPerUnit(
  food: Pick<NormalizedFood, "isLiquid" | "measures" | "kcal">,
  unidade: string,
): number | null {
  if (food.isLiquid && unidade === "ml") return (food.kcal || 0) / 100;
  const gramsPerUnit = toGrams(food, 1, unidade);
  if (gramsPerUnit == null) return null;
  return (food.kcal || 0) / 100 * gramsPerUnit;
}

// Dado um alimento substituto e uma meta de kcal (a kcal do alimento
// original que ele vai substituir), resolve quantos `unidade` desse
// substituto entregam a mesma kcal. kcal é linear em quantidade pra uma
// unidade fixa, então isso é só inverter kcalPerUnit — nenhuma lógica de
// conversão nova além da já usada em toGrams/computeNutrients.
export function solveQuantityForKcal(
  food: Pick<NormalizedFood, "isLiquid" | "measures" | "kcal">,
  targetKcal: number,
  unidade: string,
): number | null {
  const rate = kcalPerUnit(food, unidade);
  if (!rate || !isFinite(rate)) return null;
  const qtd = targetKcal / rate;
  return isFinite(qtd) && qtd > 0 ? round1(qtd) : null;
}
