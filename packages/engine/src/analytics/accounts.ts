import { prisma, Prisma, type Integration, type Project } from "@socialpilot/db";
import { badRequest, createLogger, notFound, redactString } from "@socialpilot/core";
import { accountFeed, audienceFrom, parseSocialUrl, postFromFeed, profileByUrl, RapidStatsError, type AudienceInsights } from "@socialpilot/integrations";
import { getApiKey } from "../infra/credentials";
import { audit } from "../infra/audit";
import { emit } from "../infra/events";
import { assertRapidBudget, getRapidSettings, recordRapidUse } from "../intel/rapidapi";

/**
 * Social accounts linked by URL (no OAuth, no posting). Analytics come from:
 *  - RapidAPI Instagram Statistics API (when a key is set): account stats + audience (1 request) and the account's
 *    post feed with per-post views/likes/comments/shares, ER and performance grades, plus hashtag / format / caption
 *    length effectiveness (1 request). Refreshed on a budget-aware cadence.
 *  - Free: follower counts captured from TikTok video pages of tracked posts, and tracked posts' own metrics.
 */

const log = createLogger("accounts");
export const LINKED = ["linked", "public_only"];
const PLATFORM_URL = (platform: string, handle: string) => (platform === "instagram" ? `https://www.instagram.com/${handle}` : platform === "tiktok" ? `https://www.tiktok.com/@${handle}` : `https://twitter.com/${handle}`);
const day = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export interface FeedPost {
  id: string;
  url: string;
  date?: string;
  type?: string;
  image?: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  interactions?: number;
  er?: number;
  viewsER?: number;
  grade?: string;
  indexGrade?: number;
  hashtags?: string[];
  textLength?: number;
  isAd?: boolean;
}
export interface FeedSummaryRow {
  name: string;
  count: number;
  grade?: number;
  er?: number;
}
export interface AccountData {
  stats?: { followers?: number; avgER?: number; avgLikes?: number; avgComments?: number; avgViews?: number; qualityScore?: number; fakeFollowersPct?: number; growth180dPct?: number; updatedAt?: string };
  audience?: AudienceInsights;
  feed?: { posts: FeedPost[]; hashtags: FeedSummaryRow[]; types: FeedSummaryRow[]; textLength: FeedSummaryRow[]; from: string; to: string; fetchedAt: string };
  cid?: string;
  lastRapidAt?: string;
  lastRapidError?: string | null;
  /** Provider is still doing its first collection: re-check after a day instead of the normal cadence. */
  collecting?: boolean;
}

const dataOf = (i: Integration) => ((i.config ?? {}) as { analytics?: AccountData }).analytics ?? {};

/** Link a social account by its profile URL. Replaces OAuth: SocialPilot only reads public analytics, never posts. */
export async function linkSocialAccount(userId: string, project: Project, rawUrl: string) {
  let parsed;
  try {
    parsed = parseSocialUrl(rawUrl);
  } catch (e) {
    throw badRequest((e as Error).message);
  }
  if (parsed.kind !== "profile" || !parsed.handle) throw badRequest("Paste the profile link (e.g. https://www.instagram.com/yourbrand), not a post.");
  const handle = parsed.handle.toLowerCase();
  const existing = await prisma.integration.findFirst({ where: { projectId: project.id, provider: parsed.platform, accountHandle: { equals: handle, mode: "insensitive" } } });
  const data = { kind: "social", status: "linked", accountId: `url:${handle}`, accountHandle: handle, accountName: existing?.accountName ?? handle, accountUrl: PLATFORM_URL(parsed.platform, handle), scopes: [] as string[], credentialsEnc: null, lastError: null };
  const row = existing ? await prisma.integration.update({ where: { id: existing.id }, data }) : await prisma.integration.create({ data: { ...data, projectId: project.id, provider: parsed.platform } });
  await audit({ userId, projectId: project.id, actor: "user", action: "integration.linked_by_url", target: parsed.platform, details: { handle } });
  await emit({ type: "integration.updated", projectId: project.id, data: { id: row.id } });
  return row;
}

async function saveData(i: Integration, patch: Partial<AccountData>, extra: Partial<Prisma.IntegrationUpdateInput> = {}) {
  const cfg = (i.config ?? {}) as Record<string, unknown>;
  const next = { ...dataOf(i), ...patch };
  return prisma.integration.update({ where: { id: i.id }, data: { config: { ...cfg, analytics: next } as unknown as Prisma.InputJsonValue, ...extra } });
}

async function gauge(i: Integration, metric: string, value: number | undefined, source: string) {
  if (value == null || !Number.isFinite(value)) return;
  await prisma.metricSnapshot.upsert({
    where: { projectId_source_metric_dimension_date: { projectId: i.projectId, source, metric, dimension: `account:${i.id}`, date: day() } },
    update: { value, capturedAt: new Date() },
    create: { projectId: i.projectId, integrationId: i.id, source, metric, value, dimension: `account:${i.id}`, date: day() },
  });
}

/** Refresh one linked account. `automatic` runs respect the budget reserve; manual runs may use it. */
export async function syncLinkedAccount(integrationId: string, opts: { automatic: boolean; withFeed?: boolean } = { automatic: true }) {
  let i = await prisma.integration.findUnique({ where: { id: integrationId }, include: { project: true } });
  if (!i || i.kind !== "social" || !LINKED.includes(i.status) || !i.accountHandle) return { skipped: "not a linked social account" };
  const userId = i.project.ownerId;
  const key = await getApiKey(userId, "rapidapi");
  if (!key) {
    await prisma.integration.update({ where: { id: i.id }, data: { lastSyncAt: new Date() } });
    return { skipped: "no RapidAPI key — free tracking only" };
  }
  const withFeed = opts.withFeed !== false;
  try {
    await assertRapidBudget(userId, withFeed ? 2 : 1, opts.automatic);
  } catch (e) {
    await saveData(i, { lastRapidError: (e as Error).message });
    return { skipped: (e as Error).message };
  }
  const profileUrl = PLATFORM_URL(i.provider, i.accountHandle);
  try {
    const r = await profileByUrl(key, profileUrl, true);
    await recordRapidUse(userId, r.quota, "account_profile", { integrationId: i.id, automatic: opts.automatic });
    const d = r.data;
    if (!d) throw badRequest("The statistics API has no data for this account yet.");
    const audience = audienceFrom(d);
    const stats: AccountData["stats"] = {
      followers: d.usersCount,
      avgER: d.avgER,
      avgLikes: d.avgLikes,
      avgComments: d.avgComments,
      avgViews: d.avgViews || d.avgVideoViews,
      qualityScore: d.qualityScore,
      fakeFollowersPct: d.audienceSeverity === 0 ? undefined : d.pctFakeFollowers,
      growth180dPct: d.pctUsersCount180d,
      updatedAt: d.statisticsTimeUpdate ?? d.timeStatistics,
    };
    i = await prisma.integration.update({
      where: { id: i.id },
      data: { accountName: d.name ?? i.accountName, accountAvatar: d.image ?? i.accountAvatar, accountId: d.cid ?? i.accountId },
      include: { project: true },
    });
    await gauge(i, "followers", d.usersCount, i.provider);
    let feed: AccountData["feed"] | undefined;
    if (withFeed && d.cid) {
      const to = new Date();
      const from = new Date(Date.now() - 60 * 86400_000);
      const f = await accountFeed(key, d.cid, from, to);
      await recordRapidUse(userId, f.quota, "account_feed", { integrationId: i.id, automatic: opts.automatic });
      const raw = (f.data as any)?.posts ?? [];
      const summary = (f.data as any)?.summary ?? {};
      const rows = (xs: any[] | undefined): FeedSummaryRow[] => (xs ?? []).map((x) => ({ name: String(x.name), count: Number(x.count ?? 0), grade: typeof x.grade === "number" ? x.grade : undefined, er: typeof x.er === "number" ? x.er : undefined }));
      feed = {
        posts: raw.slice(0, 120).map((p: any) => {
          const base = postFromFeed(p);
          return {
            id: base.id,
            url: p.postUrl,
            date: p.date,
            type: p.type,
            image: p.postImage,
            views: base.metrics.views?.value,
            likes: base.metrics.likes?.value,
            comments: base.metrics.comments?.value,
            shares: base.metrics.shares?.value,
            interactions: typeof p.interactions === "number" ? p.interactions : undefined,
            er: typeof p.er === "number" ? p.er : undefined,
            viewsER: typeof p.viewsER === "number" ? p.viewsER : undefined,
            grade: p.mainGrade,
            indexGrade: typeof p.indexGrade === "number" ? p.indexGrade : undefined,
            hashtags: p.hashTags ?? [],
            textLength: p.textLength,
            isAd: !!p.isAd,
          } satisfies FeedPost;
        }),
        hashtags: rows(summary.hashTags).slice(0, 40),
        types: rows(summary.types),
        textLength: rows(summary.textLength),
        from: from.toISOString(),
        to: to.toISOString(),
        fetchedAt: new Date().toISOString(),
      };
      await applyFeedToTrackedPosts(i.projectId, i.provider, feed.posts);
    }
    const collecting = d.communityStatus === "COLLECTING" && !(feed?.posts.length);
    const note = collecting ? "The statistics provider is collecting this account for the first time — posts and audience usually appear within a day. It will be refreshed automatically tomorrow." : null;
    await saveData(i, { stats, audience, cid: d.cid, ...(feed ? { feed } : {}), collecting, lastRapidAt: new Date().toISOString(), lastRapidError: note }, { lastSyncAt: new Date(), lastError: null });
    await emit({ type: "integration.updated", projectId: i.projectId, data: { id: i.id } });
    return { ok: true, posts: feed?.posts.length ?? 0 };
  } catch (e) {
    const msg = redactString((e as Error).message).slice(0, 300);
    if (e instanceof RapidStatsError) await recordRapidUse(userId, e.quota, "account_sync", { integrationId: i.id, automatic: opts.automatic, error: msg });
    log.warn(`linked account sync failed ${i.id}: ${msg}`);
    await saveData(i, { lastRapidError: msg }, { lastSyncAt: new Date(), lastError: msg });
    return { error: msg };
  }
}

/** Feed rows also refresh the metrics of matching posts you published and linked (free bonus, no extra request). */
async function applyFeedToTrackedPosts(projectId: string, platform: string, posts: FeedPost[]) {
  const targets = await prisma.postTarget.findMany({ where: { platform, status: "published", remoteId: { not: null }, post: { projectId } } });
  for (const t of targets) {
    const hit = posts.find((p) => p.id === t.remoteId || (p.url && t.remoteId && p.url.includes(t.remoteId)));
    if (!hit) continue;
    const m: Record<string, { value: number }> = {};
    for (const k of ["views", "likes", "comments", "shares"] as const) if (typeof hit[k] === "number") m[k] = { value: hit[k]! };
    if (!Object.keys(m).length) continue;
    const prev = Object.fromEntries(Object.entries((t.metrics ?? {}) as Record<string, unknown>).filter(([k]) => !k.startsWith("_")));
    await prisma.postTarget.update({ where: { id: t.id }, data: { metrics: { ...prev, ...m, _source: "Instagram Statistics API (RapidAPI, account feed)", _confidence: "exact" } as Prisma.InputJsonValue, metricsAt: new Date() } });
  }
}

/** Scheduler: refresh linked accounts on a budget-aware cadence (default weekly). */
export async function dispatchLinkedAccountSyncs() {
  const rows = await prisma.integration.findMany({ where: { kind: "social", status: { in: LINKED }, project: { paused: false } }, include: { project: { select: { ownerId: true } } }, take: 500 });
  let n = 0;
  for (const i of rows) {
    const s = await getRapidSettings(i.project.ownerId);
    const every = (dataOf(i).collecting ? 1 : (s.accountRefreshDays ?? 7)) * 86400_000;
    if (i.lastSyncAt && Date.now() - i.lastSyncAt.getTime() < every) continue;
    await syncLinkedAccount(i.id, { automatic: true });
    if (++n >= 20) break;
  }
  return { synced: n };
}

/** Free follower counts: TikTok video pages of tracked posts carry the creator's stats. */
export async function captureFreeFollowers(projectId: string, platform: string, handle: string, followers: number | undefined) {
  if (followers == null) return;
  const i = await prisma.integration.findFirst({ where: { projectId, provider: platform, kind: "social", status: { in: LINKED }, accountHandle: { equals: handle, mode: "insensitive" } } });
  if (i) await gauge(i, "followers", followers, platform);
}

const median = (xs: number[]) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

/** Everything the UI and the AI need to judge what performs: per linked account. */
export async function linkedAccountsAnalytics(project: Project) {
  const rows = await prisma.integration.findMany({ where: { projectId: project.id, kind: "social", status: { in: LINKED } }, orderBy: { createdAt: "asc" } });
  const out = [];
  for (const i of rows) {
    const a = dataOf(i);
    const snaps = await prisma.metricSnapshot.findMany({ where: { projectId: project.id, integrationId: i.id, metric: "followers" }, orderBy: { date: "asc" } });
    const followersSeries = snaps.map((s) => ({ date: s.date.toISOString().slice(0, 10), value: s.value }));
    const posts = a.feed?.posts ?? [];
    const rated = posts.filter((p) => typeof p.er === "number");
    const byGrade = [...posts].sort((x, y) => (y.indexGrade ?? -99) - (x.indexGrade ?? -99));
    const medianER = median(rated.map((p) => p.er!));
    const medianViews = median(posts.map((p) => p.views ?? NaN));
    out.push({
      integrationId: i.id,
      platform: i.provider,
      handle: i.accountHandle,
      name: i.accountName,
      avatar: i.accountAvatar,
      url: i.accountUrl,
      lastSyncAt: i.lastSyncAt,
      lastError: a.lastRapidError ?? i.lastError,
      stats: a.stats ?? null,
      audience: a.audience ?? null,
      followersSeries,
      followerChange: followersSeries.length >= 2 ? followersSeries[followersSeries.length - 1].value - followersSeries[0].value : null,
      feed: a.feed
        ? {
            fetchedAt: a.feed.fetchedAt,
            postCount: posts.length,
            medianER,
            medianViews,
            top: byGrade.slice(0, 8),
            bottom: byGrade.filter((p) => p.indexGrade != null).slice(-5).reverse(),
            recent: [...posts].sort((x, y) => Date.parse(y.date ?? "0") - Date.parse(x.date ?? "0")).slice(0, 30),
            types: [...a.feed.types].sort((x, y) => (y.grade ?? 0) - (x.grade ?? 0)),
            hashtags: [...a.feed.hashtags].filter((h) => h.count >= 2).sort((x, y) => (y.grade ?? 0) - (x.grade ?? 0)).slice(0, 15),
            textLength: [...a.feed.textLength].sort((x, y) => (y.grade ?? 0) - (x.grade ?? 0)),
          }
        : null,
    });
  }
  return { accounts: out };
}

export async function unlinkSocialAccount(userId: string, project: Project, integrationId: string) {
  const i = await prisma.integration.findFirst({ where: { id: integrationId, projectId: project.id, kind: "social" } });
  if (!i) throw notFound("Account");
  await prisma.integration.delete({ where: { id: i.id } });
  await audit({ userId, projectId: project.id, actor: "user", action: "integration.unlinked", target: i.provider, details: { handle: i.accountHandle } });
}
