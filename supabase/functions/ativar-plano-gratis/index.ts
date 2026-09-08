// POST /functions/v1/ativar-plano-gratis
// Auto-service: um trainer cujo trial (14 dias + 3 de aviso) já venceu, e
// que ainda não escolheu nenhum plano pago, é movido pro plano permanente
// "Grátis (até 5 alunos)" em vez de ficar bloqueado — MAS só se já não tiver
// mais alunos que o limite do plano grátis. Durante o trial não tem limite
// de quantos alunos pode cadastrar (só depois de ter um plano é que
// adicionar-aluno.html passa a bloquear novas adições), então alguém com 10
// alunos no fim do trial não pode simplesmente cair no grátis-até-5 — nesse
// caso o auth-guard.js cai no bloqueio normal (cobrança) igual quem não é
// elegível. Só age na própria conta de quem chama (sem trainer_id no body)
// — diferente de admin-atualizar-trainer, que é admin mexendo em outro trainer.
//
// Toda a checagem de elegibilidade é refeita aqui do lado do servidor
// (não confia no auth-guard.js do browser) pra ninguém conseguir chamar
// isso antes da hora só porque desligou o bloqueio client-side.

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { callerClient, serviceClient } from "../_shared/supabase.ts";

const NOME_PLANO_GRATIS = "Grátis (até 5 alunos)";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = callerClient(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonResponse({ error: "Não autenticado." }, 401);

    const svc = serviceClient();

    const { data: trainer, error: trainerError } = await svc
      .from("trainers")
      .select("status_assinatura, trial_termina_em, plano_id")
      .eq("id", user.id)
      .maybeSingle();
    if (trainerError || !trainer) return jsonResponse({ error: "Profissional não encontrado." }, 404);

    if (trainer.status_assinatura !== "trial") {
      return jsonResponse({ error: "Só se aplica a quem ainda está em trial." }, 400);
    }
    if (!trainer.trial_termina_em) {
      return jsonResponse({ error: "Sem data de trial definida." }, 400);
    }

    const fimTrial = new Date(trainer.trial_termina_em + "T00:00:00");
    const limiteComGraca = new Date(fimTrial);
    limiteComGraca.setDate(limiteComGraca.getDate() + 3);
    if (new Date() <= limiteComGraca) {
      return jsonResponse({ error: "O trial (+ 3 dias de aviso) ainda não venceu." }, 400);
    }

    const { data: planoGratis, error: planoError } = await svc
      .from("planos_assinatura")
      .select("id, limite_alunos")
      .eq("nome", NOME_PLANO_GRATIS)
      .maybeSingle();
    if (planoError || !planoGratis) return jsonResponse({ error: "Plano grátis não configurado." }, 500);

    if (planoGratis.limite_alunos != null) {
      const { count, error: countError } = await svc
        .from("clientes")
        .select("id", { count: "exact", head: true })
        .eq("trainer_id", user.id);
      if (countError) return jsonResponse({ error: countError.message }, 500);
      if ((count || 0) > planoGratis.limite_alunos) {
        return jsonResponse({ error: "Você tem mais alunos do que o limite do plano grátis — escolha um plano pago." }, 400);
      }
    }

    const { error: updateError } = await svc
      .from("trainers")
      .update({ status_assinatura: "ativo", plano_id: planoGratis.id })
      .eq("id", user.id);
    if (updateError) return jsonResponse({ error: updateError.message }, 500);

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("[ativar-plano-gratis] falhou:", err);
    return jsonResponse({ error: "Erro ao ativar plano grátis." }, 500);
  }
});
