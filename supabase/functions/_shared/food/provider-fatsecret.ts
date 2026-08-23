// FoodProviderFatSecret — integração server-side com a FatSecret Platform
// API (Partes 4-9). Endpoints conforme especificado no pedido original;
// FatSecret versiona esses métodos (existem v2/v3/v5 mais novos) — se v1
// for descontinuado, só este arquivo muda (URLs isoladas em REST_BASE +
// os paths abaixo).
//
// Detalhe importante: `foods.search` da FatSecret NÃO devolve macros
// estruturados, só um resumo em texto (`food_description`, ex.: "Per 100g
// - Calories: 265kcal | Fat: 14.98g | Carbs: 30.60g | Protein: 5.13g").
// Fazemos um parse best-effort desse texto só pra dar um preview no card
// de resultado (Parte 13); os valores AUTORITATIVOS sempre vêm de
// `food.get` (Parte 7), chamado quando o usuário seleciona o alimento.

import type { FoodProvider, FoodMeasure, FoodSearchParams, NormalizedFood } from "./types.ts";
import { getFatSecretAccessToken, hasFatSecretCredentials } from "./fatsecret-oauth.ts";

const REST_BASE = "https://platform.fatsecret.com/rest";
const REQUEST_TIMEOUT_MS = 5000;

async function fatSecretGetOnce(path: string, params: Record<string, string>): Promise<unknown> {
  const token = await getFatSecretAccessToken();
  const url = new URL(`${REST_BASE}${path}`);
  url.searchParams.set("format", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`FatSecret ${path} falhou (${res.status}): ${await res.text().catch(() => "")}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// Retry único (Parte 26) — só pra instabilidade transitória de rede/5xx, não
// pra erro de credencial/4xx (tentar de novo não resolveria e só atrasa a
// resposta pro usuário).
async function fatSecretGet(path: string, params: Record<string, string>): Promise<unknown> {
  try {
    return await fatSecretGetOnce(path, params);
  } catch (err) {
    console.warn(`[fatsecret] Retry pra ${path} após falha:`, err);
    return await fatSecretGetOnce(path, params);
  }
}

// A API da FatSecret devolve um objeto único (não array) quando só há 1
// resultado — gambiarra conhecida da API, precisa normalizar sempre.
function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseDescriptionMacros(description: string | undefined): Partial<Pick<NormalizedFood, "kcal" | "gorduraG" | "carboidratoG" | "proteinaG">> {
  if (!description) return {};
  const num = (re: RegExp) => {
    const m = description.match(re);
    return m ? Number(m[1].replace(",", ".")) : null;
  };
  return {
    kcal: num(/Calories?:\s*([\d.,]+)/i),
    gorduraG: num(/Fat:\s*([\d.,]+)/i),
    carboidratoG: num(/Carbs?:\s*([\d.,]+)/i),
    proteinaG: num(/Protein:\s*([\d.,]+)/i),
  };
}

interface FatSecretSearchFood {
  food_id: string;
  food_name: string;
  food_type?: string; // "Brand" | "Generic"
  brand_name?: string;
  food_description?: string;
}

function toPreviewNormalized(food: FatSecretSearchFood): NormalizedFood {
  const macros = parseDescriptionMacros(food.food_description);
  return {
    id: `FATSECRET:${food.food_id}`,
    source: "FATSECRET",
    sourceId: food.food_id,
    alimentoId: null,
    nome: food.food_name,
    brandName: food.brand_name || null,
    categoria: null,
    barcode: null,
    kcal: macros.kcal ?? null,
    proteinaG: macros.proteinaG ?? null,
    carboidratoG: macros.carboidratoG ?? null,
    gorduraG: macros.gorduraG ?? null,
    fibraG: null,
    sodioMg: null,
    otherNutrients: {},
    defaultUnit: "g",
    measures: [],
    isLiquid: false,
  };
}

// Vocabulário PT-BR pra reconhecer a medida caseira pelo texto da FatSecret
// (region=BR/language=pt já pede descrições em português quando existem).
const MEASURE_PATTERNS: Array<[RegExp, string]> = [
  [/colher.*sopa/i, "colher_sopa"],
  [/colher.*ch[aá]/i, "colher_cha"],
  [/x[ií]cara/i, "xicara"],
  [/copo/i, "copo"],
  [/concha/i, "concha"],
  [/fatia/i, "fatia"],
  [/unidade|unit/i, "unidade"],
];

function slugForServing(description: string): string {
  for (const [re, slug] of MEASURE_PATTERNS) if (re.test(description)) return slug;
  // Sem correspondência conhecida: usa um slug derivado do texto (ainda
  // assim é uma conversão válida, só sem rótulo "bonito" fixo).
  return description.toLowerCase().normalize("NFD").replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "porcao";
}

interface FatSecretServing {
  serving_id: string;
  serving_description: string;
  metric_serving_amount?: string;
  metric_serving_unit?: string; // "g" | "ml" | ...
  calories?: string;
  protein?: string;
  carbohydrate?: string;
  fat?: string;
  fiber?: string;
  sodium?: string;
}

interface FatSecretFoodGet {
  food_id: string;
  food_name: string;
  food_type?: string;
  brand_name?: string;
  servings?: { serving?: FatSecretServing | FatSecretServing[] };
}

function toFullNormalized(food: FatSecretFoodGet): NormalizedFood {
  const servings = asArray(food.servings?.serving);
  const gramServings = servings.filter((s) => (s.metric_serving_unit || "").toLowerCase() === "g" && s.metric_serving_amount);
  const mlServings = servings.filter((s) => (s.metric_serving_unit || "").toLowerCase() === "ml" && s.metric_serving_amount);
  const isLiquid = gramServings.length === 0 && mlServings.length > 0;
  const referenceServings = isLiquid ? mlServings : gramServings;

  // Referência canônica "por 100" (g ou ml): usa a serving mais próxima de
  // 100 e escala pra 100 exato, igual à convenção da TACO/TBCA.
  let kcal: number | null = null, proteinaG: number | null = null, carboidratoG: number | null = null;
  let gorduraG: number | null = null, fibraG: number | null = null, sodioMg: number | null = null;
  if (referenceServings.length) {
    const ref = referenceServings.reduce((best, s) =>
      Math.abs(Number(s.metric_serving_amount) - 100) < Math.abs(Number(best.metric_serving_amount) - 100) ? s : best
    );
    const amount = Number(ref.metric_serving_amount) || 100;
    const scale = 100 / amount;
    const num = (v: string | undefined) => (v != null ? Number(v) * scale : null);
    kcal = num(ref.calories);
    proteinaG = num(ref.protein);
    carboidratoG = num(ref.carbohydrate);
    gorduraG = num(ref.fat);
    fibraG = num(ref.fiber);
    sodioMg = num(ref.sodium);
  }

  // Medidas caseiras (Parte 16/19): toda serving com conversão métrica
  // conhecida vira uma opção na tela, exceto quando ela É a própria
  // referência de 100g/100ml (já coberta pela unidade "g"/"ml" base).
  const measures: FoodMeasure[] = servings
    .filter((s) => s.metric_serving_amount && Number(s.metric_serving_amount) !== 100)
    .map((s) => {
      const unit = (s.metric_serving_unit || "").toLowerCase();
      const amount = Number(s.metric_serving_amount);
      return {
        unidade: slugForServing(s.serving_description),
        label: s.serving_description,
        grams: unit === "g" ? amount : undefined,
        ml: unit === "ml" ? amount : undefined,
      };
    })
    .filter((m) => m.grams != null || m.ml != null);

  return {
    id: `FATSECRET:${food.food_id}`,
    source: "FATSECRET",
    sourceId: food.food_id,
    alimentoId: null,
    nome: food.food_name,
    brandName: food.brand_name || null,
    categoria: food.food_type || null,
    barcode: null,
    kcal, proteinaG, carboidratoG, gorduraG, fibraG, sodioMg,
    otherNutrients: {},
    defaultUnit: isLiquid ? "ml" : "g",
    measures,
    isLiquid,
  };
}

// GTIN-13/EAN-13 já tem 13 dígitos; EAN-8 e UPC-A são preenchidos com
// zero à esquerda até 13 (convenção da FatSecret pra barcode lookup).
function toGtin13(barcode: string): string {
  const digits = barcode.replace(/\D/g, "");
  return digits.padStart(13, "0");
}

export function createFatSecretProvider(region = "BR", language = "pt"): FoodProvider {
  return {
    name: "FATSECRET",
    async search({ q }: FoodSearchParams): Promise<NormalizedFood[]> {
      if (!hasFatSecretCredentials() || !q.trim()) return [];
      const json = await fatSecretGet("/foods/search/v1", {
        search_expression: q.trim(),
        region,
        language,
        max_results: "20",
      }) as { foods?: { food?: FatSecretSearchFood | FatSecretSearchFood[] } };
      return asArray(json.foods?.food).map(toPreviewNormalized);
    },
    async autocomplete({ q }: FoodSearchParams): Promise<string[]> {
      if (!hasFatSecretCredentials() || !q.trim()) return [];
      const json = await fatSecretGet("/food/autocomplete/v1", {
        expression: q.trim(),
        region,
        max_results: "10",
      }) as { suggestions?: { suggestion?: string | string[] } };
      return asArray(json.suggestions?.suggestion);
    },
    async getById(sourceId: string): Promise<NormalizedFood | null> {
      if (!hasFatSecretCredentials()) return null;
      const json = await fatSecretGet("/food/v1", { food_id: sourceId }) as { food?: FatSecretFoodGet };
      if (!json.food) return null;
      return toFullNormalized(json.food);
    },
    async getByBarcode(barcode: string): Promise<NormalizedFood | null> {
      if (!hasFatSecretCredentials()) return null;
      const json = await fatSecretGet("/food/barcode/find-by-id/v1", {
        barcode: toGtin13(barcode),
      }) as { food_id?: { value?: string } };
      const foodId = json.food_id?.value;
      if (!foodId || foodId === "0") return null;
      return this.getById(foodId);
    },
  };
}
