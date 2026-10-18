// POST /functions/v1/importar-treino-ia   { importacao_id }
//
// Lê a ficha de treino (PDF e/ou imagens já enviados pro bucket privado
// importacoes-treino) com a OpenAI e grava em importacoes_treino.resultado
// uma prévia ESTRUTURADA e validada — nunca um treino. O treino só é criado
// quando o profissional revisa e confirma (rpc confirmar_importacao_treino).
//
// A leitura de uma ficha grande pode levar mais de um minuto, então o
// processamento roda em segundo plano (EdgeRuntime.waitUntil) e a página
// acompanha o status da linha em importacoes_treino.
//
// Tudo é lido com o JWT de quem chamou: a RLS garante que o profissional só
// enxerga as próprias importações, os próprios arquivos e o acervo que já
// pode usar. Status, resultado e cota só o servidor grava (service role) — o
// navegador não tem permissão nessas colunas (migration 0064). O limite por
// plano é reservado de forma atômica em reservar_importacao_ia().
// Secret necessária: OPENAI_API_KEY (opcional: OPENAI_MODEL).
//
// Autocontido de propósito (sem ../_shared) pra poder ser publicado também
// pelo editor de Edge Functions do dashboard.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1.0.10/base64";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

// Responses API (https://api.openai.com/v1/responses). gpt-6.1-sol = desempenho
// próximo do flagship (gpt-6-astra) com custo bem menor; troca sem deploy
// pela secret OPENAI_MODEL.
const MODELO_PADRAO = "gpt-6.1-sol";
const OPENAI_URL = "https://api.openai.com/v1/responses";
const TIMEOUT_IA_MS = 380 * 1000; // abaixo do limite de tempo das Edge Functions
const MAX_ARQUIVOS = 6;
const MAX_BYTES_ARQUIVO = 20 * 1024 * 1024;
const MAX_BYTES_TOTAL = 20 * 1024 * 1024;
const TIPOS_ACEITOS = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

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

type Arquivo = { path: string; nome: string; tipo: string; tamanho: number; sha256?: string };
type ItemCatalogo = { ref: string; id: string; nome: string; categoria: string | null };

// ---------------------------------------------------------------------------
// Formato que o modelo é obrigado a seguir (structured outputs). Campos sem
// informação: texto vazio e número -1 (sem tipos anuláveis no schema; viram
// null em validarResultado). O prompt proíbe preencher o que a ficha não diz.

const SERIE = {
  type: "object",
  additionalProperties: false,
  required: ["series", "repeticoes", "carga", "observacao"],
  properties: {
    series: { type: "integer", description: "Quantidade de séries com esta prescrição. -1 se a ficha não diz." },
    repeticoes: { type: "string", description: "Repetições como escritas: '8-10', '12', 'falha', '30s'. Vazio se ausente." },
    carga: { type: "string", description: "Carga como escrita ('50 kg', '20kg cada lado'). Vazio se ausente." },
    observacao: { type: "string" },
  },
};

const CONFIANCA = { type: "string", enum: ["alta", "media", "baixa", "nenhuma"] };

const EXERCICIO = {
  type: "object",
  additionalProperties: false,
  required: [
    "nome_original", "combo", "tipo_combo", "aquecimento", "validas", "classificacao_series",
    "duvida_classificacao", "descanso_segundos", "descanso_texto", "tecnica_texto_original",
    "tecnica_ref", "tecnica_confianca", "tecnica_detalhes", "exercicio_ref", "exercicio_confianca",
    "exercicio_motivo", "observacoes", "campos_incertos", "contradicoes",
  ],
  properties: {
    nome_original: { type: "string", description: "Nome do exercício exatamente como está na ficha." },
    combo: { type: "string", description: "Rótulo igual para todos os exercícios do mesmo bi-set/superset/tri-set dentro do treino (ex.: 'combo-1'). Vazio se não está agrupado." },
    tipo_combo: { type: "string", description: "Como a ficha chama o agrupamento: 'Bi-set', 'Superset', 'Tri-set'..." },
    aquecimento: { type: "array", items: SERIE, description: "Séries de aquecimento/preparatórias/warm-up. Vazio se a ficha não indica aquecimento." },
    validas: { type: "array", items: SERIE, description: "Séries válidas/de trabalho/working sets, ou a prescrição sem classificação." },
    classificacao_series: { type: "string", enum: ["explicita", "sem_classificacao", "ambigua"] },
    duvida_classificacao: { type: "string", description: "Se ambígua: as duas interpretações possíveis." },
    descanso_segundos: { type: "integer", description: "Descanso ENTRE séries em segundos. Nunca a pausa intrassérie." },
    descanso_texto: { type: "string", description: "Descanso como escrito na ficha." },
    tecnica_texto_original: { type: "string", description: "Técnica avançada/variação como escrita na ficha." },
    tecnica_ref: { type: "string", description: "Código T# do acervo de técnicas, só se houver correspondência." },
    tecnica_confianca: CONFIANCA,
    tecnica_detalhes: { type: "string", description: "Parâmetros da técnica: distribuição de reps do cluster, pausa intrassérie, duração do pico de contração, cadência etc." },
    exercicio_ref: { type: "string", description: "Código E# do acervo correspondente ao movimento, ou vazio." },
    exercicio_confianca: CONFIANCA,
    exercicio_motivo: { type: "string", description: "Por que o E# corresponde (ou por que há dúvida)." },
    observacoes: { type: "string", description: "Instruções do profissional para este exercício." },
    campos_incertos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["campo", "motivo"],
        properties: {
          campo: { type: "string", enum: ["exercicio", "series", "repeticoes", "carga", "descanso", "tecnica", "combo", "observacoes"] },
          motivo: { type: "string" },
        },
      },
    },
    contradicoes: { type: "array", items: { type: "string" } },
  },
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["divisoes", "exercicios_sem_divisao", "paginas_com_problema", "avisos_gerais", "legibilidade"],
  properties: {
    divisoes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["nome", "observacoes", "exercicios"],
        properties: {
          nome: { type: "string", description: "Nome da divisão como na ficha ('Treino A', 'Superiores')." },
          observacoes: { type: "string" },
          exercicios: { type: "array", items: EXERCICIO },
        },
      },
    },
    exercicios_sem_divisao: {
      type: "array",
      description: "Exercícios cuja divisão a ficha não deixa clara. Nunca atribua por palpite.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["motivo", "exercicio"],
        properties: {
          motivo: { type: "string", description: "Por que não dá para saber a qual treino pertence." },
          exercicio: EXERCICIO,
        },
      },
    },
    paginas_com_problema: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["arquivo", "pagina", "motivo"],
        properties: {
          arquivo: { type: "integer", description: "Número do arquivo (1, 2...)." },
          pagina: { type: "integer" },
          motivo: { type: "string" },
        },
      },
    },
    avisos_gerais: { type: "array", items: { type: "string" } },
    legibilidade: { type: "string", enum: ["boa", "parcial", "ilegivel"] },
  },
};

const SYSTEM = `Você converte fichas de treino de musculação (PDF, foto de ficha impressa, print de app) em dados estruturados para o app Elo Fitness. O personal trainer vai revisar tudo antes de salvar, então o mais importante é fidelidade: o que estiver na ficha deve aparecer, e o que não estiver não pode ser inventado.

Como ler a ficha:
- Analise o documento inteiro (todas as páginas e arquivos) antes de responder. Fichas costumam ter séries, repetições, descanso e técnicas em colunas ou linhas separadas: associe cada dado ao exercício certo pela estrutura visual, não linha a linha.
- Divisões: identifique cada treino pelos títulos, cabeçalhos, páginas e pela estrutura do documento. A quantidade é a que a ficha tiver (2, 3, 5, 7...). Preserve o nome original de cada divisão ("Treino A", "Treino 1", "Superior", "Peito e tríceps", "Pernas"...), a ordem das divisões, a ordem dos exercícios e a ordem das séries. Se a ficha inteira não tiver divisão, use uma única divisão com o nome que a ficha der (ou "Treino A").
- Exercício que você não consegue associar com segurança a uma divisão (sem cabeçalho, página solta, lista ambígua): coloque em exercicios_sem_divisao com o motivo, em vez de escolher uma divisão por palpite.
- Séries de aquecimento (aquecimento, preparatórias, warm-up, aproximação...) vão em "aquecimento"; séries válidas (válidas, de trabalho, efetivas, working sets, work sets, WS...) vão em "validas". Use o contexto e os cabeçalhos da ficha, não só essas palavras.
- Prescrição sem classificação ("4 x 10"): registre em "validas" com classificacao_series "sem_classificacao" e não crie aquecimento. Só use "ambigua" quando houver de fato duas leituras plausíveis, e descreva-as em duvida_classificacao.
- Séries com cargas ou repetições diferentes (aquecimento progressivo, pirâmide) viram itens separados, preservando a ordem; não reduza a uma prescrição genérica.
- Descanso entre séries vai em descanso_segundos/descanso_texto. Pausa intrassérie (cluster, rest-pause) é parâmetro da técnica e vai em tecnica_detalhes, nunca no descanso.
- Técnicas (cluster set, pico de contração, drop set, rest-pause, myo-reps, parciais, forçadas, cadência, isometria, excêntrica controlada...): copie o texto em tecnica_texto_original e os parâmetros em tecnica_detalhes. Não confunda uma técnica com outra (pico de contração não é drop set). Não invente técnica que a ficha não descreve.
- Bi-set, superset, tri-set: dê o mesmo rótulo "combo" a todos os exercícios do grupo, na ordem de execução, e copie o nome do agrupamento em tipo_combo.
- Instruções do profissional vão em observacoes do exercício ou da divisão a que pertencem.

Campos sem informação: texto vazio "" e número -1.

Correspondência com o acervo (listas abaixo):
- exercicio_ref: escolha o E# que corresponde ao MESMO movimento, considerando equipamento, pegada, posição, grupo muscular e variação — não apenas nomes parecidos. "alta" só quando o movimento é inequivocamente o mesmo; "media" quando é provável mas há diferença ou falta detalhe; "baixa" quando é só um palpite; "nenhuma" com exercicio_ref "" quando nada no acervo corresponde.
- tecnica_ref: mesmo critério com os T#. Sem correspondência adequada, tecnica_ref "" e confiança "nenhuma" (o texto original fica preservado).

Incerteza:
- Campo ausente ou ilegível: deixe vazio e registre em campos_incertos com o motivo. Não descarte o restante por causa de um campo.
- Informação contraditória (ex.: "3 séries" no cabeçalho e 4 linhas de série): registre em contradicoes, sem escolher uma das versões em silêncio.
- Páginas ou arquivos ilegíveis ou que não são ficha de treino: liste em paginas_com_problema.`;

// ---------------------------------------------------------------------------

function str(v: unknown, max = 500): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

function int(v: unknown, min: number, max: number): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

const CONFIANCAS = ["alta", "media", "baixa", "nenhuma"];
const CAMPOS_INCERTOS = ["exercicio", "series", "repeticoes", "carga", "descanso", "tecnica", "combo", "observacoes"];

// A resposta do modelo nunca vai direto pro banco: tudo é revalidado aqui
// (tipos, tamanhos, e se os E#/T# existem mesmo no acervo deste profissional).
function validarResultado(bruto: unknown, exercicios: Map<string, ItemCatalogo>, tecnicas: Map<string, ItemCatalogo>) {
  const r = (bruto && typeof bruto === "object") ? bruto as Record<string, unknown> : {};
  const series = (lista: unknown) => arr(lista).slice(0, 30).map((s) => {
    const o = (s || {}) as Record<string, unknown>;
    return {
      series: int(o.series, 1, 30),
      repeticoes: str(o.repeticoes, 60),
      carga: str(o.carga, 60),
      observacao: str(o.observacao, 200),
    };
  });

  // prefixoCombo: o mesmo "combo-1" em treinos diferentes nunca vira o mesmo grupo.
  const exercicio = (e: unknown, prefixoCombo: string) => {
    const o = (e || {}) as Record<string, unknown>;
    const incertos = arr(o.campos_incertos).slice(0, 20).map((c) => {
      const x = (c || {}) as Record<string, unknown>;
      return { campo: CAMPOS_INCERTOS.includes(x.campo as string) ? x.campo as string : "observacoes", motivo: str(x.motivo, 300) || "" };
    });

    let exRef = str(o.exercicio_ref, 12);
    let exConf = CONFIANCAS.includes(o.exercicio_confianca as string) ? o.exercicio_confianca as string : "nenhuma";
    const exItem = exRef ? exercicios.get(exRef) : undefined;
    if (exRef && !exItem) {
      exRef = null;
      exConf = "nenhuma";
    }
    if (!exRef) exConf = "nenhuma";

    let tecRef = str(o.tecnica_ref, 12);
    let tecConf = CONFIANCAS.includes(o.tecnica_confianca as string) ? o.tecnica_confianca as string : "nenhuma";
    const tecItem = tecRef ? tecnicas.get(tecRef) : undefined;
    if (tecRef && !tecItem) {
      tecRef = null;
      tecConf = "nenhuma";
    }
    if (!tecRef) tecConf = "nenhuma";

    return {
      nome_original: str(o.nome_original, 160) || "(nome não identificado)",
      combo: str(o.combo, 40) ? `${prefixoCombo}:${str(o.combo, 40)}` : null,
      tipo_combo: str(o.tipo_combo, 60),
      aquecimento: series(o.aquecimento),
      validas: series(o.validas),
      classificacao_series: ["explicita", "sem_classificacao", "ambigua"].includes(o.classificacao_series as string) ? o.classificacao_series as string : "sem_classificacao",
      duvida_classificacao: str(o.duvida_classificacao, 400),
      descanso_segundos: int(o.descanso_segundos, 0, 1800),
      descanso_texto: str(o.descanso_texto, 80),
      tecnica_texto_original: str(o.tecnica_texto_original, 300),
      tecnica_id: tecItem ? tecItem.id : null,
      tecnica_nome: tecItem ? tecItem.nome : null,
      tecnica_confianca: tecConf,
      tecnica_detalhes: str(o.tecnica_detalhes, 400),
      exercicio_id: exItem ? exItem.id : null,
      exercicio_nome: exItem ? exItem.nome : null,
      exercicio_confianca: exConf,
      exercicio_motivo: str(o.exercicio_motivo, 300),
      observacoes: str(o.observacoes, 500),
      campos_incertos: incertos,
      contradicoes: arr(o.contradicoes).map((c) => str(c, 300)).filter(Boolean),
    };
  };

  const divisoes = arr(r.divisoes).slice(0, 20).map((d, di) => {
    const dv = (d || {}) as Record<string, unknown>;
    const exs = arr(dv.exercicios).slice(0, 60).map((e) => exercicio(e, String(di)));
    return { nome: str(dv.nome, 120) || `Treino ${String.fromCharCode(65 + di)}`, observacoes: str(dv.observacoes, 500), exercicios: exs };
  });

  const exercicios_sem_divisao = arr(r.exercicios_sem_divisao).slice(0, 60).map((x) => {
    const o = (x || {}) as Record<string, unknown>;
    return { motivo: str(o.motivo, 300) || "", exercicio: exercicio(o.exercicio, "sem") };
  });

  return {
    divisoes,
    exercicios_sem_divisao,
    paginas_com_problema: arr(r.paginas_com_problema).slice(0, 50).map((p) => {
      const o = (p || {}) as Record<string, unknown>;
      return { arquivo: int(o.arquivo, 1, 99), pagina: int(o.pagina, 1, 9999), motivo: str(o.motivo, 300) || "" };
    }),
    avisos_gerais: arr(r.avisos_gerais).map((a) => str(a, 400)).filter(Boolean),
    legibilidade: ["boa", "parcial", "ilegivel"].includes(r.legibilidade as string) ? r.legibilidade : "parcial",
  };
}

async function carregarCatalogos(db: SupabaseClient, trainerId: string) {
  const { data: exs, error: e1 } = await db.from("exercicios")
    .select("id, nome, categoria")
    .or(`is_global.eq.true,trainer_id.eq.${trainerId}`)
    .order("nome");
  if (e1) throw new Error("Falha ao carregar o acervo de exercícios.");
  // Mesmo nome/grupo que o profissional vê no app (personalizações, migration 0063).
  const { data: pers } = await db.from("exercicio_personalizacoes")
    .select("exercicio_id, nome, categoria")
    .eq("trainer_id", trainerId);
  const persMap = new Map((pers || []).map((p) => [p.exercicio_id, p]));

  const exercicios = new Map<string, ItemCatalogo>();
  (exs || []).forEach((e, i) => {
    const p = persMap.get(e.id);
    const ref = `E${i + 1}`;
    exercicios.set(ref, { ref, id: e.id, nome: (p && p.nome) || e.nome, categoria: (p && p.categoria) || e.categoria });
  });

  const { data: tecs, error: e2 } = await db.from("tecnicas_avancadas")
    .select("id, nome, observacao")
    .or(`is_global.eq.true,trainer_id.eq.${trainerId}`)
    .order("created_at");
  if (e2) throw new Error("Falha ao carregar o acervo de técnicas.");
  const tecnicas = new Map<string, ItemCatalogo>();
  (tecs || []).forEach((t, i) => {
    const ref = `T${i + 1}`;
    tecnicas.set(ref, { ref, id: t.id, nome: t.nome, categoria: str(t.observacao, 200) });
  });
  return { exercicios, tecnicas };
}

async function processar(db: SupabaseClient, svc: SupabaseClient, importacaoId: string, trainerId: string, arquivos: Arquivo[]) {
  const falhar = async (mensagem: string) => {
    await svc.from("importacoes_treino")
      .update({ status: "erro", erro: mensagem, processando_desde: null, updated_at: new Date().toISOString() })
      .eq("id", importacaoId);
  };

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return await falhar("A integração de IA não está configurada no servidor.");

    const content: Record<string, unknown>[] = [];
    let total = 0;
    for (let i = 0; i < arquivos.length; i++) {
      const a = arquivos[i];
      const { data: blob, error } = await db.storage.from("importacoes-treino").download(a.path);
      if (error || !blob) return await falhar(`Não foi possível ler o arquivo "${a.nome}". Envie novamente.`);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      total += bytes.length;
      if (bytes.length > MAX_BYTES_ARQUIVO || total > MAX_BYTES_TOTAL) {
        return await falhar("Os arquivos ultrapassam o tamanho máximo permitido (20 MB no total).");
      }
      const data = encodeBase64(bytes);
      content.push({ type: "input_text", text: `Arquivo ${i + 1}: ${a.nome}` });
      if (a.tipo === "application/pdf") {
        content.push({ type: "input_file", filename: a.nome, file_data: `data:application/pdf;base64,${data}` });
      } else {
        content.push({ type: "input_image", image_url: `data:${a.tipo};base64,${data}`, detail: "high" });
      }
    }

    const { exercicios, tecnicas } = await carregarCatalogos(db, trainerId);
    const listaEx = [...exercicios.values()].map((e) => `${e.ref} | ${e.nome}${e.categoria ? ` | ${e.categoria}` : ""}`).join("\n");
    const listaTec = [...tecnicas.values()].map((t) => `${t.ref} | ${t.nome}${t.categoria ? ` | ${t.categoria}` : ""}`).join("\n");
    content.push({
      type: "input_text",
      text: `Acervo de exercícios do profissional (código | nome | grupo muscular):\n${listaEx || "(vazio)"}\n\n` +
        `Acervo de técnicas avançadas (código | nome | descrição):\n${listaTec || "(vazio)"}\n\n` +
        `Converta a ficha de treino ${arquivos.length > 1 ? "dos arquivos acima (considere todos juntos, na ordem)" : "do arquivo acima"} no formato pedido.`,
    });

    const http = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_IA_MS),
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_MODEL") || MODELO_PADRAO,
        reasoning: { effort: "medium" },
        max_output_tokens: 48000,
        text: { format: { type: "json_schema", name: "ficha_treino", schema: SCHEMA, strict: true } },
        input: [
          { role: "system", content: SYSTEM },
          { role: "user", content },
        ],
      }),
    });
    if (!http.ok) {
      // Só status e tipo do erro no log — nunca o corpo do request (ficha) nem a chave.
      const corpoErro = await http.json().catch(() => ({}));
      console.error("[importar-treino-ia] OpenAI", http.status, corpoErro?.error?.type || "", corpoErro?.error?.code || "");
      return await falhar(
        http.status === 429 ? "O serviço de IA está ocupado ou sem créditos no momento. Tente novamente em alguns minutos."
        : http.status === 401 || http.status === 403 ? "A integração de IA não está configurada corretamente no servidor."
        : http.status === 400 ? "O documento não pôde ser processado (formato, tamanho ou número de páginas). Tente outro arquivo."
        : "Falha ao processar a ficha. Tente novamente.",
      );
    }
    const resposta = await http.json();
    if (resposta.status === "incomplete") {
      return await falhar(resposta.incomplete_details?.reason === "max_output_tokens"
        ? "A ficha é grande demais para uma única importação. Envie as divisões em partes."
        : "A IA não conseguiu concluir a leitura deste documento. Tente outro arquivo.");
    }
    const partes = arr(resposta.output)
      .filter((o) => (o as Record<string, unknown>)?.type === "message")
      .flatMap((o) => arr((o as Record<string, unknown>).content)) as Record<string, unknown>[];
    if (partes.some((p) => p.type === "refusal")) {
      return await falhar("A IA não conseguiu processar este documento. Tente outro arquivo ou monte o treino manualmente.");
    }
    const texto = partes.filter((p) => p.type === "output_text").map((p) => String(p.text || "")).join("");
    let bruto: unknown;
    try {
      bruto = JSON.parse(texto);
    } catch {
      return await falhar("A resposta da IA veio em formato inválido. Tente novamente.");
    }

    const resultado = validarResultado(bruto, exercicios, tecnicas);
    const totalExercicios = resultado.divisoes.reduce((n, d) => n + d.exercicios.length, 0) + resultado.exercicios_sem_divisao.length;
    if (!totalExercicios) {
      return await falhar(resultado.legibilidade === "ilegivel"
        ? "Não foi possível ler a ficha. Envie um arquivo mais nítido ou com melhor resolução."
        : "Nenhum exercício foi identificado nos arquivos enviados.");
    }

    const agora = new Date().toISOString();
    await svc.from("importacoes_treino")
      .update({ status: "concluido", resultado, erro: null, processando_desde: null, cota_consumida_em: agora, updated_at: agora })
      .eq("id", importacaoId);
  } catch (err) {
    // Só a mensagem: nunca o request (tem a chave) nem o conteúdo da ficha.
    console.error("[importar-treino-ia] falha:", err instanceof Error ? err.message : String(err));
    const tempoEsgotado = err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError");
    await falhar(tempoEsgotado
      ? "A leitura demorou mais do que o permitido. Envie a ficha em partes menores."
      : "Falha ao processar a ficha. Tente novamente.");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
  );
  const { data: { user } } = await db.auth.getUser();
  if (!user) return json({ error: "Não autenticado." }, 401);

  const body = await req.json().catch(() => ({}));
  const importacaoId = typeof body.importacao_id === "string" ? body.importacao_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(importacaoId)) return json({ error: "Importação inválida." }, 400);

  // RLS: só devolve se for do profissional logado.
  const { data: imp } = await db.from("importacoes_treino")
    .select("id, trainer_id, cliente_id, status, arquivos, processando_desde")
    .eq("id", importacaoId)
    .maybeSingle();
  if (!imp || imp.trainer_id !== user.id) return json({ error: "Importação não encontrada." }, 404);

  const { data: cliente } = await db.from("clientes").select("id").eq("id", imp.cliente_id).eq("trainer_id", user.id).maybeSingle();
  if (!cliente) return json({ error: "Este aluno não pertence ao profissional." }, 403);

  const arquivos = arr(imp.arquivos) as Arquivo[];
  const prefixo = `${user.id}/${imp.id}/`;
  if (!arquivos.length || arquivos.length > MAX_ARQUIVOS) return json({ error: `Envie de 1 a ${MAX_ARQUIVOS} arquivos.` }, 400);
  for (const a of arquivos) {
    if (!a || typeof a.path !== "string" || !a.path.startsWith(prefixo) || a.path.includes("..")) return json({ error: "Arquivo inválido." }, 400);
    if (!TIPOS_ACEITOS.includes(a.tipo)) return json({ error: `Formato não permitido: ${a.nome}. Use PDF, JPG, PNG ou WEBP.` }, 400);
    if (typeof a.tamanho !== "number" || a.tamanho > MAX_BYTES_ARQUIVO) return json({ error: `Arquivo grande demais: ${a.nome} (máx. 20 MB).` }, 400);
  }

  // Reserva atômica no banco: limite do plano, uma leitura por vez e
  // cliques repetidos / abas duplicadas não disparam duas leituras.
  const { data: reserva, error: erroReserva } = await db.rpc("reservar_importacao_ia", { p_importacao_id: imp.id });
  if (erroReserva) {
    return json({ error: erroReserva.message || "Não foi possível iniciar a leitura." }, erroReserva.code === "P0429" ? 429 : 400);
  }
  if (!reserva || !reserva.reservada) return json({ status: reserva ? reserva.status : imp.status });

  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  EdgeRuntime.waitUntil(processar(db, svc, imp.id, user.id, arquivos));
  return json({ status: "processando" }, 202);
});
