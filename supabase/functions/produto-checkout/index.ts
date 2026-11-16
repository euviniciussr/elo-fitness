// POST /functions/v1/produto-checkout
// Gera o checkout hospedado do Asaas pra compra (ou renovação) de um
// produto digital (migration 0068). Chamado autenticado (JWT do comprador)
// de produto.html / meus-produtos.html. Preço, produto e validade vêm
// sempre do banco — nada do que o browser manda além do código do produto
// e do CPF entra na cobrança. A liberação do conteúdo NÃO acontece aqui:
// só no asaas-webhook, depois da confirmação do pagamento pelo Asaas.

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { callerClient, serviceClient } from "../_shared/supabase.ts";
import { asaasFetch } from "../_shared/asaas.ts";

const ORIGENS_OK = /^https:\/\/([a-z0-9-]+\.)*(elofitness\.com\.br|vercel\.app)(\/|$)|^http:\/\/localhost(:\d+)?(\/|$)/;

// Nome do item no checkout do Asaas (máx. 30 caracteres).
function comMarca(nome: string): string {
  const n = String(nome || "").trim();
  return n.length <= 16 ? `Elo Fitness · ${n}` : n.slice(0, 30);
}

function soDigitos(s: unknown): string {
  return String(s || "").replace(/\D/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const codigo = String(body.codigo || "").trim().toLowerCase();
    const cpf = soDigitos(body.cpf_cnpj);
    const baseUrl = String(body.base_url || "");
    if (!codigo || !baseUrl) return jsonResponse({ error: "Campos obrigatórios: codigo, base_url." }, 400);
    if (cpf.length !== 11 && cpf.length !== 14) return jsonResponse({ error: "Informe um CPF ou CNPJ válido." }, 400);
    if (!ORIGENS_OK.test(baseUrl)) return jsonResponse({ error: "Origem inválida." }, 400);

    const { data: { user } } = await callerClient(req).auth.getUser();
    if (!user) return jsonResponse({ error: "Entre na sua conta pra comprar." }, 401);

    const svc = serviceClient();
    const { data: produto } = await svc.from("produtos")
      .select("id, trainer_id, nome, descricao, preco, acesso_tipo, publicado, arquivado")
      .eq("codigo", codigo).maybeSingle();
    if (!produto || !produto.publicado || produto.arquivado) {
      return jsonResponse({ error: "Este produto não está disponível para compra." }, 404);
    }

    const { data: acesso } = await svc.from("acessos_produto")
      .select("vence_em").eq("produto_id", produto.id).eq("comprador_id", user.id).maybeSingle();
    if (acesso && acesso.vence_em === null) {
      return jsonResponse({ ja_possui: true });
    }

    const nome = String(body.nome || user.user_metadata?.nome || user.email || "").trim().slice(0, 100) || "Comprador Elo";

    const { data: compra, error: compraErr } = await svc.from("compras_produto").insert({
      produto_id: produto.id,
      trainer_id: produto.trainer_id,
      comprador_id: user.id,
      comprador_nome: nome,
      comprador_email: user.email,
      tipo: acesso ? "renovacao" : "compra",
      valor: produto.preco,
      status: "pendente",
    }).select("id").single();
    if (compraErr || !compra) throw compraErr || new Error("compra não criada");

    const voltar = `${baseUrl.replace(/\/$/, "")}/meus-produtos?compra=${compra.id}`;
    const pagina = `${baseUrl.replace(/\/$/, "")}/p/${codigo}`;

    const checkout = await asaasFetch("/checkouts", {
      method: "POST",
      body: JSON.stringify({
        billingTypes: ["PIX", "CREDIT_CARD"],
        chargeTypes: ["DETACHED"],
        minutesToExpire: 60,
        callback: { successUrl: voltar, cancelUrl: pagina, expiredUrl: pagina },
        items: [{
          // A conta Asaas é compartilhada com outras empresas: a marca Elo vai
          // em cada cobrança (nome do item), nunca na configuração da conta.
          name: comMarca(produto.nome),
          description: ("Elo Fitness · " + String(produto.descricao || produto.nome)).slice(0, 150),
          value: Number(produto.preco),
          quantity: 1,
        }],
        // Sem customerData: em produção o Asaas exige endereço e telefone
        // completos quando ele é enviado. Sem ele, o próprio checkout pede os
        // dados ao pagador.
        externalReference: `elofitness-produto:${compra.id}`,
      }),
    });

    await svc.from("compras_produto").update({ asaas_checkout_id: checkout.id }).eq("id", compra.id);

    return jsonResponse({ link: checkout.link, compra_id: compra.id });
  } catch (err) {
    console.error("[produto-checkout] falhou:", err);
    return jsonResponse({ error: "Não foi possível gerar o pagamento. Tente de novo em instantes." }, 500);
  }
});
