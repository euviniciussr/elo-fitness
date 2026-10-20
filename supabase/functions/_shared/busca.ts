// Pesquisa inteligente (sem acento, sem maiúsculas, palavras em qualquer
// ordem, palavras de ligação opcionais). Mesma regra de js/busca-inteligente.js
// e de public.normalizar_busca (migration 0067) — mudou aqui, mude lá também.

const LIGACAO = new Set(["a", "o", "as", "os", "e", "de", "da", "do", "das", "dos", "no", "na", "nos", "nas", "em", "com", "ao", "aos", "para", "por"]);

export function normalizar(s: string | null | undefined): string {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function termos(q: string): string[] {
  const todas = normalizar(q).split(" ").filter(Boolean);
  const relevantes = todas.filter((w) => !LIGACAO.has(w));
  return relevantes.length ? relevantes : todas;
}

// Plural simples: "joelhos" também acha "joelho".
function radical(t: string): string {
  return t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t;
}

// Menor = mais relevante; null = não combina (algum termo não é começo de
// nenhuma palavra do nome).
export function pontuar(texto: string | null | undefined, ts: string[]): number | null {
  if (!ts.length) return 0;
  const nome = normalizar(texto);
  const palavras = nome.split(" ");
  let soma = 0;
  for (const t of ts) {
    const r = radical(t);
    const i = palavras.findIndex((p) => p.startsWith(r));
    if (i < 0) return null;
    soma += i + (palavras[i] === t ? 0 : 0.5);
  }
  const frase = ts.join(" ");
  const bonusFrase = nome === frase ? -100 : nome.startsWith(frase) ? -50 : nome.includes(frase) ? -2 : 0;
  // Nome que começa pelo primeiro termo ("Leite, de vaca" numa busca por leite) vem antes.
  const bonusInicio = palavras[0].startsWith(radical(ts[0])) ? -3 : 0;
  return bonusFrase + bonusInicio + soma + palavras.length * 0.1;
}

// Filtra e ordena por relevância, mantendo a ordem original no empate.
export function filtrar<T>(lista: T[], ts: string[], getTexto: (x: T) => string): T[] {
  return lista
    .map((item, i) => ({ item, i, s: pontuar(getTexto(item), ts) }))
    .filter((x) => x.s !== null)
    .sort((a, b) => (a.s as number) - (b.s as number) || a.i - b.i)
    .map((x) => x.item);
}

// Padrões ILIKE pra coluna gerada `busca` (" " + nome normalizado), um por
// termo, todos obrigatórios: "% mamao%" = alguma palavra começa com "mamao".
export function padroesIlike(ts: string[]): string[] {
  return ts.map((t) => `% ${radical(t)}%`);
}
