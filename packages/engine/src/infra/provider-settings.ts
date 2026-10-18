import { prisma, Prisma } from "@socialpilot/db";
import { badRequest } from "@socialpilot/core";
import { providerSettingsSchema, reasoningOptions, type ProviderSettings } from "@socialpilot/shared";

const EMPTY: ProviderSettings = { models: {}, reasoning: {} };

export async function getProviderSettings(userId: string, provider: string): Promise<ProviderSettings> {
  const row = await prisma.providerSetting.findUnique({ where: { userId_provider: { userId, provider } } });
  if (!row) return EMPTY;
  const parsed = providerSettingsSchema.safeParse(row.settings);
  return parsed.success ? parsed.data : EMPTY;
}

export async function listProviderSettings(userId: string): Promise<Record<string, ProviderSettings>> {
  const rows = await prisma.providerSetting.findMany({ where: { userId } });
  return Object.fromEntries(rows.map((r) => [r.provider, providerSettingsSchema.safeParse(r.settings).data ?? EMPTY]));
}

export async function saveProviderSettings(userId: string, provider: string, input: unknown): Promise<ProviderSettings> {
  const data = providerSettingsSchema.parse(input);
  const allowed = reasoningOptions(provider);
  for (const [role, level] of Object.entries(data.reasoning)) {
    if (level && !allowed.includes(level)) throw badRequest(`Reasoning level "${level}" isn't supported for ${provider} (${role}). Options: ${allowed.join(", ")}.`);
  }
  // Drop empty values so "use the default" is stored as absence.
  const clean: ProviderSettings = {
    models: Object.fromEntries(Object.entries(data.models).filter(([, v]) => v && v.trim())) as ProviderSettings["models"],
    reasoning: Object.fromEntries(Object.entries(data.reasoning).filter(([, v]) => v && v !== "default")) as ProviderSettings["reasoning"],
  };
  await prisma.providerSetting.upsert({
    where: { userId_provider: { userId, provider } },
    update: { settings: clean as unknown as Prisma.InputJsonValue },
    create: { userId, provider, settings: clean as unknown as Prisma.InputJsonValue },
  });
  return clean;
}
