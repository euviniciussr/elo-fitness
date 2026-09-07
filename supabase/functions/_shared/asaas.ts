// Cliente HTTP pro Asaas — usado por asaas-checkout e asaas-webhook.
// Trocar sandbox->produção é só `supabase secrets set ASAAS_API_URL=...
// ASAAS_API_KEY=...`, sem deploy de código.

const ASAAS_API_URL = Deno.env.get("ASAAS_API_URL") || "https://api-sandbox.asaas.com/v3";
const ASAAS_API_KEY = Deno.env.get("ASAAS_API_KEY")!;

export async function asaasFetch(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${ASAAS_API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      access_token: ASAAS_API_KEY,
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Asaas ${path} falhou (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}
