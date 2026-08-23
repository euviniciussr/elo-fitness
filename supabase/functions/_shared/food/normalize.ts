// Deduplicação e priorização dos resultados combinados (Parte 14).
// Prioridade: 1) alimentos do banco do app já usados/revisados,
// 2) TBCA, 3) FatSecret com marca, 4) FatSecret genérico — mas produtos de
// marcas diferentes NUNCA são fundidos entre si ("Pão francês" genérico é
// um item distinto de "Pão francês Marca X").

import type { NormalizedFood } from "./types.ts";

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizeText(s: string): string {
  return stripAccents(s.toLowerCase().trim()).replace(/\s+/g, " ");
}

// Chave de dedupe: nome normalizado + marca normalizada (marca vazia conta
// como "genérico", que é uma marca diferente de qualquer marca real).
function dedupeKey(food: NormalizedFood): string {
  const brand = food.brandName ? normalizeText(food.brandName) : "__generico__";
  return `${normalizeText(food.nome)}::${brand}`;
}

function priorityScore(food: NormalizedFood): number {
  if (food.source === "APP") return 0;
  if (food.source === "TBCA") return 1;
  if (food.source === "FATSECRET" && food.brandName) return 2;
  return 3; // FATSECRET genérico
}

export function normalizeAndDedupe(results: NormalizedFood[]): NormalizedFood[] {
  const byKey = new Map<string, NormalizedFood>();
  for (const food of results) {
    if (!food.nome || !food.nome.trim()) continue;
    const key = dedupeKey(food);
    const existing = byKey.get(key);
    if (!existing || priorityScore(food) < priorityScore(existing)) {
      byKey.set(key, food);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => {
    const diff = priorityScore(a) - priorityScore(b);
    if (diff !== 0) return diff;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
}
