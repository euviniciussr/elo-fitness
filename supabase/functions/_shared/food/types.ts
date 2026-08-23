// Modelo normalizado de alimento (Parte 10 do pedido) — o frontend e as
// Edge Functions só conversam nesse formato. Nenhuma tela depende do
// formato original de nenhuma fonte (TACO/TBCA/FatSecret/App).

export type FoodSource = "APP" | "TBCA" | "FATSECRET";

// "unidade" é o identificador estável da medida (usado como <option value>
// no frontend); "label" é o texto exibido; grams/ml é quanto 1 dessa medida
// pesa/mede. Uma medida caseira sem conversão conhecida simplesmente não
// entra na lista (Parte 19: "não mostrar medidas sem conversão válida").
export interface FoodMeasure {
  unidade: string;
  label: string;
  grams?: number;
  ml?: number;
}

export interface NormalizedFood {
  // Id estável desta busca: "APP:<alimentos.id>" | "TBCA:<source_id>" |
  // "FATSECRET:<food_id>". Usado só pra dedupe/seleção na tela, nunca
  // persistido como está.
  id: string;
  source: FoodSource;
  sourceId: string | null;
  // Preenchido quando source === "APP": id real da linha em `alimentos`.
  alimentoId: string | null;
  nome: string;
  brandName: string | null;
  categoria: string | null;
  barcode: string | null;
  // Os 6 macros de referência são sempre "por 100g" (ou "por 100ml" quando
  // isLiquid), igual à convenção que já existia na base TACO — só assim dá
  // pra converter pra qualquer unidade escolhida (Parte 18).
  kcal: number | null;
  proteinaG: number | null;
  carboidratoG: number | null;
  gorduraG: number | null;
  fibraG: number | null;
  sodioMg: number | null;
  otherNutrients: Record<string, number>;
  defaultUnit: string;
  measures: FoodMeasure[];
  isLiquid: boolean;
}

export interface FoodSearchParams {
  q: string;
  region?: string;
  language?: string;
}

export interface ProviderWarning {
  source: FoodSource;
  reason: string;
}

export interface FoodProvider {
  name: FoodSource;
  search(params: FoodSearchParams): Promise<NormalizedFood[]>;
  autocomplete(params: FoodSearchParams): Promise<string[]>;
  getById(sourceId: string): Promise<NormalizedFood | null>;
  getByBarcode(barcode: string): Promise<NormalizedFood | null>;
}
