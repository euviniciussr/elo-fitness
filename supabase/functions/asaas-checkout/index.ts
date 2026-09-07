// POST /functions/v1/asaas-checkout
// Gera o link de checkout hospedado do Asaas pra um trainer assinar um dos
// planos em planos_assinatura. Chamado autenticado (JWT do trainer) do
// frontend (assinatura.html). Ver design em
// docs/superpowers/specs/2026-09-07-assinatura-asaas-design.md.

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { callerClient } from "../_shared/supabase.ts";
import { asaasFetch } from "../_shared/asaas.ts";

function amanha(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { plano_id, cpf_cnpj, successUrl, cancelUrl, expiredUrl } = body;
    if (!plano_id || !cpf_cnpj || !successUrl || !cancelUrl || !expiredUrl) {
      return jsonResponse({ error: "Campos obrigatórios: plano_id, cpf_cnpj, successUrl, cancelUrl, expiredUrl." }, 400);
    }

    const supabase = callerClient(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonResponse({ error: "Não autenticado." }, 401);

    const { data: trainer } = await supabase.from("trainers").select("nome, email").eq("id", user.id).single();
    if (!trainer) return jsonResponse({ error: "Trainer não encontrado." }, 404);

    const { data: plano } = await supabase.from("planos_assinatura").select("nome, valor").eq("id", plano_id).eq("ativo", true).single();
    if (!plano) return jsonResponse({ error: "Plano inválido." }, 400);

    await supabase.from("trainers").update({ cpf_cnpj }).eq("id", user.id);

    const checkout = await asaasFetch("/checkouts", {
      method: "POST",
      body: JSON.stringify({
        billingTypes: ["CREDIT_CARD"],
        chargeTypes: ["RECURRENT"],
        minutesToExpire: 60,
        callback: { successUrl, cancelUrl, expiredUrl },
        items: [{ name: plano.nome.slice(0, 30), value: plano.valor, quantity: 1 }],
        customerData: { name: trainer.nome, cpfCnpj: cpf_cnpj, email: trainer.email },
        subscription: { cycle: "MONTHLY", nextDueDate: amanha() },
        externalReference: `elofitness:${user.id}:${plano_id}`,
      }),
    });

    return jsonResponse({ link: checkout.link });
  } catch (err) {
    console.error("[asaas-checkout] falhou:", err);
    return jsonResponse({ error: "Não foi possível gerar o checkout." }, 500);
  }
});
