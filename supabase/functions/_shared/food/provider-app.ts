// FoodProviderApp — base própria do app, 100% interna (sem terceiros).
// Combina duas tabelas, ambas já existentes no projeto, sob um único
// `source: "APP"`:
//   - `alimentos`: cadastros do treinador (trainer-scoped por RLS).
//   - `taco_alimentos`: biblioteca padrão do app (~600 itens, global,
//     somente leitura) — antes usada como fonte "TACO" separada; agora é
//     só a parte compartilhada da própria base do app, sem rótulo externo.
// Recebe o client do Supabase já autenticado com o JWT de quem chamou a
// Edge Function, então a RLS de sempre se aplica sem query extra aqui.
//
// BUSCA POR PALAVRAS (não por frase literal) — ver ../busca.ts:
// Os nomes da base padrão seguem o formato "Alimento, Descritor, Descritor2"
// (ex.: "Pão, trigo, francês"). Um ILIKE '%pão francês%' (frase inteira,
// contígua) nunca bate com esse formato, porque a vírgula+descritor fica no
// meio. A busca exige que CADA termo relevante seja o começo de alguma
// palavra do nome, sem acento e em qualquer ordem. Em `alimentos` isso já é
// filtrado no Postgres (coluna `busca`); a base padrão (~600 linhas) fica em
// cache no isolate e é filtrada em memória.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { FoodProvider, FoodSearchParams, NormalizedFood } from "./types.ts";
import { filtrar, padroesIlike, termos } from "../busca.ts";

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
  default_unit: string | null;
  measures: NormalizedFood["measures"] | null;
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
    defaultUnit: row.default_unit || "g",
    measures: row.measures || [],
    isLiquid: (row.default_unit || "g") === "ml",
  };
}

const TACO_SELECT_COLUMNS =
  "id, nome, categoria, kcal, proteina_g, carboidrato_g, gordura_g, fibra_g, sodio_mg, default_unit, measures";

// A tabela padrão é global, read-only e pequena (~600 linhas) — cachear em
// memória do isolate evita rebuscar tudo a cada tecla digitada (debounce de
// 400ms no frontend já reduz chamadas, isto reduz ainda mais round-trips ao
// Postgres). TTL curto só como rede de segurança.
let tacoCache: { rows: TacoRow[]; fetchedAt: number } | null = null;
const TACO_CACHE_TTL_MS = 10 * 60 * 1000;

async function loadTacoRows(supabase: SupabaseClient): Promise<TacoRow[]> {
  if (tacoCache && Date.now() - tacoCache.fetchedAt < TACO_CACHE_TTL_MS) return tacoCache.rows;
  const { data, error } = await supabase.from("taco_alimentos").select(TACO_SELECT_COLUMNS).limit(1000);
  if (error || !data) return tacoCache?.rows || [];
  tacoCache = { rows: data as TacoRow[], fetchedAt: Date.now() };
  return tacoCache.rows;
}

async function tacoSearch(supabase: SupabaseClient, words: string[]): Promise<NormalizedFood[]> {
  const rows = await loadTacoRows(supabase);
  return filtrar(rows, words, (r) => r.nome).slice(0, 30).map(tacoToNormalized);
}

async function tacoAutocomplete(supabase: SupabaseClient, words: string[]): Promise<string[]> {
  const rows = await loadTacoRows(supabase);
  return filtrar(rows, words, (r) => r.nome).slice(0, 10).map((r) => r.nome);
}



async function tacoGetById(supabase: SupabaseClient, id: string): Promise<NormalizedFood | null> {
  const rows = await loadTacoRows(supabase);
  const row = rows.find((r) => String(r.id) === id);
  if (row) return tacoToNormalized(row);
  // fallback direto (cache pode ter expirado / linha nova) — busca pontual.
  const { data, error } = await supabase.from("taco_alimentos").select(TACO_SELECT_COLUMNS).eq("id", Number(id)).maybeSingle();
  if (error || !data) return null;
  return tacoToNormalized(data as TacoRow);
}

export function createAppProvider(supabase: SupabaseClient): FoodProvider {
  return {
    name: "APP",
    async search({ q }: FoodSearchParams): Promise<NormalizedFood[]> {
      const words = termos(q);
      if (!words.length) return [];
      // Todos os termos obrigatórios já no Postgres, pela coluna gerada `busca`
      // (sem acento, índice trigram — migration 0067); relevância em memória.
      let ownQuery = supabase.from("alimentos").select(SELECT_COLUMNS);
      for (const p of padroesIlike(words)) ownQuery = ownQuery.ilike("busca", p);
      const [ownResult, tacoResult] = await Promise.all([
        ownQuery.limit(200),
        tacoSearch(supabase, words),
      ]);
      const ownRows = filtrar(
        ownResult.error || !ownResult.data ? [] : (ownResult.data as AlimentoRow[]),
        words,
        (r) => [r.nome, r.brand_name].filter(Boolean).join(" "),
      ).slice(0, 30);
      const own = ownRows.map(toNormalized);
      // Base do treinador primeiro (já revisada/usada por ele), depois a
      // biblioteca padrão do app (Parte 14 — ordem de prioridade).
      return [...own, ...tacoResult];
    },
    async autocomplete({ q }: FoodSearchParams): Promise<string[]> {
      const words = termos(q);
      if (!words.length) return [];
      let ownQuery = supabase.from("alimentos").select("nome, brand_name");
      for (const p of padroesIlike(words)) ownQuery = ownQuery.ilike("busca", p);
      const [ownResult, tacoNames] = await Promise.all([
        ownQuery.limit(50),
        tacoAutocomplete(supabase, words),
      ]);
      const own = filtrar(
        ownResult.error || !ownResult.data ? [] : (ownResult.data as Pick<AlimentoRow, "nome" | "brand_name">[]),
        words,
        (r) => [r.nome, r.brand_name].filter(Boolean).join(" "),
      ).slice(0, 10).map((r) => r.nome);
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
