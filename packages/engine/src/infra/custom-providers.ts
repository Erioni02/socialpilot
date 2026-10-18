import net from "node:net";
import { lookup } from "node:dns/promises";
import { prisma } from "@socialpilot/db";
import { allowLocalAiEndpoints, assertPublicUrl, badRequest, decryptJson, encryptJson, hint, isPrivateIp, notFound, providerFetch, SsrfError } from "@socialpilot/core";
import { customProviderId, customProviderSchema, isCustomProvider, type CustomProviderInfo, type CustomProviderInput } from "@socialpilot/shared";

type Stored = CustomProviderInput;

/**
 * Base URLs are user-controlled, so they go through SSRF checks. Local endpoints (Ollama, LM Studio) are allowed
 * only when ALLOW_LOCAL_AI_ENDPOINTS is on (default outside production) — never cloud metadata addresses.
 */
export async function validateBaseUrl(raw: string) {
  const u = new URL(raw);
  if (u.username || u.password) throw badRequest("Put the API key in the key field, not in the URL.");
  try {
    await assertPublicUrl(raw, true);
    if (u.protocol !== "https:") throw badRequest("Use an https:// URL for remote providers.");
    return;
  } catch (e) {
    if (!(e instanceof SsrfError)) throw e;
  }
  if (!allowLocalAiEndpoints) throw badRequest("Local or private-network endpoints are disabled on this server (ALLOW_LOCAL_AI_ENDPOINTS=false).");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (host !== "localhost" && !addrs.length) throw badRequest(`Could not resolve ${host}`);
  for (const a of addrs) {
    if (a.startsWith("169.254.") || a.toLowerCase().startsWith("fe80:")) throw badRequest("Link-local / cloud metadata addresses are not allowed.");
    if (!isPrivateIp(a)) throw badRequest(`Blocked address for ${host}`);
  }
}

async function readStored(userId: string, id: string): Promise<{ row: Awaited<ReturnType<typeof prisma.providerCredential.findUnique>>; data: Stored } | null> {
  if (!isCustomProvider(id)) return null;
  const row = await prisma.providerCredential.findUnique({ where: { userId_provider: { userId, provider: id } } });
  if (!row) return null;
  const data = decryptJson<Stored>(row.secretEnc);
  return data ? { row, data } : null;
}

export async function getCustomProvider(userId: string, id: string): Promise<(Stored & { id: string }) | null> {
  const r = await readStored(userId, id);
  return r ? { ...r.data, id } : null;
}

export async function listCustomProviders(userId: string): Promise<CustomProviderInfo[]> {
  const rows = await prisma.providerCredential.findMany({ where: { userId, provider: { startsWith: "custom:" } }, orderBy: { createdAt: "asc" } });
  const out: CustomProviderInfo[] = [];
  for (const row of rows) {
    const d = decryptJson<Stored>(row.secretEnc);
    if (!d) continue;
    const { apiKey, ...rest } = d;
    out.push({ ...rest, id: row.provider, hasKey: !!apiKey, hint: row.hint, status: row.status, lastTestedAt: row.lastTestedAt?.toISOString() ?? null, lastError: row.lastError });
  }
  return out;
}

export async function saveCustomProvider(userId: string, input: unknown, existingId?: string) {
  const data = customProviderSchema.parse(input);
  await validateBaseUrl(data.baseUrl);
  let id = existingId;
  let apiKey = data.apiKey || undefined;
  if (existingId) {
    const prev = await readStored(userId, existingId);
    if (!prev) throw notFound("Custom provider");
    if (!apiKey) apiKey = prev.data.apiKey; // keep the stored key when the field is left blank
  } else {
    const base = customProviderId(data.name);
    id = base;
    for (let i = 2; await prisma.providerCredential.findUnique({ where: { userId_provider: { userId, provider: id } } }); i++) id = `${base}-${i}`;
  }
  const stored: Stored = { ...data, apiKey };
  await prisma.providerCredential.upsert({
    where: { userId_provider: { userId, provider: id! } },
    update: { secretEnc: encryptJson(stored), hint: apiKey ? hint(apiKey) : null, label: data.name, status: "untested", lastError: null },
    create: { userId, provider: id!, secretEnc: encryptJson(stored), hint: apiKey ? hint(apiKey) : null, label: data.name },
  });
  return id!;
}

/** Lists models from {baseUrl}/models (OpenAI-compatible). */
export async function fetchCustomModels(userId: string, id: string): Promise<string[]> {
  const p = await getCustomProvider(userId, id);
  if (!p) throw notFound("Custom provider");
  await validateBaseUrl(p.baseUrl);
  let r: any;
  try {
    r = await providerFetch<any>(p.name, `${p.baseUrl}/models`, { headers: p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}, timeoutMs: 20000 });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (!status) throw badRequest(`Could not reach ${p.baseUrl} — check the URL, and that the server is running (for local servers like Ollama or LM Studio).`);
    if (status === 401 || status === 403) throw badRequest(`${p.name} rejected the API key (HTTP ${status}).`);
    if (status === 404) throw badRequest(`${p.baseUrl}/models was not found. The provider may not list models — chat can still work; enter model ids manually.`);
    throw e;
  }
  const list = Array.isArray(r) ? r : (r.data ?? r.models ?? []);
  return list.map((m: any) => String(m.id ?? m.name ?? m)).filter(Boolean).sort();
}
