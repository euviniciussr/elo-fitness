// POST /functions/v1/enviar-email
// E-mails transacionais do app via Resend (domínio elofitness.com.br,
// remetente contato@). Dois tipos:
//
// { tipo: "convite", convite_id } — o personal manda o convite de cadastro
//   pro e-mail do aluno. O convite é lido com o JWT de quem chamou (RLS:
//   trainer só enxerga os próprios convites) e o link é montado AQUI, nunca
//   vindo do browser — senão qualquer um usaria o nosso domínio pra mandar
//   link arbitrário.
//
// { tipo: "boas_vindas" } — chamado logo após o cadastro (convite.html pro
//   aluno, login.html pro personal). Vai sempre pro e-mail da própria conta
//   de quem chamou e só uma vez por conta (marca app_metadata.boas_vindas_em
//   com a service role — o usuário não consegue editar app_metadata).
//
// Autocontido de propósito (sem ../_shared) pra poder ser publicado também
// pelo editor de Edge Functions do dashboard.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APP_URL = "https://app.elofitness.com.br";
const REMETENTE = "Elo Fitness <contato@elofitness.com.br>";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Mesmo slug de alunos.html (slugTrainer): primeiro nome, sem acento.
function slugTrainer(nome: string): string {
  const primeiro = (nome || "").trim().split(/\s+/)[0] || "";
  const limpo = primeiro.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return limpo || "personal";
}

function primeiroNome(nome: string): string {
  return (nome || "").trim().split(/\s+/)[0] || "";
}

function layout(titulo: string, corpo: string, botao?: { texto: string; url: string }): string {
  const cta = botao
    ? `<tr><td style="padding:8px 32px 28px;"><a href="${esc(botao.url)}" style="display:inline-block;background:#f97316;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 26px;border-radius:10px;">${esc(botao.texto)}</a></td></tr>
       <tr><td style="padding:0 32px 28px;font-size:12px;color:#6b7280;line-height:1.5;">Se o botão não funcionar, copie e cole este link no navegador:<br><a href="${esc(botao.url)}" style="color:#ea580c;word-break:break-all;">${esc(botao.url)}</a></td></tr>`
    : "";
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td style="background:#0a0d13;padding:20px 32px;font-size:20px;font-weight:800;color:#ffffff;">Elo <span style="color:#f97316;">Fitness</span></td></tr>
<tr><td style="padding:28px 32px 8px;font-size:20px;font-weight:800;color:#111827;">${esc(titulo)}</td></tr>
<tr><td style="padding:8px 32px 16px;font-size:15px;color:#374151;line-height:1.6;">${corpo}</td></tr>
${cta}
</table>
<div style="font-size:11px;color:#9ca3af;padding:16px;">Elo Fitness · app.elofitness.com.br</div>
</td></tr></table></body></html>`;
}

async function enviarResend(to: string, subject: string, html: string): Promise<{ ok: boolean; erro?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { ok: false, erro: "RESEND_API_KEY não configurada." };
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: REMETENTE, to: [to], subject, html }),
  });
  if (!resp.ok) return { ok: false, erro: `Resend ${resp.status}: ${await resp.text()}` };
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: "Não autenticado." }, 401);

    const body = await req.json().catch(() => ({}));

    if (body.tipo === "convite") {
      if (!body.convite_id) return json({ error: "convite_id obrigatório." }, 400);
      // RLS de convites: só o trainer dono enxerga — convite de outro
      // profissional volta vazio aqui.
      const { data: convite } = await caller
        .from("convites")
        .select("id, email, token, status, trainer_id")
        .eq("id", body.convite_id)
        .eq("trainer_id", user.id)
        .maybeSingle();
      if (!convite) return json({ error: "Convite não encontrado." }, 404);
      if (convite.status !== "pendente") return json({ error: "Esse convite já foi usado." }, 400);

      const { data: trainer } = await caller.from("trainers").select("nome").eq("id", user.id).maybeSingle();
      const nomeTrainer = (trainer?.nome || "").trim() || "Seu personal";
      const link = `${APP_URL}/c/${slugTrainer(nomeTrainer)}/${convite.token}`;

      const html = layout(
        `${nomeTrainer} convidou você para o Elo Fitness`,
        `Olá!<br><br><strong>${esc(nomeTrainer)}</strong> quer acompanhar seus treinos, sua dieta e sua evolução pelo Elo Fitness.<br><br>Clique no botão abaixo para criar sua senha e acessar sua conta. Leva menos de um minuto.`,
        { texto: "Criar minha conta", url: link },
      );
      const r = await enviarResend(convite.email, `${nomeTrainer} convidou você para o Elo Fitness`, html);
      if (!r.ok) return json({ error: r.erro }, 502);
      return json({ ok: true, enviado_para: convite.email });
    }

    if (body.tipo === "boas_vindas") {
      if (!user.email) return json({ ok: true, ignorado: "sem e-mail" });
      if (user.app_metadata?.boas_vindas_em) return json({ ok: true, ignorado: "já enviado" });

      const { data: trainer } = await svc.from("trainers").select("id, nome").eq("id", user.id).maybeSingle();
      const nome = primeiroNome(user.user_metadata?.nome || trainer?.nome || "");
      const saudacao = nome ? `Olá, ${esc(nome)}!` : "Olá!";

      let html: string;
      let assunto: string;
      if (trainer) {
        assunto = "Bem-vindo ao Elo Fitness";
        html = layout(
          "Sua conta de personal está pronta",
          `${saudacao}<br><br>Sua conta no Elo Fitness foi criada. Agora você pode cadastrar alunos, montar treinos e dietas e acompanhar a evolução de cada um em um só lugar.<br><br>Para começar, convide seu primeiro aluno pela aba <strong>Alunos</strong>.`,
          { texto: "Acessar o Elo Fitness", url: `${APP_URL}/login.html` },
        );
      } else {
        const { data: cliente } = await svc
          .from("clientes").select("trainer_id").eq("auth_user_id", user.id)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        let nomeTrainer = "";
        if (cliente?.trainer_id) {
          const { data: t } = await svc.from("trainers").select("nome").eq("id", cliente.trainer_id).maybeSingle();
          nomeTrainer = (t?.nome || "").trim();
        }
        assunto = "Bem-vindo ao Elo Fitness";
        html = layout(
          "Seu cadastro foi concluído",
          `${saudacao}<br><br>Sua conta no Elo Fitness foi criada${nomeTrainer ? ` e já está vinculada a <strong>${esc(nomeTrainer)}</strong>` : ""}.<br><br>No app você acompanha seu treino, sua dieta e sua evolução. Se for seu primeiro acesso, comece respondendo a anamnese.<br><br>Para entrar depois, use este e-mail (<strong>${esc(user.email)}</strong>) e a senha que você criou.`,
          { texto: "Abrir o Elo Fitness", url: `${APP_URL}/login.html` },
        );
      }

      const r = await enviarResend(user.email, assunto, html);
      if (!r.ok) return json({ error: r.erro }, 502);

      await svc.auth.admin.updateUserById(user.id, {
        app_metadata: { ...(user.app_metadata || {}), boas_vindas_em: new Date().toISOString() },
      });
      return json({ ok: true, enviado_para: user.email });
    }

    return json({ error: "tipo inválido." }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
