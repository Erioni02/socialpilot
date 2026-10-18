import { prisma, Prisma, type IntelEntity } from "@socialpilot/db";
import { badRequest, createLogger, notFound, redactString } from "@socialpilot/core";
import {
  analyzeSocialUrl,
  postpeerAccounts,
  postpeerBalance,
  postpeerConnectUrl,
  socialcrawlBalance,
  normalizeDomain,
  runTrafficOverview,
  TRAFFIC_EST_COST_PER_DOMAIN,
  type IntelOutcome,
  type IntelResult,
  type MetricKey,
  type MetricValue,
} from "@socialpilot/integrations";
import { getApiKey } from "../infra/credentials";
import { audit, notify } from "../infra/audit";
import { emit } from "../infra/events";
import { enqueue } from "../infra/queue";

const log = createLogger("intel");

/** Hard ceiling for any single paid (Apify) request, regardless of what the client asks for. */
export const MAX_PAID_CHARGE_USD = 1;
const COMPARABLE: MetricKey[] = ["views", "likes", "comments", "shares"];

type Metrics = Partial<Record<MetricKey, MetricValue>>;

async function upsertEntity(userId: string, projectId: string | null, r: Pick<IntelResult, "platform" | "kind" | "externalId" | "url" | "title" | "profile">, status: string) {
  const data = {
    url: r.url,
    handle: r.profile?.handle ?? undefined,
    title: (r.title ?? r.profile?.displayName ?? undefined)?.slice(0, 500),
    avatarUrl: r.profile?.avatarUrl ?? undefined,
    lastFetchedAt: new Date(),
    lastStatus: status,
    lastError: null,
  };
  return prisma.intelEntity.upsert({
    where: { userId_platform_kind_externalId: { userId, platform: r.platform, kind: r.kind, externalId: r.externalId.toLowerCase() } },
    update: { ...data, ...(projectId ? { projectId } : {}) },
    create: { userId, projectId, platform: r.platform, kind: r.kind, externalId: r.externalId.toLowerCase(), ...data },
  });
}

async function saveSnapshot(entityId: string, r: { source: string; confidence: string; metrics: Metrics; profile?: unknown; posts?: unknown; unavailable?: unknown; costUsd?: number }) {
  return prisma.intelSnapshot.create({
    data: {
      entityId,
      source: r.source,
      confidence: r.confidence,
      metrics: r.metrics as Prisma.InputJsonValue,
      profile: (r.profile ?? Prisma.DbNull) as Prisma.InputJsonValue,
      posts: (r.posts ?? Prisma.DbNull) as Prisma.InputJsonValue,
      unavailable: (r.unavailable ?? []) as Prisma.InputJsonValue,
      costUsd: r.costUsd ?? 0,
    },
  });
}

/** Stores a successful result: the entity, a snapshot, and (for TikTok videos) a creator-profile snapshot from authorStats. */
async function persist(userId: string, projectId: string | null, outcome: IntelOutcome, costUsd = 0) {
  const r = outcome.result!;
  const entity = await upsertEntity(userId, projectId, r, outcome.status);
  const snapshot = await saveSnapshot(entity.id, { source: r.source, confidence: r.confidence, metrics: r.metrics, profile: r.profile, posts: r.posts, unavailable: r.unavailable, costUsd });
  if (r.author && r.author.profile.handle && Object.keys(r.author.metrics).length) {
    const creator = await upsertEntity(userId, projectId, { platform: r.platform, kind: "profile", externalId: r.author.profile.handle, url: `https://www.tiktok.com/@${r.author.profile.handle}`, title: r.author.profile.displayName, profile: r.author.profile }, "partial");
    const approx = Object.values(r.author.metrics).some((m) => m?.approx);
    await saveSnapshot(creator.id, {
      source: `${r.source} (creator stats on video page)`,
      confidence: approx ? "rounded" : "exact",
      metrics: r.author.metrics,
      profile: r.author.profile,
      unavailable: [{ metric: "recent posts", reason: "Free source exposes creator totals only; analyze video URLs or run a paid profile scrape for post lists." }],
    });
  }
  return { entity, snapshot };
}

export interface AnalyzeInput {
  url: string;
  projectId?: string | null;
  /** Paid provider id (socialcrawl-* | postpeer-x | apify-*). Requires confirmPaid === true. */
  paidProvider?: string;
  confirmPaid?: boolean;
  maxChargeUsd?: number;
}

const PAID_KEY: Record<string, { key: "apify" | "socialcrawl" | "postpeer"; name: string }> = {
  "apify-instagram": { key: "apify", name: "Apify API token" },
  "apify-tiktok": { key: "apify", name: "Apify API token" },
  "socialcrawl-tiktok": { key: "socialcrawl", name: "SocialCrawl API key" },
  "socialcrawl-instagram": { key: "socialcrawl", name: "SocialCrawl API key" },
  "postpeer-x": { key: "postpeer", name: "PostPeer API key" },
};

/** Which paid data sources the user has keys for (keys never leave the server). */
export async function paidSourceStatus(userId: string) {
  const [apify, socialcrawl, postpeer] = await Promise.all([getApiKey(userId, "apify"), getApiKey(userId, "socialcrawl"), getApiKey(userId, "postpeer")]);
  return { apify: !!apify, socialcrawl: !!socialcrawl, postpeer: !!postpeer };
}

/** Free balance lookups so the confirmation dialog can show remaining credits. */
export async function paidSourceBalance(userId: string, source: "socialcrawl" | "postpeer") {
  const key = await getApiKey(userId, source);
  if (!key) throw badRequest(`Add your ${source === "socialcrawl" ? "SocialCrawl" : "PostPeer"} API key in Settings → Data sources first.`);
  return source === "socialcrawl" ? socialcrawlBalance(key) : postpeerBalance(key);
}

export async function postpeerXAccounts(userId: string) {
  const key = await getApiKey(userId, "postpeer");
  if (!key) return { configured: false, accounts: [] };
  return { configured: true, accounts: await postpeerAccounts(key) };
}

export async function postpeerXConnect(userId: string, redirectUri?: string) {
  const key = await getApiKey(userId, "postpeer");
  if (!key) throw badRequest("Add your PostPeer API key in Settings → Data sources first.");
  return { url: await postpeerConnectUrl(key, redirectUri) };
}

export async function analyzeIntelUrl(userId: string, input: AnalyzeInput) {
  let apifyToken: string | undefined;
  let socialcrawlKey: string | undefined;
  let postpeerKey: string | undefined;
  let maxChargeUsd: number | undefined;
  if (input.paidProvider) {
    if (input.confirmPaid !== true) throw badRequest("Paid sources need explicit confirmation for each request.");
    const need = PAID_KEY[input.paidProvider];
    if (!need) throw badRequest("Unknown paid source.");
    const key = (await getApiKey(userId, need.key)) ?? undefined;
    if (!key) throw badRequest(`Add your ${need.name} in Settings → Data sources to use this source.`);
    if (need.key === "apify") {
      apifyToken = key;
      maxChargeUsd = Math.min(Math.max(input.maxChargeUsd ?? 0.1, 0.01), MAX_PAID_CHARGE_USD);
    } else if (need.key === "socialcrawl") socialcrawlKey = key;
    else postpeerKey = key;
  }
  const { parsed, outcome } = await analyzeSocialUrl(input.url, { paidProvider: input.paidProvider, apifyToken, socialcrawlKey, postpeerKey, maxChargeUsd });
  const ok = outcome.status === "ok" || outcome.status === "partial";
  let entity: IntelEntity | null = null;
  if (ok && outcome.result) {
    entity = (await persist(userId, input.projectId ?? null, outcome, input.paidProvider ? maxChargeUsd : 0)).entity;
  } else if (parsed) {
    entity = await prisma.intelEntity.findUnique({ where: { userId_platform_kind_externalId: { userId, platform: parsed.platform, kind: parsed.kind, externalId: parsed.externalId.toLowerCase() } } });
    if (entity) await prisma.intelEntity.update({ where: { id: entity.id }, data: { lastStatus: outcome.status, lastError: outcome.message?.slice(0, 500) } });
  }
  await prisma.intelSearch.create({
    data: { userId, url: input.url.slice(0, 1000), platform: parsed?.platform, kind: parsed?.kind, ok, status: outcome.status, error: ok ? null : outcome.message?.slice(0, 500), entityId: entity?.id },
  });
  if (input.paidProvider) {
    await audit({ userId, projectId: input.projectId, actor: "user", action: "intel.paid_request", target: input.paidProvider, details: { url: input.url, maxChargeUsd, credits: outcome.result?.credits, status: outcome.status } });
  }
  return { parsed, outcome, entityId: entity?.id ?? null };
}

function deltas(snaps: { capturedAt: Date; metrics: Metrics }[]) {
  const out: { at: string; metric: string; from: number; to: number; change: number }[] = [];
  for (let i = 1; i < snaps.length; i++) {
    for (const [k, v] of Object.entries(snaps[i].metrics)) {
      const prev = snaps[i - 1].metrics[k as MetricKey];
      if (v && prev && v.value !== prev.value) out.push({ at: snaps[i].capturedAt.toISOString(), metric: k, from: prev.value, to: v.value, change: v.value - prev.value });
    }
  }
  return out;
}

export async function getIntelEntity(userId: string, id: string) {
  const entity = await prisma.intelEntity.findFirst({ where: { id, userId }, include: { snapshots: { orderBy: { capturedAt: "asc" }, take: 500 } } });
  if (!entity) throw notFound("Tracked item");
  const snaps = entity.snapshots.map((s) => ({ ...s, metrics: s.metrics as Metrics }));
  const latest = snaps[snaps.length - 1] ?? null;
  const series: Record<string, { at: string; value: number; approx?: boolean }[]> = {};
  for (const s of snaps) for (const [k, v] of Object.entries(s.metrics)) if (v) (series[k] ??= []).push({ at: s.capturedAt.toISOString(), value: v.value, approx: v.approx });
  const related =
    entity.kind === "profile" && entity.handle
      ? await prisma.intelEntity.findMany({ where: { userId, platform: entity.platform, kind: "post", handle: entity.handle }, include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } } })
      : [];
  return {
    entity: { ...entity, snapshots: undefined },
    latest,
    snapshots: snaps.slice(-100).reverse(),
    series,
    changes: deltas(snaps).slice(-50).reverse(),
    relatedPosts: related.map((p) => ({ id: p.id, url: p.url, title: p.title, latest: p.snapshots[0] ? { capturedAt: p.snapshots[0].capturedAt, metrics: p.snapshots[0].metrics, source: p.snapshots[0].source } : null })),
  };
}

function engagementRate(m: Metrics): number | null {
  if (!m.views?.value) return null;
  const parts = [m.likes, m.comments, m.shares].filter((x): x is MetricValue => !!x);
  if (!parts.length) return null;
  return parts.reduce((s, x) => s + x.value, 0) / m.views.value;
}

/** Aggregates only metrics that are present and comparable; reports how many items contributed to each total. */
export async function intelDashboard(userId: string, opts: { platform?: string; watchedOnly?: boolean } = {}) {
  const entities = await prisma.intelEntity.findMany({
    where: { userId, ...(opts.platform && opts.platform !== "all" ? { platform: opts.platform } : {}), ...(opts.watchedOnly ? { watched: true } : {}) },
    include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  const posts = entities.filter((e) => e.kind === "post" && e.snapshots[0]);
  const totals = Object.fromEntries(
    COMPARABLE.map((k) => {
      const withMetric = posts.filter((p) => (p.snapshots[0].metrics as Metrics)[k]);
      return [k, { value: withMetric.reduce((s, p) => s + (p.snapshots[0].metrics as Metrics)[k]!.value, 0), items: withMetric.length, of: posts.length }];
    }),
  );
  const postRows = posts.map((p) => {
    const m = p.snapshots[0].metrics as Metrics;
    return { id: p.id, platform: p.platform, url: p.url, title: p.title, handle: p.handle, capturedAt: p.snapshots[0].capturedAt, source: p.snapshots[0].source, confidence: p.snapshots[0].confidence, metrics: m, engagementRate: engagementRate(m) };
  });
  const byEngagement = (a: (typeof postRows)[number]) => a.metrics.views?.value ?? a.metrics.likes?.value ?? 0;
  const erByPlatform = Object.entries(
    postRows.reduce<Record<string, number[]>>((acc, p) => {
      if (p.engagementRate != null) (acc[p.platform] ??= []).push(p.engagementRate);
      return acc;
    }, {}),
  ).map(([platform, rates]) => ({ platform, avgEngagementRate: rates.reduce((s, r) => s + r, 0) / rates.length, posts: rates.length }));
  const viewsPosts = postRows.filter((p) => p.metrics.views);
  return {
    totals,
    averages: { views: viewsPosts.length ? viewsPosts.reduce((s, p) => s + p.metrics.views!.value, 0) / viewsPosts.length : null, viewsBasedOn: viewsPosts.length },
    engagementByPlatform: erByPlatform,
    topPosts: [...postRows].sort((a, b) => byEngagement(b) - byEngagement(a)).slice(0, 10),
    profiles: entities
      .filter((e) => e.kind === "profile")
      .map((e) => ({ id: e.id, platform: e.platform, handle: e.handle, title: e.title, avatarUrl: e.avatarUrl, watched: e.watched, lastStatus: e.lastStatus, latest: e.snapshots[0] ? { capturedAt: e.snapshots[0].capturedAt, metrics: e.snapshots[0].metrics, source: e.snapshots[0].source, confidence: e.snapshots[0].confidence } : null })),
    counts: { entities: entities.length, posts: posts.length, watched: entities.filter((e) => e.watched).length },
    lastUpdated: entities.reduce<Date | null>((m, e) => (e.lastFetchedAt && (!m || e.lastFetchedAt > m) ? e.lastFetchedAt : m), null),
    definitions: {
      views: "Platform-reported plays/views (TikTok plays, Instagram Reel plays). X views are not available from free sources.",
      likes: "Likes as reported by the platform.",
      comments: "Comments (TikTok/Instagram) and replies (X).",
      shares: "TikTok shares. X reposts are not available from free sources.",
      engagementRate: "(likes + comments + shares) ÷ views, only for posts that report views.",
    },
  };
}

export async function listIntelEntities(userId: string, opts: { watched?: boolean; platform?: string; kind?: string }) {
  return prisma.intelEntity.findMany({
    where: { userId, ...(opts.watched ? { watched: true } : {}), ...(opts.platform && opts.platform !== "all" ? { platform: opts.platform } : {}), ...(opts.kind ? { kind: opts.kind } : {}) },
    include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
    orderBy: [{ watched: "desc" }, { updatedAt: "desc" }],
    take: 500,
  });
}

export async function setWatched(userId: string, id: string, watched: boolean) {
  const r = await prisma.intelEntity.updateMany({ where: { id, userId }, data: { watched } });
  if (!r.count) throw notFound("Tracked item");
}

export async function deleteIntelEntity(userId: string, id: string) {
  await prisma.intelEntity.deleteMany({ where: { id, userId } });
}

/** Scheduled snapshots for watched items — free sources only, never paid. */
export async function refreshWatchedIntel() {
  const due = await prisma.intelEntity.findMany({
    where: { watched: true, OR: [{ lastFetchedAt: null }, { lastFetchedAt: { lt: new Date(Date.now() - 6 * 3600_000) } }] },
    take: 40,
    orderBy: { lastFetchedAt: "asc" },
  });
  let ok = 0;
  for (const e of due) {
    try {
      const { outcome } = await analyzeSocialUrl(e.url, { bypassCache: true });
      if ((outcome.status === "ok" || outcome.status === "partial") && outcome.result) {
        await persist(e.userId, e.projectId, outcome);
        ok++;
      } else {
        await prisma.intelEntity.update({ where: { id: e.id }, data: { lastFetchedAt: new Date(), lastStatus: outcome.status, lastError: outcome.message?.slice(0, 500) ?? null } });
      }
    } catch (err) {
      log.warn(`refresh ${e.id} failed: ${(err as Error).message}`);
    }
  }
  if (due.length) await emit({ type: "intel.updated", data: { refreshed: ok } });
  return { due: due.length, ok };
}

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export async function exportIntelCsv(userId: string, opts: { platform?: string; entityId?: string }) {
  const snaps = await prisma.intelSnapshot.findMany({
    where: { entity: { userId, ...(opts.entityId ? { id: opts.entityId } : {}), ...(opts.platform && opts.platform !== "all" ? { platform: opts.platform } : {}) } },
    include: { entity: true },
    orderBy: { capturedAt: "asc" },
    take: 20000,
  });
  const cols = ["captured_at", "platform", "kind", "handle", "url", "source", "confidence", ...COMPARABLE, "saves", "followers", "following", "posts", "total_likes", "approximate_metrics"];
  const lines = [cols.join(",")];
  for (const s of snaps) {
    const m = s.metrics as Metrics;
    const val = (k: MetricKey) => (m[k] ? m[k]!.value : ""); // missing metrics stay blank, never 0
    lines.push(
      [
        s.capturedAt.toISOString(),
        s.entity.platform,
        s.entity.kind,
        s.entity.handle ?? "",
        s.entity.url,
        s.source,
        s.confidence,
        ...COMPARABLE.map(val),
        val("saves"),
        val("followers"),
        val("following"),
        val("posts"),
        val("total_likes"),
        Object.entries(m)
          .filter(([, v]) => v?.approx)
          .map(([k]) => k)
          .join(" "),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

// ───────────── Website traffic estimates (Apify, explicit + capped) ─────────────

export async function startTrafficReport(userId: string, input: { projectId?: string | null; domain: string; maxBudgetUsd: number; confirm: boolean }) {
  if (input.confirm !== true) throw badRequest("Traffic reports cost money on Apify and need explicit confirmation.");
  if (!(await getApiKey(userId, "apify"))) throw badRequest("Add your Apify API token in Settings → Data sources first.");
  const domain = normalizeDomain(input.domain);
  const maxBudgetUsd = Math.min(Math.max(input.maxBudgetUsd, TRAFFIC_EST_COST_PER_DOMAIN), 2);
  const row = await prisma.webTrafficReport.create({ data: { userId, projectId: input.projectId ?? null, domain, maxBudget: maxBudgetUsd } });
  await enqueue("traffic.report", { reportId: row.id }, { projectId: input.projectId ?? null, maxAttempts: 1 });
  await audit({ userId, projectId: input.projectId, actor: "user", action: "traffic.report_requested", target: domain, details: { maxBudgetUsd } });
  return row;
}

export async function runTrafficReportJob(payload: { reportId: string }) {
  const row = await prisma.webTrafficReport.update({ where: { id: payload.reportId }, data: { status: "running" } });
  const emitUpdate = () => emit({ type: "traffic.updated", projectId: row.projectId, userId: row.userId, data: { id: row.id } });
  await emitUpdate();
  try {
    const token = await getApiKey(row.userId, "apify");
    if (!token) throw new Error("Apify token missing");
    const r = await runTrafficOverview(token, row.domain, row.maxBudget);
    await prisma.webTrafficReport.update({
      where: { id: row.id },
      data: { status: "completed", data: { overview: r.overview, summary: r.summary } as Prisma.InputJsonValue, costUsd: r.costUsd ?? null, apifyRunId: r.runId, datasetId: r.datasetId, finishedAt: new Date() },
    });
    if (row.projectId && r.overview?.estimatedMonthlyOrganicTraffic != null) {
      const date = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
      await prisma.metricSnapshot.upsert({
        where: { projectId_source_metric_dimension_date: { projectId: row.projectId, source: "apify-traffic", metric: "estimated_organic_traffic", dimension: row.domain, date } },
        update: { value: r.overview.estimatedMonthlyOrganicTraffic },
        create: { projectId: row.projectId, source: "apify-traffic", metric: "estimated_organic_traffic", dimension: row.domain, value: r.overview.estimatedMonthlyOrganicTraffic, date },
      });
    }
    await notify({ userId: row.userId, projectId: row.projectId, type: "traffic.completed", title: `Traffic estimate ready for ${row.domain}`, body: r.overview ? `~${r.overview.estimatedMonthlyOrganicTraffic ?? "?"} est. monthly organic visits` : "No data for this domain.", link: row.projectId ? `/projects/${row.projectId}/analytics` : "/intel" });
    await emitUpdate();
    return { ok: true };
  } catch (e) {
    await prisma.webTrafficReport.update({ where: { id: row.id }, data: { status: "failed", error: redactString((e as Error).message).slice(0, 1000), finishedAt: new Date() } });
    await emitUpdate();
    throw e;
  }
}
