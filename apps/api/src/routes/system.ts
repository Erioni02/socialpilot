import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@socialpilot/db";
import { badRequest, config, redactString } from "@socialpilot/core";
import { listNvidiaModels, testProvider } from "@socialpilot/ai";
import { AI_PROVIDER_CATALOG, AGENT_LABELS, AUTONOMY_LABELS, CAPABILITY_REGISTRY, DATA_PROVIDER_CATALOG, INTEGRATION_CATALOG, PERMISSION_LABELS, providerCredentialSchema } from "@socialpilot/shared";
import { audit, credentialStatus, fetchCustomModels, listProviderSettings, saveProviderSettings, ffmpeg, getCustomProvider, listCustomProviders, resolveSecret, saveCredential, saveCustomProvider } from "@socialpilot/engine";
import { CUSTOM_PROVIDER_PRESETS, isCustomProvider } from "@socialpilot/shared";
import { parse, userOf } from "../lib/http";

let ffmpegCache: { at: number; value: Awaited<ReturnType<typeof ffmpeg.ffmpegAvailable>> } | null = null;

export default async function systemRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  });

  app.get("/system/status", { preHandler: app.requireAuth }, async () => {
    if (!ffmpegCache || Date.now() - ffmpegCache.at > 600_000) ffmpegCache = { at: Date.now(), value: await ffmpeg.ffmpegAvailable() };
    const [waiting, active, failed24h] = await Promise.all([
      prisma.job.count({ where: { status: "waiting" } }),
      prisma.job.count({ where: { status: "active" } }),
      prisma.job.count({ where: { status: "failed", updatedAt: { gt: new Date(Date.now() - 86400_000) } } }),
    ]);
    const lastWorkerActivity = await prisma.job.findFirst({ where: { lockedBy: { not: null } }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } });
    return {
      queueDriver: config.REDIS_URL ? "bullmq" : "postgres",
      jobs: { waiting, active, failed24h },
      lastWorkerActivity: lastWorkerActivity?.updatedAt ?? null,
      ffmpeg: ffmpegCache.value,
      publicBaseUrl: config.PUBLIC_BASE_URL ?? null,
      apiPublicUrl: config.API_PUBLIC_URL,
      encryptionKeyConfigured: !!config.ENCRYPTION_KEY,
    };
  });

  /** Static metadata the UI needs: catalogs, capability registry, permission labels. */
  app.get("/meta", async () => ({
    integrations: INTEGRATION_CATALOG,
    aiProviders: AI_PROVIDER_CATALOG,
    dataProviders: DATA_PROVIDER_CATALOG,
    capabilities: CAPABILITY_REGISTRY,
    permissions: PERMISSION_LABELS,
    autonomy: AUTONOMY_LABELS,
    agents: AGENT_LABELS,
    oauthCallbackBase: `${config.API_PUBLIC_URL.replace(/\/$/, "")}/api/oauth`,
  }));

  app.get("/providers", { preHandler: app.requireAuth }, async (req) => ({
    providers: await credentialStatus(userOf(req).id),
    custom: await listCustomProviders(userOf(req).id),
    settings: await listProviderSettings(userOf(req).id),
    presets: CUSTOM_PROVIDER_PRESETS,
  }));

  /** Per-provider model + reasoning preferences (applies to every project using that provider). */
  app.put("/providers/:provider/settings", { preHandler: app.requireAuth }, async (req) => {
    const { provider } = req.params as { provider: string };
    const user = userOf(req);
    const known = provider in AI_PROVIDER_CATALOG || (isCustomProvider(provider) && !!(await getCustomProvider(user.id, provider)));
    if (!known) throw badRequest(`Unknown provider ${provider}`);
    const settings = await saveProviderSettings(user.id, provider, req.body);
    await audit({ userId: user.id, actor: "user", action: "provider_settings.updated", target: provider, details: settings as any, ip: req.ip });
    return { settings };
  });

  // ───── Custom (user-added, OpenAI-compatible) providers ─────
  app.post("/providers/custom", { preHandler: app.requireAuth }, async (req) => {
    const user = userOf(req);
    const id = await saveCustomProvider(user.id, req.body);
    await audit({ userId: user.id, actor: "user", action: "custom_provider.created", target: id, ip: req.ip });
    return { id };
  });
  app.put("/providers/custom/:id", { preHandler: app.requireAuth }, async (req) => {
    const user = userOf(req);
    const { id } = req.params as { id: string };
    if (!isCustomProvider(id)) throw badRequest("Not a custom provider");
    await saveCustomProvider(user.id, req.body, id);
    await audit({ userId: user.id, actor: "user", action: "custom_provider.updated", target: id, ip: req.ip });
    return { id };
  });
  app.get("/providers/custom/:id/models", { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    return { models: await fetchCustomModels(userOf(req).id, id) };
  });

  app.put("/providers/:provider", { preHandler: app.requireAuth }, async (req) => {
    const { provider } = req.params as { provider: string };
    const body = parse(providerCredentialSchema, { ...(req.body as object), provider });
    const valid = provider in AI_PROVIDER_CATALOG || provider in DATA_PROVIDER_CATALOG || (provider.startsWith("oauth:") && provider.slice(6) in INTEGRATION_CATALOG);
    if (!valid) throw badRequest(`Unknown provider ${provider}`);
    if (provider.startsWith("oauth:")) {
      if (!body.clientId || !body.clientSecret) throw badRequest("Client ID and client secret are required");
    } else if (!body.apiKey) throw badRequest("API key is required");
    if (provider === "cloudflare" && !body.accountId) throw badRequest("Cloudflare also needs your account ID");
    const user = userOf(req);
    await saveCredential(user.id, provider, { apiKey: body.apiKey, clientId: body.clientId, clientSecret: body.clientSecret, accountId: body.accountId, baseUrl: body.baseUrl }, body.label);
    await audit({ userId: user.id, actor: "user", action: "credential.saved", target: provider, ip: req.ip });
    return { ok: true };
  });

  app.delete("/providers/:provider", { preHandler: app.requireAuth }, async (req) => {
    const { provider } = req.params as { provider: string };
    const user = userOf(req);
    await prisma.providerCredential.deleteMany({ where: { userId: user.id, provider } });
    await audit({ userId: user.id, actor: "user", action: "credential.deleted", target: provider, ip: req.ip });
    return { ok: true };
  });

  app.post("/providers/:provider/test", { preHandler: app.requireAuth }, async (req) => {
    const { provider } = req.params as { provider: string };
    const user = userOf(req);
    if (isCustomProvider(provider)) {
      const c = await getCustomProvider(user.id, provider);
      if (!c) throw badRequest("Not configured");
      let ok = false;
      let message = "";
      try {
        const models = await fetchCustomModels(user.id, provider);
        ok = true;
        message = `Connected — ${models.length} model(s) listed`;
      } catch (e) {
        message = redactString((e as Error).message).slice(0, 400);
      }
      await prisma.providerCredential.update({ where: { userId_provider: { userId: user.id, provider } }, data: { status: ok ? "ok" : "error", lastTestedAt: new Date(), lastError: ok ? null : message } });
      return { ok, message };
    }
    const secret = await resolveSecret(user.id, provider);
    if (!secret) throw badRequest("Not configured");
    let ok = false;
    let message = "";
    try {
      if (provider in AI_PROVIDER_CATALOG) message = await testProvider(provider, { apiKey: secret.apiKey!, accountId: secret.accountId, baseUrl: secret.baseUrl });
      else if (provider === "newsapi") {
        const r = await fetch("https://newsapi.org/v2/top-headlines?category=technology&pageSize=1&language=en", { headers: { "x-api-key": secret.apiKey! } });
        const j: any = await r.json();
        if (!r.ok) throw new Error(j.message ?? `HTTP ${r.status}`);
        message = `Connected — ${j.totalResults} headlines available`;
      } else if (provider === "producthunt") {
        const r = await fetch("https://api.producthunt.com/v2/api/graphql", { method: "POST", headers: { authorization: `Bearer ${secret.apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ query: "{ viewer { user { username } } }" }) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        message = "Connected";
      } else if (provider === "pagespeed") {
        const r = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://example.com&category=seo&key=${encodeURIComponent(secret.apiKey!)}`);
        if (!r.ok) throw new Error(((await r.json()) as any)?.error?.message ?? `HTTP ${r.status}`);
        message = "Connected";
      } else if (provider === "github_public") {
        const r = await fetch("https://api.github.com/rate_limit", { headers: { authorization: `Bearer ${secret.apiKey}` } });
        const j: any = await r.json();
        if (!r.ok) throw new Error(j.message ?? `HTTP ${r.status}`);
        message = `Connected — search limit ${j.resources?.search?.limit}/min`;
      } else if (provider.startsWith("oauth:")) {
        message = "Developer app credentials are stored. They are verified when you connect an account (OAuth).";
      }
      ok = true;
    } catch (e) {
      message = redactString((e as Error).message).slice(0, 400);
    }
    if (secret.source === "user") {
      await prisma.providerCredential.update({ where: { userId_provider: { userId: user.id, provider } }, data: { status: ok ? "ok" : "error", lastTestedAt: new Date(), lastError: ok ? null : message } });
    }
    return { ok, message };
  });

  /** Live list of models on NVIDIA API Catalog (public endpoint), used for model pickers. */
  app.get("/providers/nvidia/models", { preHandler: app.requireAuth }, async () => ({ models: await listNvidiaModels() }));

  app.get("/notifications", { preHandler: app.requireAuth }, async (req) => {
    const q = parse(z.object({ unread: z.coerce.boolean().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }), req.query);
    const user = userOf(req);
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({ where: { userId: user.id, ...(q.unread ? { read: false } : {}) }, orderBy: { createdAt: "desc" }, take: q.limit }),
      prisma.notification.count({ where: { userId: user.id, read: false } }),
    ]);
    return { items, unread };
  });

  app.post("/notifications/read", { preHandler: app.requireAuth }, async (req) => {
    const body = parse(z.object({ ids: z.array(z.string()).optional(), all: z.boolean().optional() }), req.body);
    const user = userOf(req);
    await prisma.notification.updateMany({ where: { userId: user.id, ...(body.all ? {} : { id: { in: body.ids ?? [] } }) }, data: { read: true } });
    return { ok: true };
  });

  app.get("/audit-log", { preHandler: app.requireAuth }, async (req) => {
    const q = parse(z.object({ projectId: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100), cursor: z.string().optional() }), req.query);
    const user = userOf(req);
    const items = await prisma.auditLog.findMany({
      where: { userId: user.id, ...(q.projectId ? { projectId: q.projectId } : {}) },
      orderBy: { createdAt: "desc" },
      take: q.limit,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    return { items, nextCursor: items.length === q.limit ? items[items.length - 1].id : null };
  });
}
