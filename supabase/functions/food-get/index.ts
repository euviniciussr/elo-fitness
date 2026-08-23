// GET/POST /functions/v1/food-get?source=FATSECRET&source_id=12345
//
// Detalhes completos de um alimento já selecionado (Parte 7) — chamado só
// depois que o usuário escolhe um item na lista de busca. Pra `source=APP`
// ou `TBCA`, `source_id` é o id da linha (alimentos.id ou
// tbca_alimentos.source_id); pra `FATSECRET`, é o food_id da FatSecret.

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { callerClient } from "../_shared/supabase.ts";
import { createAppProvider } from "../_shared/food/provider-app.ts";
import { createTbcaProvider } from "../_shared/food/provider-tbca.ts";
import { createFatSecretProvider } from "../_shared/food/provider-fatsecret.ts";
import type { FoodProvider, FoodSource } from "../_shared/food/types.ts";

async function readParams(req: Request): Promise<{ source: string; sourceId: string }> {
  if (req.method === "GET") {
    const url = new URL(req.url);
    return { source: url.searchParams.get("source") || "", sourceId: url.searchParams.get("source_id") || "" };
  }
  const body = await req.json().catch(() => ({}));
  return { source: body.source || "", sourceId: body.source_id || body.sourceId || "" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { source, sourceId } = await readParams(req);
    if (!source || !sourceId) return jsonResponse({ error: "source e source_id são obrigatórios." }, 400);

    const supabase = callerClient(req);
    const providers: Record<FoodSource, FoodProvider> = {
      APP: createAppProvider(supabase),
      TBCA: createTbcaProvider(supabase),
      FATSECRET: createFatSecretProvider(),
    };
    const provider = providers[source as FoodSource];
    if (!provider) return jsonResponse({ error: `Fonte desconhecida: ${source}` }, 400);

    const food = await provider.getById(sourceId);
    if (!food) return jsonResponse({ error: "Alimento não encontrado." }, 404);
    return jsonResponse({ food });
  } catch (err) {
    console.error("[food-get] Erro:", err);
    return jsonResponse({ error: "Não foi possível obter os detalhes do alimento agora." }, 502);
  }
});
