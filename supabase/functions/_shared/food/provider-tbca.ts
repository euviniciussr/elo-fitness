// FoodProviderTBCA — base de referência nutricional brasileira (USP).
// Lê da tabela `tbca_alimentos` (global, somente leitura). A tabela está
// vazia até haver um dataset licenciado pra importar (ver
// supabase/migrations/0015_tbca_alimentos.sql) — este provider já funciona
// de ponta a ponta e passa a retornar resultados reais assim que houver
// linhas na tabela, sem precisar mexer em nenhum outro arquivo.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { FoodProvider, FoodSearchParams, NormalizedFood } from "./types.ts";

// Mesmo fix de busca-por-palavras do provider-app.ts (ver comentário lá):
// nomes no formato "Alimento, Descritor" não batem com ILIKE de frase
// inteira. Mantido aqui pra quando a TBCA tiver dados reais.
function stripAccentsLower(s: string): string {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function splitWords(q: string): string[] {
  return stripAccentsLower(q.replace(/,/g, " ")).split(/\s+/).filter(Boolean);
}

function matchesAllWords(text: string, words: string[]): boolean {
  const norm = stripAccentsLower(text);
  return words.every((w) => norm.includes(w));
}

interface TbcaRow {
  source_id: string | null;
  nome: string;
  categoria: string | null;
  kcal: number | null;
  proteina_g: number | null;
  carboidrato_g: number | null;
  gordura_g: number | null;
  fibra_g: number | null;
  sodio_mg: number | null;
  other_nutrients: Record<string, number> | null;
  default_unit: string | null;
  measures: NormalizedFood["measures"] | null;
}

function toNormalized(row: TbcaRow): NormalizedFood {
  return {
    id: `TBCA:${row.source_id}`,
    source: "TBCA",
    sourceId: row.source_id,
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
    otherNutrients: row.other_nutrients || {},
    defaultUnit: row.default_unit || "g",
    measures: row.measures || [],
    isLiquid: (row.default_unit || "g") === "ml",
  };
}

const SELECT_COLUMNS =
  "source_id, nome, categoria, kcal, proteina_g, carboidrato_g, gordura_g, fibra_g, sodio_mg, other_nutrients, default_unit, measures";

export function createTbcaProvider(supabase: SupabaseClient): FoodProvider {
  return {
    name: "TBCA",
    async search({ q }: FoodSearchParams): Promise<NormalizedFood[]> {
      const words = splitWords(q);
      if (!words.length) return [];
      const { data, error } = await supabase
        .from("tbca_alimentos")
        .select(SELECT_COLUMNS)
        .or(words.map((w) => `nome.ilike.%${w}%`).join(","))
        .limit(200);
      if (error || !data) return [];
      return (data as TbcaRow[])
        .filter((r) => matchesAllWords(r.nome, words))
        .slice(0, 30)
        .map(toNormalized);
    },
    async autocomplete({ q }: FoodSearchParams): Promise<string[]> {
      const words = splitWords(q);
      if (!words.length) return [];
      const { data, error } = await supabase
        .from("tbca_alimentos")
        .select("nome")
        .or(words.map((w) => `nome.ilike.%${w}%`).join(","))
        .limit(50);
      if (error || !data) return [];
      return (data as Pick<TbcaRow, "nome">[])
        .filter((r) => matchesAllWords(r.nome, words))
        .slice(0, 10)
        .map((r) => r.nome);
    },
    async getById(sourceId: string): Promise<NormalizedFood | null> {
      const { data, error } = await supabase
        .from("tbca_alimentos")
        .select(SELECT_COLUMNS)
        .eq("source_id", sourceId)
        .maybeSingle();
      if (error || !data) return null;
      return toNormalized(data as TbcaRow);
    },
    // TBCA não tem conceito de código de barras (não é um dataset de
    // produtos de marca) — sempre null, de propósito.
    async getByBarcode(): Promise<NormalizedFood | null> {
      return null;
    },
  };
}
