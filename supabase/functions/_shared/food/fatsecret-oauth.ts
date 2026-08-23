// OAuth 2.0 client_credentials pra FatSecret Platform API
// (https://platform.fatsecret.com/docs/guides/authentication/oauth2).
// Credenciais SÓ existem como env var da Edge Function (Parte 25) — nunca
// chegam ao frontend. Token cacheado em memória do isolate (Parte 23):
// evita pedir um token novo a cada chamada dentro da mesma instância
// "quente" da function; se o isolate reiniciar, só pede de novo.

const TOKEN_URL = "https://oauth.fatsecret.com/connect/token";
// "basic" = search/autocomplete/get. "barcode" habilita o find-by-id de
// código de barras (Parte 8) — só é concedido se o plano contratado incluir.
const SCOPE = "basic barcode";

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

export class FatSecretCredentialsMissingError extends Error {
  constructor() {
    super("FATSECRET_CLIENT_ID/FATSECRET_CLIENT_SECRET não configurados.");
    this.name = "FatSecretCredentialsMissingError";
  }
}

export function hasFatSecretCredentials(): boolean {
  return Boolean(Deno.env.get("FATSECRET_CLIENT_ID") && Deno.env.get("FATSECRET_CLIENT_SECRET"));
}

export async function getFatSecretAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.accessToken;
  }

  const clientId = Deno.env.get("FATSECRET_CLIENT_ID");
  const clientSecret = Deno.env.get("FATSECRET_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new FatSecretCredentialsMissingError();

  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPE }),
  });

  if (!res.ok) {
    throw new Error(`FatSecret OAuth falhou (${res.status}): ${await res.text().catch(() => "")}`);
  }

  const json = await res.json() as { access_token: string; expires_in: number };
  cachedToken = { accessToken: json.access_token, expiresAt: now + json.expires_in * 1000 };
  return cachedToken.accessToken;
}
