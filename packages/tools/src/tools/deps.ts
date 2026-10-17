import { chat, providersFromEnv, type ProviderName, type ProviderSpec } from "@sp/ai";
import { openJson } from "@sp/crypto";
import { prisma } from "@sp/db";
import { crawlSite, safeFetch } from "@sp/integrations";

/** AI providers for a workspace: enabled DB configs in order (keys decrypted here only), else env bootstrap. */
export async function loadProviders(workspaceId: string, env: Record<string, string | undefined> = process.env): Promise<ProviderSpec[]> {
  const rows = await prisma.aiProviderConfig.findMany({ where: { workspaceId, enabled: true }, orderBy: { order: "asc" } });
  if (!rows.length) return providersFromEnv(env);
  return rows
    .map((row) => ({
      name: row.provider as ProviderName,
      baseUrl: row.baseUrl,
      keys: openJson<string[]>(row.encryptedKeys),
      models: row.models
    }))
    .filter((p) => p.keys.length && p.models.length);
}

/** External effects the tools depend on — swappable in tests. */
export const deps = { crawl: crawlSite, fetchPage: safeFetch, chat, loadProviders };

export function setToolDeps(overrides: Partial<typeof deps>): void {
  Object.assign(deps, overrides);
}
