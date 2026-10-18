import { prisma } from "@socialpilot/db";
import { decryptJson, encryptJson, hint, SetupRequiredError } from "@socialpilot/core";
import { AI_PROVIDER_CATALOG, DATA_PROVIDER_CATALOG, INTEGRATION_CATALOG, type IntegrationProvider } from "@socialpilot/shared";

type Secret = { apiKey?: string; clientId?: string; clientSecret?: string; accountId?: string; baseUrl?: string };

const keyOptional = (provider: string) => !!(AI_PROVIDER_CATALOG as Record<string, { keyOptional?: boolean }>)[provider]?.keyOptional;

/** Env var names for each credential provider id. */
function envFor(provider: string): Secret {
  if (provider in AI_PROVIDER_CATALOG) {
    const entry = AI_PROVIDER_CATALOG[provider as keyof typeof AI_PROVIDER_CATALOG];
    const out: Secret = { apiKey: process.env[entry.envVar] };
    for (const f of entry.extraFields ?? []) if (process.env[f.envVar]) out[f.key] = process.env[f.envVar];
    return out;
  }
  if (provider in DATA_PROVIDER_CATALOG) return { apiKey: process.env[DATA_PROVIDER_CATALOG[provider as keyof typeof DATA_PROVIDER_CATALOG].envVar] };
  if (provider.startsWith("oauth:")) {
    const entry = INTEGRATION_CATALOG[provider.slice(6) as IntegrationProvider];
    const fields = entry?.appCredentialFields ?? [];
    return {
      clientId: process.env[fields.find((f) => f.key === "clientId")?.envVar ?? ""],
      clientSecret: process.env[fields.find((f) => f.key === "clientSecret")?.envVar ?? ""],
    };
  }
  return {};
}

export async function saveCredential(userId: string, provider: string, secret: Secret, label?: string) {
  const display = secret.apiKey ?? secret.clientId ?? "";
  const h = display ? hint(display) : null;
  return prisma.providerCredential.upsert({
    where: { userId_provider: { userId, provider } },
    update: { secretEnc: encryptJson(secret), hint: h, label, status: "untested", lastError: null },
    create: { userId, provider, secretEnc: encryptJson(secret), hint: h, label },
  });
}

/** Resolves a credential: the user's stored (encrypted) value first, then the server environment. */
export async function resolveSecret(userId: string, provider: string): Promise<(Secret & { source: "user" | "env" }) | null> {
  const row = await prisma.providerCredential.findUnique({ where: { userId_provider: { userId, provider } } });
  if (row) {
    const s = decryptJson<Secret>(row.secretEnc);
    if (s) return { ...s, source: "user" };
  }
  const env = envFor(provider);
  if (env.apiKey || (env.clientId && env.clientSecret) || (keyOptional(provider) && env.baseUrl)) return { ...env, source: "env" };
  return null;
}

export async function getApiKey(userId: string, provider: string): Promise<string | null> {
  return (await resolveSecret(userId, provider))?.apiKey ?? null;
}

/** Full credential bundle for AI/media providers (API key + account ID / base URL where needed). */
export async function getProviderCreds(userId: string, provider: string): Promise<{ apiKey: string; accountId?: string; baseUrl?: string } | null> {
  const s = await resolveSecret(userId, provider);
  if (!s) return null;
  // Keyless providers (local Ollama) are "configured" once enabled, even without a key.
  if (!s.apiKey && !keyOptional(provider)) return null;
  return { apiKey: s.apiKey ?? "", accountId: s.accountId, baseUrl: s.baseUrl };
}

export async function requireApiKey(userId: string, provider: string): Promise<string> {
  const key = await getApiKey(userId, provider);
  if (!key) {
    throw new SetupRequiredError(`No API key configured for ${provider}. Add one in Settings → AI providers.`, { kind: "ai_provider", provider, link: "/settings/providers" });
  }
  return key;
}

export async function getAppCredentials(userId: string, provider: IntegrationProvider): Promise<{ clientId: string; clientSecret: string } | null> {
  const s = await resolveSecret(userId, `oauth:${provider}`);
  if (!s?.clientId || !s.clientSecret) return null;
  return { clientId: s.clientId, clientSecret: s.clientSecret };
}

/** Lists which providers are configured, never exposing values. */
export async function credentialStatus(userId: string) {
  const rows = await prisma.providerCredential.findMany({ where: { userId }, select: { provider: true, hint: true, status: true, lastTestedAt: true, lastError: true, label: true, updatedAt: true, secretEnc: true } });
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  const providers = [
    ...Object.keys(AI_PROVIDER_CATALOG),
    ...Object.keys(DATA_PROVIDER_CATALOG),
    ...Object.keys(INTEGRATION_CATALOG)
      .filter((p) => INTEGRATION_CATALOG[p as IntegrationProvider].authType === "oauth2")
      .map((p) => `oauth:${p}`),
  ];
  return providers.map((p) => {
    const row = byProvider.get(p);
    const env = envFor(p);
    const envConfigured = !!(env.apiKey || (env.clientId && env.clientSecret) || (keyOptional(p) && env.baseUrl));
    let extra: Record<string, string | undefined> | null = null;
    if (row && p in AI_PROVIDER_CATALOG) {
      const sec = decryptJson<Secret>(row.secretEnc);
      extra = { accountId: sec?.accountId, baseUrl: sec?.baseUrl };
    }
    return {
      provider: p,
      extra,
      configured: !!row || envConfigured,
      source: row ? "user" : envConfigured ? "env" : null,
      hint: row?.hint ?? null,
      status: row?.status ?? (envConfigured ? "untested" : null),
      lastTestedAt: row?.lastTestedAt ?? null,
      lastError: row?.lastError ?? null,
    };
  });
}
