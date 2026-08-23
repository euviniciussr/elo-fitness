// GET/POST /functions/v1/food-autocomplete?q=pã
//
// Sugestões rápidas enquanto o usuário digita (Parte 6). Mais leve que
// food-search: só nomes, sem macro. Debounce de 300-500ms é
// responsabilidade do frontend (Parte 6/26) — esta function não limita
// chamadas, só responde rápido e barato.

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { callerClient } from "../_shared/supabase.ts";
import { createAppProvider } from "../_shared/food/provider-app.ts";
import { createTbcaProvider } from "../_shared/food/provider-tbca.ts";
import { createFatSecretProvider } from "../_shared/food/provider-fatsecret.ts";

async function readParams(req: Request): Promise<{ q: string; region: string }> {
  if (req.method === "GET") {
    const url = new URL(req.url);
    return { q: url.searchParams.get("q") || "", region: url.searchParams.get("region") || "BR" };
  }
  const body = await req.json().catch(() => ({}));
  return { q: body.q || "", region: body.region || "BR" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { q, region } = await readParams(req);
    if (!q.trim()) return jsonResponse({ suggestions: [] });

    const supabase = callerClient(req);
    const [appNames, tbcaNames, fatSecretNames] = await Promise.all([
      createAppProvider(supabase).autocomplete({ q }).catch(() => []),
      createTbcaProvider(supabase).autocomplete({ q }).catch(() => []),
      createFatSecretProvider(region).autocomplete({ q }).catch((err) => { console.error("[food-autocomplete] FatSecret falhou:", err); return []; }),
    ]);

    const seen = new Set<string>();
    const suggestions: string[] = [];
    for (const name of [...appNames, ...tbcaNames, ...fatSecretNames]) {
      const key = name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      suggestions.push(name);
    }

    return jsonResponse({ suggestions: suggestions.slice(0, 12) });
  } catch (err) {
    console.error("[food-autocomplete] Erro inesperado:", err);
    return jsonResponse({ suggestions: [] }, 200);
  }
});
