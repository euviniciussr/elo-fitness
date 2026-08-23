// CORS padrão pras Edge Functions de alimentos — chamadas vêm do browser
// (supabaseClient.functions.invoke em montar-dieta.html), então toda
// function precisa responder o preflight OPTIONS e ecoar estes headers.

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
