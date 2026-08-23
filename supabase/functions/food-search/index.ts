// GET/POST /functions/v1/food-search?q=pão
//
// Endpoint único de busca (Parte 5/13/22): consulta App + TBCA (locais) e
// FatSecret (externa, com cache) em paralelo, normaliza e deduplica
// (Parte 14) e devolve UMA lista — o frontend nunca sabe de onde cada item
// veio. Se a FatSecret falhar ou estiver sem credencial, devolve só os
// resultados locais + um aviso, sem quebrar a busca (Parte 24).

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { callerClient, serviceClient } from "../_shared/supabase.ts";
import { createAppProvider } from "../_shared/food/provider-app.ts";
import { createTbcaProvider } from "../_shared/food/provider-tbca.ts";
import { createFatSecretProvider } from "../_shared/food/provider-fatsecret.ts";
import { normalizeAndDedupe } from "../_shared/food/normalize.ts";
import type { NormalizedFood } from "../_shared/food/types.ts";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h — só cache de texto já buscado (Parte 9/23)

async function readParams(req: Request): Promise<{ q: string; region: string; language: string }> {
  if (req.method === "GET") {
    const url = new URL(req.url);
    return {
      q: url.searchParams.get("q") || "",
      region: url.searchParams.get("region") || "BR",
      language: url.searchParams.get("language") || "pt",
    };
  }
  const body = await req.json().catch(() => ({}));
  return { q: body.q || "", region: body.region || "BR", language: body.language || "pt" };
}

function cacheKey(q: string, region: string, language: string): string {
  return `${region}:${language}:${q.trim().toLowerCase()}`;
}

async function searchFatSecretWithCache(q: string, region: string, language: string): Promise<{ results: NormalizedFood[]; warning: string | null }> {
  const svc = serviceClient();
  const key = cacheKey(q, region, language);

  const { data: cached } = await svc.from("food_search_cache").select("results, fetched_at").eq("cache_key", key).maybeSingle();
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_TTL_MS) {
    return { results: cached.results as NormalizedFood[], warning: null };
  }

  try {
    const provider = createFatSecretProvider(region, language);
    const results = await provider.search({ q, region, language });
    // Cache best-effort — se a escrita falhar, ainda devolve os resultados.
    await svc.from("food_search_cache").upsert({
      cache_key: key, query_text: q, region, language, results, fetched_at: new Date().toISOString(),
    }).then(() => {}, () => {});
    return { results, warning: null };
  } catch (err) {
    console.error("[food-search] FatSecret indisponível:", err);
    // Cache expirado, mas presente, é melhor que nada durante uma instabilidade.
    if (cached) return { results: cached.results as NormalizedFood[], warning: "fatsecret_unavailable_stale_cache" };
    return { results: [], warning: "fatsecret_unavailable" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { q, region, language } = await readParams(req);
    if (!q.trim()) return jsonResponse({ results: [], warnings: [] });

    const supabase = callerClient(req);
    const appProvider = createAppProvider(supabase);
    const tbcaProvider = createTbcaProvider(supabase);

    const [appResults, tbcaResults, fatSecret] = await Promise.all([
      appProvider.search({ q }).catch((err) => { console.error("[food-search] App provider falhou:", err); return []; }),
      tbcaProvider.search({ q }).catch((err) => { console.error("[food-search] TBCA provider falhou:", err); return []; }),
      searchFatSecretWithCache(q, region, language),
    ]);

    const results = normalizeAndDedupe([...appResults, ...tbcaResults, ...fatSecret.results]);
    const warnings = fatSecret.warning ? [fatSecret.warning] : [];
    return jsonResponse({ results, warnings });
  } catch (err) {
    console.error("[food-search] Erro inesperado:", err);
    // Nunca deixa a montagem de dieta travada por um erro do servidor
    // (Parte 24/26) — devolve lista vazia com aviso em vez de 500 puro.
    return jsonResponse({ results: [], warnings: ["internal_error"] }, 200);
  }
});
