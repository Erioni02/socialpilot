import { createFailover, type ProviderName } from "@sp/ai";
import { openJson } from "@sp/crypto";
import { prisma } from "@sp/db";
import { z } from "zod";
import { registerTool } from "../registry";
import { deps } from "./deps";

const TestOutput = z.object({ ok: z.boolean(), model: z.string().optional(), ms: z.number().optional(), error: z.string().optional() });

export type ProviderTestResult = z.infer<typeof TestOutput>;

/** Pings one configured provider (first model) and stores the result. Never throws for provider errors. */
export async function testProviderConfig(workspaceId: string, providerConfigId: string): Promise<ProviderTestResult> {
  const config = await prisma.aiProviderConfig.findFirst({ where: { id: providerConfigId, workspaceId } });
  if (!config) throw new Error("AI provider not found");
  const keys = openJson<string[]>(config.encryptedKeys);
  let result: ProviderTestResult;
  try {
    // Fresh failover client: a test must not be skewed by health remembered from earlier calls.
    const reply = await deps.chat({
      providers: [{ name: config.provider as ProviderName, baseUrl: config.baseUrl, keys, models: config.models.slice(0, 1) }],
      messages: [{ role: "user", content: "Reply with the single word: pong" }],
      client: createFailover(),
      label: "provider.test"
    });
    result = { ok: true, model: reply.model, ms: reply.ms };
  } catch (error) {
    result = { ok: false, error: (error as Error).message };
  }
  await prisma.aiProviderConfig.update({ where: { id: config.id }, data: { lastTestAt: new Date(), lastTestResult: result } });
  return result;
}

export function registerAiTools(): void {
  registerTool({
    name: "ai.testProvider",
    description: "Send a one-line ping through a configured AI provider and record the result.",
    input: z.object({ providerConfigId: z.string() }),
    output: TestOutput,
    capability: "spend.ai",
    minAutonomy: 1,
    approval: "never",
    runMode: "inline",
    userOnly: true,
    run: (ctx, { providerConfigId }) => testProviderConfig(ctx.workspaceId, providerConfigId)
  });
}
