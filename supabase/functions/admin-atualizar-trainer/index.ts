// POST /functions/v1/admin-atualizar-trainer
// Permite ao admin (trainers.is_admin = true) sobrepor manualmente o estado
// de assinatura de outro trainer (ex: marcar isento, mudar plano) — as
// colunas de billing são travadas pra qualquer chamada autenticada normal
// (ver migration 0037_assinatura_asaas.sql), então isso precisa passar pela
// service role depois de confirmar que quem está chamando é admin.

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { callerClient, serviceClient } from "../_shared/supabase.ts";

const CAMPOS_PERMITIDOS = ["status_assinatura", "plano_id", "trial_termina_em", "assinatura_valida_ate"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { trainer_id, ...campos } = body;
    if (!trainer_id) return jsonResponse({ error: "trainer_id é obrigatório." }, 400);

    const supabase = callerClient(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonResponse({ error: "Não autenticado." }, 401);

    const { data: caller } = await supabase.from("trainers").select("is_admin").eq("id", user.id).single();
    if (!caller || !caller.is_admin) return jsonResponse({ error: "Apenas admin pode fazer isso." }, 403);

    const update: Record<string, unknown> = {};
    for (const campo of CAMPOS_PERMITIDOS) {
      if (campo in campos) update[campo] = campos[campo];
    }
    if (Object.keys(update).length === 0) {
      return jsonResponse({ error: "Nenhum campo válido enviado." }, 400);
    }

    const svc = serviceClient();
    const { error } = await svc.from("trainers").update(update).eq("id", trainer_id);
    if (error) return jsonResponse({ error: error.message }, 500);

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("[admin-atualizar-trainer] falhou:", err);
    return jsonResponse({ error: "Erro ao atualizar trainer." }, 500);
  }
});
