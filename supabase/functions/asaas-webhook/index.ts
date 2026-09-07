// POST /functions/v1/asaas-webhook
// Recebe eventos de pagamento do Asaas. Endpoint público — verify_jwt
// desligado no deploy (não é uma chamada de um usuário logado no Supabase
// Auth, é o servidor do Asaas chamando direto). Autenticação é o header
// asaas-access-token, configurado igual no Asaas e como secret aqui. Ver
// design em docs/superpowers/specs/2026-09-07-assinatura-asaas-design.md.

import { jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { asaasFetch } from "../_shared/asaas.ts";

const WEBHOOK_TOKEN = Deno.env.get("ASAAS_WEBHOOK_TOKEN")!;

function somarUmMes(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

Deno.serve(async (req) => {
  if (req.headers.get("asaas-access-token") !== WEBHOOK_TOKEN) {
    return jsonResponse({ error: "Token inválido." }, 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const eventosConfirmacao = ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"];
    const eventosAtraso = ["PAYMENT_OVERDUE"];
    if (!body.payment || !body.payment.id || (!eventosConfirmacao.includes(body.event) && !eventosAtraso.includes(body.event))) {
      return jsonResponse({ ignored: true });
    }

    const payment = await asaasFetch(`/payments/${body.payment.id}`);
    const ref = String(payment.externalReference || "");
    const partes = ref.split(":");
    if (partes[0] !== "elofitness" || !partes[1]) {
      return jsonResponse({ ignored: true }); // evento de outro produto na mesma conta Asaas
    }
    const trainerId = partes[1];
    const planoId = partes[2] || null;

    const svc = serviceClient();

    if (eventosConfirmacao.includes(body.event)) {
      await svc.from("assinatura_pagamentos").upsert({
        trainer_id: trainerId,
        asaas_payment_id: payment.id,
        valor: payment.value,
        status: payment.status,
        data_pagamento: new Date().toISOString().slice(0, 10),
      }, { onConflict: "asaas_payment_id" });

      await svc.from("trainers").update({
        status_assinatura: "ativo",
        assinatura_valida_ate: somarUmMes(),
        asaas_customer_id: payment.customer,
        asaas_subscription_id: payment.subscription,
        plano_id: planoId,
      }).eq("id", trainerId);
    } else {
      await svc.from("trainers").update({ status_assinatura: "inadimplente" }).eq("id", trainerId);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("[asaas-webhook] falhou:", err);
    return jsonResponse({ error: "Erro ao processar webhook." }, 500);
  }
});
