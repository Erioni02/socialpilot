import { prisma, Prisma, type Integration, type Project } from "@socialpilot/db";
import {
  AppError,
  badRequest,
  decryptJson,
  encryptJson,
  oauthCallbackUrl,
  pkcePair,
  ProviderError,
  randomToken,
  redactString,
  SetupRequiredError,
} from "@socialpilot/core";
import { socialAdapter, type AdapterContext, type OAuthTokens } from "@socialpilot/social";
import {
  GitHubClient,
  ga4ListProperties,
  githubAuthUrl,
  githubExchangeCode,
  githubRevoke,
  googleAuthUrl,
  googleExchangeCode,
  googleRefresh,
  googleRevoke,
  googleUserEmail,
  plausibleSummary,
  VercelClient,
} from "@socialpilot/integrations";
import {
  effectiveCapabilities,
  INTEGRATION_CATALOG,
  SOCIAL_PLATFORMS,
  type IntegrationProvider,
  type SocialPlatform,
} from "@socialpilot/shared";
import { getAppCredentials } from "../infra/credentials";
import { audit } from "../infra/audit";
import { emit } from "../infra/events";

export interface StoredCredentials {
  accessToken?: string;
  refreshToken?: string;
  refreshExpiresAt?: string | null;
  apiKey?: string;
  token?: string;
}

const isSocial = (p: string): p is SocialPlatform => (SOCIAL_PLATFORMS as readonly string[]).includes(p);

export function publicIntegration(i: Integration) {
  const { credentialsEnc: _c, ...rest } = i;
  const capabilities = isSocial(i.provider) ? effectiveCapabilities(i.provider, i.scopes) : null;
  return { ...rest, hasCredentials: !!i.credentialsEnc, capabilities };
}

// ───────────── OAuth ─────────────

export async function beginOAuth(userId: string, project: Project, provider: IntegrationProvider, redirectTo?: string): Promise<string> {
  const entry = INTEGRATION_CATALOG[provider];
  if (!entry || entry.authType !== "oauth2") throw badRequest(`${provider} does not use OAuth`);
  const creds = await getAppCredentials(userId, provider);
  if (!creds) {
    throw new SetupRequiredError(`${entry.name} developer app credentials are not configured.`, { kind: "oauth_app", provider, link: `/projects/${project.id}/integrations?setup=${provider}` });
  }
  const state = randomToken(24);
  const needsPkce = provider === "x" || provider === "ga4";
  const pkce = needsPkce ? pkcePair() : null;
  await prisma.oAuthState.create({
    data: { id: state, userId, projectId: project.id, provider, codeVerifier: pkce?.verifier, redirectTo, expiresAt: new Date(Date.now() + 15 * 60_000) },
  });
  const redirectUri = oauthCallbackUrl(provider);
  if (isSocial(provider)) {
    return socialAdapter(provider).buildAuthUrl({ creds, redirectUri, state, codeChallenge: pkce?.challenge, scopes: entry.defaultScopes });
  }
  if (provider === "github") return githubAuthUrl(creds, redirectUri, state, entry.defaultScopes);
  if (provider === "ga4") return googleAuthUrl(creds, redirectUri, state, entry.defaultScopes, pkce!.challenge);
  throw badRequest(`OAuth not implemented for ${provider}`);
}

export async function completeOAuth(provider: string, params: { code?: string; state?: string; error?: string; error_description?: string }) {
  if (!params.state) throw badRequest("Missing OAuth state");
  const st = await prisma.oAuthState.findUnique({ where: { id: params.state } });
  if (!st || st.provider !== provider) throw badRequest("Invalid or expired OAuth state. Start the connection again.");
  await prisma.oAuthState.delete({ where: { id: st.id } });
  if (st.expiresAt < new Date()) throw badRequest("OAuth state expired. Start the connection again.");
  const project = await prisma.project.findFirstOrThrow({ where: { id: st.projectId, ownerId: st.userId } });
  const back = st.redirectTo ?? `/projects/${project.id}/integrations`;
  if (params.error || !params.code) {
    await audit({ userId: st.userId, projectId: project.id, actor: "user", action: "integration.oauth_denied", target: provider, details: { error: params.error } });
    return { project, redirectTo: back, error: params.error_description ?? params.error ?? "Authorization was cancelled" };
  }
  const p = provider as IntegrationProvider;
  const creds = (await getAppCredentials(st.userId, p))!;
  const redirectUri = oauthCallbackUrl(provider);
  let data: {
    accountId: string;
    accountName?: string;
    accountHandle?: string;
    accountAvatar?: string;
    accountUrl?: string;
    scopes: string[];
    tokens: OAuthTokens;
    config?: Record<string, unknown>;
  };
  if (isSocial(p)) {
    const { tokens, account } = await socialAdapter(p).exchangeCode({ creds, code: params.code, redirectUri, codeVerifier: st.codeVerifier ?? undefined });
    data = {
      accountId: account.id,
      accountName: account.name,
      accountHandle: account.handle,
      accountAvatar: account.avatarUrl,
      accountUrl: account.url,
      scopes: tokens.scopes.length ? tokens.scopes : INTEGRATION_CATALOG[p].defaultScopes,
      tokens,
      config: { accountType: account.accountType },
    };
  } else if (p === "github") {
    const t = await githubExchangeCode(creds, params.code, redirectUri);
    const user = await new GitHubClient(t.accessToken).user();
    data = { accountId: String(user.id), accountName: user.name ?? user.login, accountHandle: user.login, accountAvatar: user.avatar_url, accountUrl: user.html_url, scopes: t.scopes, tokens: { accessToken: t.accessToken, scopes: t.scopes } };
  } else if (p === "ga4") {
    const t = await googleExchangeCode(creds, params.code, redirectUri, st.codeVerifier!);
    const email = await googleUserEmail(t.accessToken).catch(() => undefined);
    data = { accountId: email ?? "google", accountName: email, scopes: t.scopes, tokens: t };
  } else {
    throw badRequest(`Unsupported provider ${provider}`);
  }

  const existing = await prisma.integration.findFirst({ where: { projectId: project.id, provider, accountId: data.accountId } });
  const stored: StoredCredentials = {
    accessToken: data.tokens.accessToken,
    refreshToken: data.tokens.refreshToken,
    refreshExpiresAt: data.tokens.refreshExpiresAt?.toISOString() ?? null,
  };
  const fields = {
    status: "connected",
    kind: INTEGRATION_CATALOG[p].kind,
    accountName: data.accountName,
    accountHandle: data.accountHandle,
    accountAvatar: data.accountAvatar,
    accountUrl: data.accountUrl,
    scopes: data.scopes,
    credentialsEnc: encryptJson(stored),
    tokenExpiresAt: data.tokens.expiresAt ?? null,
    lastError: null,
  };
  const integration = existing
    ? await prisma.integration.update({ where: { id: existing.id }, data: { ...fields, config: { ...(existing.config as object), ...(data.config ?? {}) } as Prisma.InputJsonValue } })
    : await prisma.integration.create({ data: { ...fields, projectId: project.id, provider, accountId: data.accountId, config: (data.config ?? {}) as Prisma.InputJsonValue } });
  // Remove a "public profile only" placeholder for the same platform once a real connection exists.
  await prisma.integration.deleteMany({ where: { projectId: project.id, provider, status: "public_only" } });
  await audit({ userId: st.userId, projectId: project.id, actor: "user", action: "integration.connected", target: provider, details: { account: data.accountHandle ?? data.accountId, scopes: data.scopes } });
  await testIntegration(integration.id).catch(() => {});
  await emit({ type: "integration.updated", projectId: project.id, data: { id: integration.id } });
  return { project, redirectTo: back, integrationId: integration.id };
}

// ───────────── Token handling ─────────────

/** Returns decrypted credentials, refreshing OAuth tokens that expire within 10 minutes. */
export async function getCredentials(integration: Integration): Promise<StoredCredentials> {
  const creds = decryptJson<StoredCredentials>(integration.credentialsEnc) ?? {};
  const expiring = integration.tokenExpiresAt && integration.tokenExpiresAt.getTime() < Date.now() + 10 * 60_000;
  if (!expiring || !creds.accessToken) return creds;
  const project = await prisma.project.findUniqueOrThrow({ where: { id: integration.projectId } });
  const app = await getAppCredentials(project.ownerId, integration.provider as IntegrationProvider);
  try {
    let next: OAuthTokens | null = null;
    if (isSocial(integration.provider)) {
      const adapter = socialAdapter(integration.provider);
      if (adapter.refresh && app) {
        next = await adapter.refresh(app, { accessToken: creds.accessToken, refreshToken: creds.refreshToken, scopes: integration.scopes });
      }
    } else if (integration.provider === "ga4" && app && creds.refreshToken) {
      next = await googleRefresh(app, creds.refreshToken);
    }
    if (!next) return creds;
    const updated: StoredCredentials = { ...creds, accessToken: next.accessToken, refreshToken: next.refreshToken ?? creds.refreshToken };
    await prisma.integration.update({
      where: { id: integration.id },
      data: { credentialsEnc: encryptJson(updated), tokenExpiresAt: next.expiresAt ?? null, status: "connected", lastError: null },
    });
    return updated;
  } catch (err) {
    const msg = redactString((err as Error).message);
    await prisma.integration.update({ where: { id: integration.id }, data: { status: "expired", lastError: `Token refresh failed: ${msg}` } });
    await emit({ type: "integration.updated", projectId: integration.projectId, data: { id: integration.id } });
    throw new AppError(401, `${integration.provider} authorization expired. Reconnect the account.`, "integration_expired");
  }
}

export async function adapterContext(integration: Integration): Promise<AdapterContext> {
  if (integration.status !== "connected" && integration.status !== "error") {
    throw new AppError(409, `${integration.provider} is not connected (status: ${integration.status}).`, "integration_unavailable");
  }
  const creds = await getCredentials(integration);
  if (!creds.accessToken) throw new AppError(409, `${integration.provider} has no access token`, "integration_unavailable");
  return { accessToken: creds.accessToken, accountId: integration.accountId ?? "", scopes: integration.scopes, config: integration.config as Record<string, unknown> };
}

export async function socialIntegrations(projectId: string, platform?: string) {
  return prisma.integration.findMany({
    where: { projectId, kind: "social", status: { in: ["connected", "error"] }, ...(platform ? { provider: platform } : {}) },
  });
}

// ───────────── Token/API-key based connections ─────────────

export async function connectWithKey(userId: string, project: Project, provider: IntegrationProvider, fields: Record<string, string>) {
  const entry = INTEGRATION_CATALOG[provider];
  if (entry.authType === "oauth2") throw badRequest(`${entry.name} uses OAuth — click Connect instead.`);
  for (const f of entry.connectFields ?? []) if (!f.optional && !fields[f.key]?.trim()) throw badRequest(`${f.label} is required`);
  let account: { id: string; name?: string; handle?: string; url?: string } = { id: provider };
  let configData: Record<string, unknown> = {};
  let secrets: StoredCredentials = {};
  if (provider === "plausible") {
    const baseUrl = fields.baseUrl?.trim() || "https://plausible.io";
    await plausibleSummary(baseUrl, fields.apiKey, fields.siteId, 7); // verifies key + site
    account = { id: fields.siteId, name: fields.siteId, url: `${baseUrl}/${fields.siteId}` };
    configData = { siteId: fields.siteId, baseUrl };
    secrets = { apiKey: fields.apiKey };
  } else if (provider === "vercel") {
    const client = new VercelClient(fields.token, fields.teamId || undefined);
    const [user, proj] = await Promise.all([client.user(), client.getProject(fields.projectId)]);
    account = { id: proj.id, name: proj.name, handle: user.user?.username, url: `https://vercel.com/${user.user?.username ?? ""}/${proj.name}` };
    configData = { projectId: proj.id, projectName: proj.name, teamId: fields.teamId || null, framework: proj.framework, link: proj.link ?? null };
    secrets = { token: fields.token };
  }
  const existing = await prisma.integration.findFirst({ where: { projectId: project.id, provider } });
  const data = {
    kind: entry.kind,
    status: "connected",
    accountId: account.id,
    accountName: account.name,
    accountHandle: account.handle,
    accountUrl: account.url,
    scopes: entry.defaultScopes,
    credentialsEnc: encryptJson(secrets),
    config: configData as Prisma.InputJsonValue,
    lastError: null,
    lastTestedAt: new Date(),
    testResults: { connection: { ok: true, at: new Date().toISOString() } } as Prisma.InputJsonValue,
  };
  const integration = existing ? await prisma.integration.update({ where: { id: existing.id }, data }) : await prisma.integration.create({ data: { ...data, projectId: project.id, provider } });
  await audit({ userId, projectId: project.id, actor: "user", action: "integration.connected", target: provider, details: { account: account.name } });
  await emit({ type: "integration.updated", projectId: project.id, data: { id: integration.id } });
  return integration;
}

/** Records a public profile URL. It grants no API access; status is "public_only". */
export async function addPublicProfile(userId: string, project: Project, platform: SocialPlatform, handle: string, url: string) {
  const existing = await prisma.integration.findFirst({ where: { projectId: project.id, provider: platform } });
  if (existing && existing.status === "connected") return existing;
  const data = { kind: "social", status: "public_only", accountId: `public:${handle}`, accountHandle: handle, accountUrl: url, scopes: [] as string[], lastError: null };
  const row = existing ? await prisma.integration.update({ where: { id: existing.id }, data }) : await prisma.integration.create({ data: { ...data, projectId: project.id, provider: platform } });
  await audit({ userId, projectId: project.id, actor: "user", action: "integration.public_profile_added", target: platform, details: { handle } });
  return row;
}

// ───────────── Test / sync / disconnect ─────────────

/** Calls the provider's read endpoints to verify what actually works. Never marks untested operations as working. */
export async function testIntegration(id: string) {
  const integration = await prisma.integration.findUniqueOrThrow({ where: { id } });
  const results: Record<string, { ok: boolean; message: string; at: string }> = {};
  const at = new Date().toISOString();
  const record = (k: string, ok: boolean, message: string) => (results[k] = { ok, message: redactString(message).slice(0, 400), at });
  try {
    if (isSocial(integration.provider)) {
      const ctx = await adapterContext(integration);
      const adapter = socialAdapter(integration.provider);
      const profile = await adapter.getProfile(ctx);
      record("read_profile", true, `@${profile.handle ?? profile.name ?? profile.id}`);
      try {
        const posts = await adapter.listPosts(ctx, { limit: 5 });
        record("list_posts", true, `${posts.length} recent post(s) readable`);
      } catch (e) {
        record("list_posts", false, (e as Error).message);
      }
      if (integration.provider === "instagram" && profile.accountType && !["BUSINESS", "MEDIA_CREATOR", "CREATOR"].includes(profile.accountType)) {
        record("account_type", false, `Account type ${profile.accountType} — publishing and insights need a Business or Creator account`);
      }
    } else if (integration.provider === "github") {
      const creds = await getCredentials(integration);
      const repos = await new GitHubClient(creds.accessToken!).listRepos();
      record("list_repos", true, `${repos.length} repositories accessible`);
      const repo = (integration.config as any).repo;
      if (repo) {
        await new GitHubClient(creds.accessToken!).getRepo(repo);
        record("repo_access", true, `Access to ${repo} confirmed`);
      }
    } else if (integration.provider === "ga4") {
      const creds = await getCredentials(integration);
      const props = await ga4ListProperties(creds.accessToken!);
      record("list_properties", true, `${props.length} GA4 propert${props.length === 1 ? "y" : "ies"} accessible`);
    } else if (integration.provider === "plausible") {
      const creds = await getCredentials(integration);
      const c = integration.config as any;
      await plausibleSummary(c.baseUrl, creds.apiKey!, c.siteId, 7);
      record("stats_query", true, "Stats API query succeeded");
    } else if (integration.provider === "vercel") {
      const creds = await getCredentials(integration);
      const c = integration.config as any;
      const deps = await new VercelClient(creds.token!, c.teamId ?? undefined).listDeployments(c.projectId, 5);
      record("list_deployments", true, `${deps.length} recent deployment(s) readable`);
    }
    const anyFail = Object.values(results).some((r) => !r.ok);
    await prisma.integration.update({
      where: { id },
      data: { testResults: results as Prisma.InputJsonValue, lastTestedAt: new Date(), status: "connected", lastError: anyFail ? Object.values(results).find((r) => !r.ok)!.message : null },
    });
  } catch (err) {
    const msg = err instanceof ProviderError || err instanceof AppError ? err.message : String(err);
    record("connection", false, msg);
    await prisma.integration.update({
      where: { id },
      data: { testResults: results as Prisma.InputJsonValue, lastTestedAt: new Date(), status: integration.status === "expired" ? "expired" : "error", lastError: redactString(msg).slice(0, 500) },
    });
  }
  await emit({ type: "integration.updated", projectId: integration.projectId, data: { id } });
  return { results };
}

export async function disconnectIntegration(userId: string, id: string) {
  const integration = await prisma.integration.findUniqueOrThrow({ where: { id } });
  const project = await prisma.project.findUniqueOrThrow({ where: { id: integration.projectId } });
  let revoked = false;
  try {
    const creds = decryptJson<StoredCredentials>(integration.credentialsEnc);
    const app = await getAppCredentials(project.ownerId, integration.provider as IntegrationProvider);
    if (creds?.accessToken) {
      if (isSocial(integration.provider) && app) {
        const adapter = socialAdapter(integration.provider);
        if (adapter.revoke) {
          await adapter.revoke(app, { accessToken: creds.accessToken, refreshToken: creds.refreshToken, scopes: integration.scopes });
          revoked = true;
        }
      } else if (integration.provider === "github" && app) {
        await githubRevoke(app, creds.accessToken);
        revoked = true;
      } else if (integration.provider === "ga4") {
        await googleRevoke(creds.refreshToken ?? creds.accessToken);
        revoked = true;
      }
    }
  } catch {
    /* revocation is best effort; local credentials are always deleted */
  }
  await prisma.integration.update({ where: { id }, data: { status: "disconnected", credentialsEnc: null, tokenExpiresAt: null, lastError: null } });
  await audit({ userId, projectId: project.id, actor: "user", action: "integration.disconnected", target: integration.provider, details: { revokedAtProvider: revoked } });
  await emit({ type: "integration.updated", projectId: project.id, data: { id } });
  return { revoked };
}

export async function updateIntegrationConfig(id: string, patch: Record<string, unknown>) {
  const i = await prisma.integration.findUniqueOrThrow({ where: { id } });
  const allowed: Record<string, string[]> = {
    github: ["repo", "baseBranch", "checksWorkflowId", "previewFromVercel"],
    ga4: ["propertyId", "propertyName"],
    tiktok: ["defaultPrivacyLevel"],
    instagram: [],
    x: [],
    plausible: [],
    vercel: ["autoPreview"],
  };
  const keys = allowed[i.provider] ?? [];
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => keys.includes(k)));
  const updated = await prisma.integration.update({ where: { id }, data: { config: { ...(i.config as object), ...clean } as Prisma.InputJsonValue } });
  await emit({ type: "integration.updated", projectId: i.projectId, data: { id } });
  return updated;
}
