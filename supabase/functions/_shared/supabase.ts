// Clients Supabase usados pelas Edge Functions de alimentos.
//
// `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são
// injetadas automaticamente pelo runtime de Edge Functions do Supabase —
// não precisam ser configuradas manualmente como secret.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Client com o JWT de quem chamou a function — toda query nele respeita a
// RLS normal (trainer só vê o que é dele), igual a uma chamada direta do
// browser.
export function callerClient(req: Request): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
  );
}

// Client com a service role — só usado pra ler/escrever
// `food_search_cache` (Parte 23), que não tem GRANT pra `authenticated`.
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}
