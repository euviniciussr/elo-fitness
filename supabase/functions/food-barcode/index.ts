// GET/POST /functions/v1/food-barcode?barcode=7891000100103
//
// Busca por código de barras (Parte 8): GTIN-13/EAN-13/EAN-8/UPC-A. Checa
// primeiro a base própria do treinador (alimentos.barcode, já indexado —
// migration 0014) antes de consultar a FatSecret, e sempre devolve o
// alimento completo (não só o food_id), pronto pra ir direto pra tela de
// quantidade.

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { callerClient } from "../_shared/supabase.ts";
import { createAppProvider } from "../_shared/food/provider-app.ts";
import { createFatSecretProvider } from "../_shared/food/provider-fatsecret.ts";

async function readParams(req: Request): Promise<{ barcode: string }> {
  if (req.method === "GET") {
    const url = new URL(req.url);
    return { barcode: url.searchParams.get("barcode") || "" };
  }
  const body = await req.json().catch(() => ({}));
  return { barcode: body.barcode || "" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { barcode } = await readParams(req);
    const digits = barcode.replace(/\D/g, "");
    if (!digits) return jsonResponse({ error: "Código de barras inválido." }, 400);

    const supabase = callerClient(req);
    const local = await createAppProvider(supabase).getByBarcode(digits);
    if (local) return jsonResponse({ food: local });

    const food = await createFatSecretProvider().getByBarcode(digits);
    if (!food) return jsonResponse({ error: "Nenhum produto encontrado pra esse código de barras." }, 404);
    return jsonResponse({ food });
  } catch (err) {
    console.error("[food-barcode] Erro:", err);
    return jsonResponse({ error: "Não foi possível consultar o código de barras agora." }, 502);
  }
});
