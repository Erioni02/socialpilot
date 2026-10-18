import { prisma, Prisma, type Integration, type Project } from "@socialpilot/db";
import { createLogger, redactString } from "@socialpilot/core";
import { socialAdapter, type MetricPoint, type RemotePost } from "@socialpilot/social";
import { ga4Summary, plausibleSummary, type WebAnalyticsSummary } from "@socialpilot/integrations";
import { SOCIAL_PLATFORMS } from "@socialpilot/shared";
import { adapterContext, getCredentials } from "../integrations/service";
import { emit } from "../infra/events";

const log = createLogger("analytics");
const isSocial = (p: string) => (SOCIAL_PLATFORMS as readonly string[]).includes(p);

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}
export function invalidateAnalyticsCache(projectId: string) {
  for (const k of cache.keys()) if (k.includes(projectId)) cache.delete(k);
}

async function storePoints(projectId: string, integration: Integration, points: MetricPoint[]) {
  for (const p of points) {
    if (p.metric.startsWith("_")) continue;
    await prisma.metricSnapshot.upsert({
      where: { projectId_source_metric_dimension_date: { projectId, source: integration.provider, metric: p.metric, dimension: p.dimension ?? "", date: p.date } },
      update: { value: p.value, capturedAt: new Date(), integrationId: integration.id },
      create: { projectId, integrationId: integration.id, source: integration.provider, metric: p.metric, value: p.value, dimension: p.dimension ?? "", date: p.date },
    });
  }
}

/** Pulls real metrics from a connected integration and stores daily snapshots. */
export async function syncIntegration(integrationId: string) {
  const integration = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
  if (integration.status !== "connected" && integration.status !== "error") return { skipped: integration.status };
  const projectId = integration.projectId;
  const notes: string[] = [];
  try {
    if (isSocial(integration.provider)) {
      const ctx = await adapterContext(integration);
      const adapter = socialAdapter(integration.provider);
      const until = new Date();
      const since = new Date(Date.now() - 27 * 86400_000);
      const points = await adapter.getAccountMetrics(ctx, { since, until });
      const insightsErr = points.find((p) => p.metric === "_insights_error");
      if (insightsErr) notes.push(`Insights unavailable: ${insightsErr.dimension}`);
      await storePoints(projectId, integration, points);
      // Update metrics of posts SocialPilot published.
      try {
        const remote = await adapter.listPosts(ctx, { limit: 25 });
        const byId = new Map(remote.map((r) => [r.id, r]));
        const targets = await prisma.postTarget.findMany({ where: { integrationId: integration.id, status: "published", remoteId: { not: null } } });
        for (const t of targets) {
          const r = byId.get(t.remoteId!);
          if (r) await prisma.postTarget.update({ where: { id: t.id }, data: { metrics: r.metrics as Prisma.InputJsonValue, metricsAt: new Date(), remoteUrl: t.remoteUrl ?? r.url } });
        }
      } catch (e) {
        notes.push(`Posts unavailable: ${(e as Error).message}`);
      }
      const profile = await adapter.getProfile(ctx).catch(() => null);
      await prisma.integration.update({
        where: { id: integration.id },
        data: {
          lastSyncAt: new Date(),
          status: "connected",
          lastError: notes.length ? redactString(notes.join(" · ")).slice(0, 500) : null,
          ...(profile ? { accountName: profile.name ?? integration.accountName, accountAvatar: profile.avatarUrl ?? integration.accountAvatar } : {}),
        },
      });
    } else if (integration.provider === "ga4" || integration.provider === "plausible") {
      const summary = await fetchWebSummary(integration, 28);
      if (summary) {
        const pts: MetricPoint[] = summary.daily.flatMap((d) => {
          const date = new Date(`${d.date}T00:00:00Z`);
          return [
            { metric: "sessions", value: d.sessions, date },
            { metric: "users", value: d.users, date },
            { metric: "pageviews", value: d.pageviews, date },
            ...(d.conversions != null ? [{ metric: "conversions", value: d.conversions, date }] : []),
          ];
        });
        await storePoints(projectId, integration, pts);
      }
      await prisma.integration.update({ where: { id: integration.id }, data: { lastSyncAt: new Date(), status: "connected", lastError: summary ? null : "Select a GA4 property to sync" } });
    }
    invalidateAnalyticsCache(projectId);
    await emit({ type: "metrics.updated", projectId, data: { integrationId } });
    return { ok: true, notes };
  } catch (err) {
    const msg = redactString((err as Error).message).slice(0, 500);
    log.warn(`sync failed for ${integration.provider}`, { error: msg });
    await prisma.integration.update({ where: { id: integration.id }, data: { lastError: msg, status: "error" } });
    await emit({ type: "integration.updated", projectId, data: { id: integration.id } });
    throw err;
  }
}

async function fetchWebSummary(integration: Integration, days: number): Promise<WebAnalyticsSummary | null> {
  const creds = await getCredentials(integration);
  const c = integration.config as Record<string, any>;
  if (integration.provider === "ga4") {
    if (!c.propertyId) return null;
    return ga4Summary(creds.accessToken!, c.propertyId, days);
  }
  if (integration.provider === "plausible") return plausibleSummary(c.baseUrl, creds.apiKey!, c.siteId, days);
  return null;
}

export async function webAnalytics(project: Project, days = 28) {
  const integration = await prisma.integration.findFirst({ where: { projectId: project.id, provider: { in: ["ga4", "plausible"] }, status: { in: ["connected", "error"] } } });
  if (!integration) return { connected: false as const };
  try {
    const summary = await cached(`web:${project.id}:${days}`, 10 * 60_000, () => fetchWebSummary(integration, days));
    if (!summary) return { connected: true as const, provider: integration.provider, needsConfig: "Select a GA4 property on the Integrations page." };
    return { connected: true as const, provider: integration.provider, summary };
  } catch (e) {
    return { connected: true as const, provider: integration.provider, error: redactString((e as Error).message) };
  }
}

export async function socialAnalytics(project: Project) {
  const integrations = await prisma.integration.findMany({ where: { projectId: project.id, kind: "social", status: { in: ["connected", "error", "expired", "public_only"] } } });
  const accounts = [];
  for (const i of integrations) {
    if (i.status === "public_only") {
      accounts.push({ integrationId: i.id, platform: i.provider, handle: i.accountHandle, status: i.status, followersSeries: [], latest: {}, topPosts: [], note: "Public profile only — connect via OAuth to read metrics." });
      continue;
    }
    const snaps = await prisma.metricSnapshot.findMany({ where: { projectId: project.id, integrationId: i.id }, orderBy: { date: "asc" } });
    const series = (m: string) => snaps.filter((s) => s.metric === m && s.dimension === "").map((s) => ({ date: s.date.toISOString().slice(0, 10), value: s.value }));
    const latest: Record<string, number> = {};
    for (const s of snaps) if (!s.dimension || s.dimension.startsWith("range:") || s.dimension === "last20") latest[s.metric] = s.value;
    let topPosts: RemotePost[] = [];
    let postsError: string | undefined;
    try {
      topPosts = await cached(`posts:${project.id}:${i.id}`, 10 * 60_000, async () => {
        const ctx = await adapterContext(i);
        return socialAdapter(i.provider).listPosts(ctx, { limit: 25 });
      });
    } catch (e) {
      postsError = redactString((e as Error).message);
    }
    const engagement = (p: RemotePost) => Object.entries(p.metrics).filter(([k]) => k !== "views" && k !== "impressions").reduce((s, [, v]) => s + v, 0);
    const followers = series("followers");
    const growth = followers.length >= 2 ? followers[followers.length - 1].value - followers[0].value : null;
    accounts.push({
      integrationId: i.id,
      platform: i.provider,
      handle: i.accountHandle,
      status: i.status,
      lastSyncAt: i.lastSyncAt,
      followersSeries: followers,
      followerGrowth: growth,
      growthWindowDays: followers.length >= 2 ? Math.round((Date.parse(followers[followers.length - 1].date) - Date.parse(followers[0].date)) / 86400_000) : 0,
      reachSeries: series("reach"),
      latest,
      topPosts: [...topPosts].sort((a, b) => engagement(b) - engagement(a)).slice(0, 8),
      formatBreakdown: Object.entries(
        topPosts.reduce<Record<string, { count: number; engagement: number }>>((acc, p) => {
          const k = p.mediaType ?? "TEXT";
          acc[k] = acc[k] ?? { count: 0, engagement: 0 };
          acc[k].count++;
          acc[k].engagement += engagement(p);
          return acc;
        }, {}),
      ).map(([format, v]) => ({ format, posts: v.count, avgEngagement: v.count ? v.engagement / v.count : 0 })),
      postsError,
      lastError: i.lastError,
    });
  }
  return { accounts };
}

export async function campaignPerformance(project: Project) {
  const campaigns = await prisma.campaign.findMany({ where: { projectId: project.id }, include: { posts: { include: { targets: true } } } });
  const web = await webAnalytics(project);
  const webCampaigns = "summary" in web && web.summary ? web.summary.campaigns : [];
  return campaigns.map((c) => {
    const targets = c.posts.flatMap((p) => p.targets);
    const published = targets.filter((t) => t.status === "published");
    const totals: Record<string, number> = {};
    for (const t of published) for (const [k, v] of Object.entries((t.metrics as Record<string, number>) ?? {})) totals[k] = (totals[k] ?? 0) + Number(v);
    const traffic = webCampaigns.filter((w) => w.campaign === c.slug);
    return {
      id: c.id,
      name: c.name,
      slug: c.slug,
      status: c.status,
      posts: c.posts.length,
      published: published.length,
      scheduled: targets.filter((t) => t.status === "scheduled").length,
      socialTotals: totals,
      webSessions: traffic.length ? traffic.reduce((s, t) => s + t.sessions, 0) : null,
      webConversions: traffic.length && traffic.some((t) => t.conversions != null) ? traffic.reduce((s, t) => s + (t.conversions ?? 0), 0) : null,
    };
  });
}
