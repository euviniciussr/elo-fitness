// FoodProviderApp — base própria do app, 100% interna (sem terceiros).
// Combina duas tabelas, ambas já existentes no projeto, sob um único
// `source: "APP"`:
//   - `alimentos`: cadastros do treinador (trainer-scoped por RLS).
//   - `taco_alimentos`: biblioteca padrão do app (~600 itens, global,
//     somente leitura) — antes usada como fonte "TACO" separada; agora é
//     só a parte compartilhada da própria base do app, sem rótulo externo.
// Recebe o client do Supabase já autenticado com o JWT de quem chamou a
// Edge Function, então a RLS de sempre se aplica sem query extra aqui.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { FoodProvider, FoodSearchParams, NormalizedFood } from "./types.ts";

interface AlimentoRow {
  id: string;
  nome: string;
  categoria: string | null;
  kcal: number | null;
  proteina_g: number | null;
  carboidrato_g: number | null;
  gordura_g: number | null;
  fibra_g: number | null;
  sodio_mg: number | null;
  source: string;
  source_id: string | null;
  brand_name: string | null;
  barcode: string | null;
  other_nutrients: Record<string, number> | null;
  default_unit: string | null;
  measures: NormalizedFood["measures"] | null;
}

function toNormalized(row: AlimentoRow): NormalizedFood {
  return {
    id: `APP:${row.id}`,
    source: "APP",
    sourceId: row.source_id,
    alimentoId: row.id,
    nome: row.nome,
    brandName: row.brand_name,
    categoria: row.categoria,
    barcode: row.barcode,
    kcal: row.kcal,
    proteinaG: row.proteina_g,
    carboidratoG: row.carboidrato_g,
    gorduraG: row.gordura_g,
    fibraG: row.fibra_g,
    sodioMg: row.sodio_mg,
    otherNutrients: row.other_nutrients || {},
    defaultUnit: row.default_unit || "g",
    measures: row.measures || [],
    isLiquid: (row.default_unit || "g") === "ml",
  };
}

const SELECT_COLUMNS =
  "id, nome, categoria, kcal, proteina_g, carboidrato_g, gordura_g, fibra_g, sodio_mg, source, source_id, brand_name, barcode, other_nutrients, default_unit, measures";

// ---------- biblioteca padrão (taco_alimentos, global, só leitura) ----------

interface TacoRow {
  id: number;
  nome: string;
  categoria: string | null;
  kcal: number | null;
  proteina_g: number | null;
  carboidrato_g: number | null;
  gordura_g: number | null;
  fibra_g: number | null;
  sodio_mg: number | null;
}

// Prefixo "taco:" distingue esses ids (numéricos, tabela separada) dos
// uuids de `alimentos` sem precisar de coluna nova nem migration.
function tacoToNormalized(row: TacoRow): NormalizedFood {
  return {
    id: `APP:taco:${row.id}`,
    source: "APP",
    sourceId: `taco:${row.id}`,
    alimentoId: null,
    nome: row.nome,
    brandName: null,
    categoria: row.categoria,
    barcode: null,
    kcal: row.kcal,
    proteinaG: row.proteina_g,
    carboidratoG: row.carboidrato_g,
    gorduraG: row.gordura_g,
    fibraG: row.fibra_g,
    sodioMg: row.sodio_mg,
    otherNutrients: {},
    defaultUnit: "g",
    measures: [],
    isLiquid: false,
  };
}

const TACO_SELECT_COLUMNS = "id, nome, categoria, kcal, proteina_g, carboidrato_g, gordura_g, fibra_g, sodio_mg";

async function tacoSearch(supabase: SupabaseClient, term: string): Promise<NormalizedFood[]> {
  const { data, error } = await supabase.from("taco_alimentos").select(TACO_SELECT_COLUMNS).ilike("nome", `%${term}%`).limit(30);
  if (error || !data) return [];
  return (data as TacoRow[]).map(tacoToNormalized);
}

async function tacoAutocomplete(supabase: SupabaseClient, term: string): Promise<string[]> {
  const { data, error } = await supabase.from("taco_alimentos").select("nome").ilike("nome", `${term}%`).limit(10);
  if (error || !data) return [];
  return (data as Array<{ nome: string }>).map((r) => r.nome);
}

async function tacoGetById(supabase: SupabaseClient, id: string): Promise<NormalizedFood | null> {
  const { data, error } = await supabase.from("taco_alimentos").select(TACO_SELECT_COLUMNS).eq("id", Number(id)).maybeSingle();
  if (error || !data) return null;
  return tacoToNormalized(data as TacoRow);
}

export function createAppProvider(supabase: SupabaseClient): FoodProvider {
  return {
    name: "APP",
    async search({ q }: FoodSearchParams): Promise<NormalizedFood[]> {
      // Vírgula quebraria a sintaxe do filtro .or() do PostgREST — remove
      // antes de montar a string (busca continua funcionando sem ela).
      const term = q.trim().replace(/,/g, " ");
      if (!term) return [];
      const [ownResult, tacoResult] = await Promise.all([
        supabase.from("alimentos").select(SELECT_COLUMNS).or(`nome.ilike.%${term}%,brand_name.ilike.%${term}%`).limit(30),
        tacoSearch(supabase, term),
      ]);
      const own = ownResult.error || !ownResult.data ? [] : (ownResult.data as AlimentoRow[]).map(toNormalized);
      // Base do treinador primeiro (já revisada/usada por ele), depois a
      // biblioteca padrão do app (Parte 14 — ordem de prioridade).
      return [...own, ...tacoResult];
    },
    async autocomplete({ q }: FoodSearchParams): Promise<string[]> {
      const term = q.trim();
      if (!term) return [];
      const [ownResult, tacoNames] = await Promise.all([
        supabase.from("alimentos").select("nome").ilike("nome", `${term}%`).limit(10),
        tacoAutocomplete(supabase, term),
      ]);
      const own = ownResult.error || !ownResult.data ? [] : (ownResult.data as Pick<AlimentoRow, "nome">[]).map((r) => r.nome);
      return [...own, ...tacoNames];
    },
    async getById(sourceId: string): Promise<NormalizedFood | null> {
      if (sourceId.startsWith("taco:")) return tacoGetById(supabase, sourceId.slice(5));
      const { data, error } = await supabase
        .from("alimentos")
        .select(SELECT_COLUMNS)
        .eq("id", sourceId)
        .maybeSingle();
      if (error || !data) return null;
      return toNormalized(data as AlimentoRow);
    },
    async getByBarcode(barcode: string): Promise<NormalizedFood | null> {
      const { data, error } = await supabase
        .from("alimentos")
        .select(SELECT_COLUMNS)
        .eq("barcode", barcode)
        .maybeSingle();
      if (error || !data) return null;
      return toNormalized(data as AlimentoRow);
    },
  };
}
