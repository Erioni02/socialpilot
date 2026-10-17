import { DEFAULT_BASE_URLS, DEFAULT_MODELS, PROVIDER_NAMES } from "@sp/ai";
import { lastFour, sealJson } from "@sp/crypto";
import { prisma, type AiProviderConfig } from "@sp/db";
import { normalizeSiteUrl } from "@sp/shared";
import { testProviderConfig } from "@sp/tools";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { authOf } from "../auth/guard";
import { notFound } from "../errors";

const baseUrl = z
  .string()
  .max(300)
  .refine((value) => {
    try {
      normalizeSiteUrl(value); // rejects private/loopback/internal hosts
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Use a public https:// API base URL");

const keys = z.array(z.string().trim().min(1).max(500)).max(10);
const models = z.array(z.string().trim().min(1).max(200)).max(10);

const toDTO = (c: AiProviderConfig) => ({
  id: c.id,
  provider: c.provider,
  baseUrl: c.baseUrl,
  keysPreview: c.keysPreview,
  models: c.models,
  order: c.order,
  enabled: c.enabled,
  lastTestAt: c.lastTestAt?.toISOString() ?? null,
  lastTestResult: c.lastTestResult ?? null
});

/** Workspace AI provider keys. Keys are encrypted at rest and never sent back to the browser. */
export const aiProviderRoutes: FastifyPluginAsyncZod = async (app) => {
  const owned = async (workspaceId: string, id: string) => {
    const config = await prisma.aiProviderConfig.findFirst({ where: { id, workspaceId } });
    if (!config) throw notFound("AI provider not found");
    return config;
  };
  const audit = (workspaceId: string, userId: string, action: string, args: object) =>
    prisma.auditLog.create({ data: { workspaceId, actorType: "user", actorId: userId, action, argsRedacted: args, outcome: "succeeded" } });

  app.get("/ai-providers", { schema: { tags: ["ai"] } }, async (request) => {
    const { workspaceId } = authOf(request);
    const rows = await prisma.aiProviderConfig.findMany({ where: { workspaceId }, orderBy: { order: "asc" } });
    return rows.map(toDTO);
  });

  app.get("/ai-providers/catalog", { schema: { tags: ["ai"] } }, async () =>
    PROVIDER_NAMES.map((name) => ({ provider: name, baseUrl: DEFAULT_BASE_URLS[name], models: DEFAULT_MODELS[name] }))
  );

  app.post(
    "/ai-providers",
    {
      schema: {
        tags: ["ai"],
        body: z.object({ provider: z.enum(PROVIDER_NAMES as [string, ...string[]]), baseUrl: baseUrl.optional(), keys: keys.min(1), models: models.optional(), order: z.number().int().min(0).max(100).optional(), enabled: z.boolean().optional() })
      }
    },
    async (request, reply) => {
      const { workspaceId, userId } = authOf(request);
      const body = request.body;
      const provider = body.provider as keyof typeof DEFAULT_BASE_URLS;
      const count = await prisma.aiProviderConfig.count({ where: { workspaceId } });
      const config = await prisma.aiProviderConfig.create({
        data: {
          workspaceId,
          provider,
          baseUrl: body.baseUrl ?? DEFAULT_BASE_URLS[provider],
          encryptedKeys: sealJson(body.keys),
          keysPreview: body.keys.map(lastFour),
          models: body.models?.length ? body.models : DEFAULT_MODELS[provider],
          order: body.order ?? count,
          enabled: body.enabled ?? true
        }
      });
      await audit(workspaceId, userId, "aiProvider.create", { provider, keys: body.keys.length });
      return reply.code(201).send(toDTO(config));
    }
  );

  app.patch(
    "/ai-providers/:id",
    {
      schema: {
        tags: ["ai"],
        params: z.object({ id: z.string() }),
        body: z.object({ baseUrl: baseUrl.optional(), keys: keys.optional(), models: models.optional(), order: z.number().int().min(0).max(100).optional(), enabled: z.boolean().optional() })
      }
    },
    async (request) => {
      const { workspaceId, userId } = authOf(request);
      const config = await owned(workspaceId, request.params.id);
      const { keys: newKeys, models: newModels, ...rest } = request.body;
      const updated = await prisma.aiProviderConfig.update({
        where: { id: config.id },
        data: {
          ...rest,
          ...(newKeys?.length ? { encryptedKeys: sealJson(newKeys), keysPreview: newKeys.map(lastFour) } : {}),
          ...(newModels?.length ? { models: newModels } : {})
        }
      });
      await audit(workspaceId, userId, "aiProvider.update", { id: config.id, keysReplaced: Boolean(newKeys?.length) });
      return toDTO(updated);
    }
  );

  app.delete("/ai-providers/:id", { schema: { tags: ["ai"], params: z.object({ id: z.string() }) } }, async (request, reply) => {
    const { workspaceId, userId } = authOf(request);
    const config = await owned(workspaceId, request.params.id);
    await prisma.aiProviderConfig.delete({ where: { id: config.id } });
    await audit(workspaceId, userId, "aiProvider.delete", { id: config.id, provider: config.provider });
    return reply.code(204).send();
  });

  app.post("/ai-providers/:id/test", { schema: { tags: ["ai"], params: z.object({ id: z.string() }) } }, async (request) => {
    const { workspaceId, userId } = authOf(request);
    await owned(workspaceId, request.params.id);
    const result = await testProviderConfig(workspaceId, request.params.id);
    await audit(workspaceId, userId, "aiProvider.test", { id: request.params.id, ok: result.ok });
    return result;
  });
};
