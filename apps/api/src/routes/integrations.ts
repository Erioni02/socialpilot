import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@socialpilot/db";
import { AppError, badRequest, config, notFound, oauthCallbackUrl, redactString } from "@socialpilot/core";
import { parseProfileUrl } from "@socialpilot/social";
import { GitHubClient, ga4ListProperties } from "@socialpilot/integrations";
import { INTEGRATION_CATALOG, INTEGRATION_PROVIDERS, type IntegrationProvider } from "@socialpilot/shared";
import {
  addPublicProfile,
  beginOAuth,
  completeOAuth,
  connectWithKey,
  disconnectIntegration,
  enqueue,
  getAppCredentials,
  getCredentials,
  publicIntegration,
  testIntegration,
  updateIntegrationConfig,
} from "@socialpilot/engine";
import { parse, userOf } from "../lib/http";

export default async function integrationRoutes(app: FastifyInstance) {
  const P = { preHandler: app.requireProject };

  async function ownedIntegration(projectId: string, integrationId: string) {
    const i = await prisma.integration.findFirst({ where: { id: integrationId, projectId } });
    if (!i) throw notFound("Integration");
    return i;
  }

  app.get("/projects/:projectId/integrations", P, async (req) => {
    const user = userOf(req);
    const rows = await prisma.integration.findMany({ where: { projectId: req.project.id, status: { not: "disconnected" } }, orderBy: { createdAt: "asc" } });
    const catalog = [];
    for (const id of INTEGRATION_PROVIDERS) {
      const entry = INTEGRATION_CATALOG[id];
      const appCreds = entry.authType === "oauth2" ? await getAppCredentials(user.id, id) : null;
      catalog.push({
        ...entry,
        redirectUri: entry.authType === "oauth2" ? oauthCallbackUrl(id) : null,
        appConfigured: entry.authType === "oauth2" ? !!appCreds : true,
        connections: rows.filter((r) => r.provider === id).map(publicIntegration),
      });
    }
    return { catalog, publicBaseUrl: config.PUBLIC_BASE_URL ?? null };
  });

  app.post("/projects/:projectId/integrations/:provider/connect", P, async (req) => {
    const { provider } = parse(z.object({ provider: z.enum(INTEGRATION_PROVIDERS) }), req.params);
    const user = userOf(req);
    const entry = INTEGRATION_CATALOG[provider];
    if (entry.authType === "oauth2") {
      const body = parse(z.object({ redirectTo: z.string().max(300).optional() }), req.body);
      const redirectTo = body.redirectTo?.startsWith("/") && !body.redirectTo.startsWith("//") ? body.redirectTo : undefined;
      return { url: await beginOAuth(user.id, req.project, provider, redirectTo) };
    }
    const fields = parse(z.record(z.string(), z.string().max(4000)), (req.body as any)?.fields ?? {});
    try {
      const integration = await connectWithKey(user.id, req.project, provider, fields);
      return { integration: publicIntegration(integration) };
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw badRequest(`Could not connect: ${redactString((e as Error).message)}`);
    }
  });

  app.post("/projects/:projectId/integrations/public-profile", P, async (req) => {
    const { url } = parse(z.object({ url: z.string().min(3).max(500) }), req.body);
    const parsed = parseProfileUrl(url);
    if (!parsed) throw badRequest("Enter a public Instagram, TikTok or X profile URL (e.g. https://x.com/yourbrand)");
    const row = await addPublicProfile(userOf(req).id, req.project, parsed.platform, parsed.handle, parsed.url);
    return {
      integration: publicIntegration(row),
      note: "A public profile URL lets SocialPilot reference your account, but it does not grant access to private analytics, publishing or comments. Connect with OAuth for that.",
    };
  });

  app.post("/projects/:projectId/integrations/:integrationId/test", P, async (req) => {
    const { integrationId } = req.params as { integrationId: string };
    await ownedIntegration(req.project.id, integrationId);
    return testIntegration(integrationId);
  });

  app.post("/projects/:projectId/integrations/:integrationId/sync", P, async (req) => {
    const { integrationId } = req.params as { integrationId: string };
    const i = await ownedIntegration(req.project.id, integrationId);
    if (i.status === "public_only") throw badRequest("Public profiles cannot be synced. Connect via OAuth.");
    const job = await enqueue("sync.integration", { integrationId }, { projectId: req.project.id, maxAttempts: 1 });
    if (i.kind === "social") await enqueue("inbox.sync", { integrationId }, { projectId: req.project.id, maxAttempts: 1 });
    return { jobId: job.id };
  });

  app.patch("/projects/:projectId/integrations/:integrationId/config", P, async (req) => {
    const { integrationId } = req.params as { integrationId: string };
    await ownedIntegration(req.project.id, integrationId);
    const body = parse(z.record(z.string(), z.unknown()), req.body);
    const updated = await updateIntegrationConfig(integrationId, body);
    if (updated.provider === "github" && body.repo) await testIntegration(integrationId);
    return { integration: publicIntegration(updated) };
  });

  app.delete("/projects/:projectId/integrations/:integrationId", P, async (req) => {
    const { integrationId } = req.params as { integrationId: string };
    const i = await ownedIntegration(req.project.id, integrationId);
    if (i.status === "public_only") {
      await prisma.integration.delete({ where: { id: i.id } });
      return { revoked: false };
    }
    return disconnectIntegration(userOf(req).id, integrationId);
  });

  app.get("/projects/:projectId/integrations/:integrationId/github/repos", P, async (req) => {
    const { integrationId } = req.params as { integrationId: string };
    const i = await ownedIntegration(req.project.id, integrationId);
    if (i.provider !== "github") throw badRequest("Not a GitHub integration");
    const creds = await getCredentials(i);
    return { repos: await new GitHubClient(creds.accessToken!).listRepos() };
  });

  app.get("/projects/:projectId/integrations/:integrationId/ga4/properties", P, async (req) => {
    const { integrationId } = req.params as { integrationId: string };
    const i = await ownedIntegration(req.project.id, integrationId);
    if (i.provider !== "ga4") throw badRequest("Not a GA4 integration");
    const creds = await getCredentials(i);
    return { properties: await ga4ListProperties(creds.accessToken!) };
  });

  /** OAuth redirect target registered with each provider. Unauthenticated by design; validated by the stored state. */
  app.get("/oauth/:provider/callback", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const q = req.query as Record<string, string>;
    const appUrl = config.APP_URL.replace(/\/$/, "");
    try {
      const r = await completeOAuth(provider, { code: q.code, state: q.state, error: q.error, error_description: q.error_description });
      const target = new URL(appUrl + r.redirectTo);
      if (r.error) target.searchParams.set("oauth_error", r.error.slice(0, 200));
      else target.searchParams.set("connected", provider);
      return reply.redirect(target.toString());
    } catch (e) {
      const target = new URL(`${appUrl}/`);
      target.searchParams.set("oauth_error", redactString((e as Error).message).slice(0, 200));
      return reply.redirect(target.toString());
    }
  });

  app.get("/projects/:projectId/integrations/:provider/setup", P, async (req) => {
    const { provider } = parse(z.object({ provider: z.enum(INTEGRATION_PROVIDERS) }), req.params);
    const entry = INTEGRATION_CATALOG[provider as IntegrationProvider];
    return { ...entry, redirectUri: entry.authType === "oauth2" ? oauthCallbackUrl(provider) : null, publicBaseUrl: config.PUBLIC_BASE_URL ?? null };
  });
}
