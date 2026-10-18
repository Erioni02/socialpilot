import { ProviderError } from "@socialpilot/core";
import type { AudienceInsights, IntelOutcome, IntelPost, IntelProvider, MetricKey, MetricValue } from "./types";
import type { ParsedSocialUrl } from "./urls";

/**
 * "Instagram Statistics API" on RapidAPI (artemlipko): aggregated statistics for Instagram, TikTok and X accounts —
 * followers, engagement, quality score, fake followers, audience demographics — plus live Instagram post metrics
 * (Post by URL) and per-post metrics for any supported account via the Feed endpoint.
 *
 * Billing: the Basic plan is 50 requests/month with a hard limit (no overage). Paid plans charge overage, so callers
 * enforce their own monthly budget using the quota headers returned with every response.
 */

export const RAPID_STATS_HOST = "instagram-statistics-api.p.rapidapi.com";

export interface RapidQuota {
  limit?: number;
  remaining?: number;
  /** Seconds until the monthly counter resets. */
  resetInSec?: number;
  /** True on plans that stop at the limit instead of billing overage. */
  hardLimit: boolean;
}

export class RapidStatsError extends ProviderError {
  constructor(
    message: string,
    status?: number,
    public quota?: RapidQuota,
  ) {
    super("rapidapi", message, status, undefined, status === 429 || (status ?? 0) >= 500);
  }
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

function quotaFrom(h: Headers): RapidQuota {
  return {
    limit: num(h.get("x-ratelimit-requests-limit")),
    remaining: num(h.get("x-ratelimit-requests-remaining")),
    resetInSec: num(h.get("x-ratelimit-requests-reset")),
    hardLimit: h.has("x-ratelimit-rapid-free-plans-hard-limit-limit"),
  };
}

export async function rapidStatsGet<T = any>(key: string, path: string, params: Record<string, string>): Promise<{ data: T; quota: RapidQuota }> {
  const res = await fetch(`https://${RAPID_STATS_HOST}${path}?${new URLSearchParams(params)}`, {
    headers: { "x-rapidapi-host": RAPID_STATS_HOST, "x-rapidapi-key": key, accept: "application/json" },
    signal: AbortSignal.timeout(90_000),
  });
  const quota = quotaFrom(res.headers);
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* handled below */
  }
  if (res.status === 401 || res.status === 403) throw new RapidStatsError(body?.message?.includes("not subscribed") ? "Your RapidAPI key isn't subscribed to the Instagram Statistics API (subscribe to the Basic plan on RapidAPI)." : "RapidAPI rejected the key.", res.status, quota);
  if (res.status === 429) throw new RapidStatsError("RapidAPI monthly request limit reached for the Instagram Statistics API.", 429, quota);
  if (!res.ok) throw new RapidStatsError(body?.message ?? `HTTP ${res.status}`, res.status, quota);
  const code = body?.meta?.code;
  if (code && code !== 200) throw new RapidStatsError(body?.meta?.message ?? `API error ${code}`, code === 404 ? 404 : 400, quota);
  return { data: body?.data as T, quota };
}

// ───────────── Mapping ─────────────

const SOCIAL_TYPE: Record<string, "instagram" | "tiktok" | "x"> = { INST: "instagram", TT: "tiktok", TW: "x" };
const pctList = (rows: any[] | undefined, nameKey = "name", valueKey = "percent") =>
  (rows ?? []).map((r) => ({ name: String(r[nameKey] ?? r.category ?? ""), percent: Number(r[valueKey] ?? r.value ?? 0) })).filter((r) => r.name && Number.isFinite(r.percent));

/** Provider IDs are slugs ("united-states"); display names can be localized, so prettify the slug. */
const prettify = (r: { name: string; percent: number }) => ({ ...r, name: r.name.split("-").map((w, i) => (["of", "and", "the", "de"].includes(w) && i > 0 ? w : w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ") });

export function audienceFrom(d: any): AudienceInsights {
  return {
    qualityScore: num(d.qualityScore),
    fakeFollowersPct: num(d.pctFakeFollowers),
    avgEngagementRate: num(d.avgER),
    avgInteractions: num(d.avgInteractions),
    avgLikes: num(d.avgLikes),
    avgComments: num(d.avgComments),
    avgViews: num(d.avgViews) || num(d.avgVideoViews),
    followerGrowth180dPct: typeof d.pctUsersCount180d === "number" ? d.pctUsersCount180d : undefined,
    accountType: d.type || undefined,
    categories: (d.categories ?? []).slice(0, 8),
    country: d.countryCode || d.country || undefined,
    audienceTypes: pctList(d.membersTypes),
    reachability: pctList(d.membersReachability),
    countries: d.membersCountries?.length ? pctList(d.membersCountries.slice(0, 10), "category", "value").map(prettify) : pctList(d.countries).map(prettify),
    cities: pctList((d.membersCities ?? []).slice(0, 10), "category", "value").map(prettify),
    genders: pctList(d.genders),
    ages: pctList(d.ages),
    genderAge: (d.membersGendersAges?.data ?? []).map((r: any) => ({ age: String(r.category), m: Number(r.m ?? 0), f: Number(r.f ?? 0) })),
    brandSafety: d.brandSafety && typeof d.brandSafety === "object" ? Object.fromEntries(Object.entries(d.brandSafety).filter(([, v]) => typeof v === "number")) as Record<string, number> : undefined,
    mentions180d: { posts: num(d.fromMentions180d), accounts: num(d.fromMentionsCommunities180d), reach: num(d.fromMentionsViews180d) },
    demographicsCoverage: num(d.audienceSeverity),
    dataStatus: d.communityStatus,
    statsUpdatedAt: d.statisticsTimeUpdate ?? d.timeStatistics,
    postsUpdatedAt: d.timePostsLoaded,
  };
}

export function postFromFeed(p: any): IntelPost & { socialType?: string; er?: number; grade?: string } {
  return {
    id: String(p.postID ?? p.socialPostID ?? p.postUrl),
    url: p.postUrl,
    text: undefined,
    createdAt: p.date,
    thumbnailUrl: p.postImage,
    metrics: metricsOf([
      ["views", p.views || p.videoViews],
      ["likes", p.likes],
      ["comments", p.comments],
      ["shares", p.rePosts],
    ]),
    socialType: p.socialType,
    er: num(p.er),
    grade: p.mainGrade,
  };
}

function metricsOf(entries: [MetricKey, unknown][]): Partial<Record<MetricKey, MetricValue>> {
  const out: Partial<Record<MetricKey, MetricValue>> = {};
  for (const [k, v] of entries) {
    const n = num(v);
    if (n !== undefined) out[k] = { value: n };
  }
  return out;
}

// ───────────── API calls ─────────────

export const profileByUrl = (key: string, url: string, force = false) => rapidStatsGet(key, "/community", { url, ...(force ? { force: "true" } : {}) });
export const instagramPostByUrl = (key: string, postUrl: string) => rapidStatsGet(key, "/posts/one", { postUrl });
const ddmmyyyy = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
export const accountFeed = (key: string, cid: string, from: Date, to: Date) => rapidStatsGet<{ posts?: any[] }>(key, "/posts", { cid, from: ddmmyyyy(from), to: ddmmyyyy(to), type: "posts", sort: "-date", force: "true" });

const profileUrl = (u: ParsedSocialUrl) => (u.platform === "instagram" ? `https://www.instagram.com/${u.handle ?? u.externalId}` : u.platform === "tiktok" ? `https://www.tiktok.com/@${u.handle ?? u.externalId}` : `https://twitter.com/${u.handle ?? u.externalId}`);

/** Social Intel provider: account statistics + audience (1 request), or a live Instagram post (1 request). */
export const rapidStats: IntelProvider = {
  id: "rapidapi-stats",
  label: "Instagram Statistics API (RapidAPI)",
  paid: true,
  supports: (u) => u.kind === "profile" || u.platform === "instagram",
  async fetch(u, opts) {
    if (!opts.rapidapiKey) return { status: "error", message: "Add your RapidAPI key in Settings → Data sources first." };
    try {
      if (u.kind === "post") {
        const r = await instagramPostByUrl(opts.rapidapiKey, u.url);
        const m = metricsOf([
          ["views", r.data?.views],
          ["likes", r.data?.likes],
          ["comments", r.data?.comments],
        ]);
        return {
          status: "ok",
          quota: r.quota,
          result: {
            platform: "instagram",
            kind: "post",
            externalId: u.externalId,
            url: u.url,
            metrics: m,
            unavailable: [
              ...(m.views ? [] : [{ metric: "views", reason: "Instagram reports plays only for Reels/videos." }]),
              { metric: "shares / saves / reach", reason: "Only the account owner can see these (Insights)." },
            ],
            source: "rapidapi-stats",
            sourceLabel: "Instagram Statistics API (RapidAPI, live)",
            confidence: "exact",
            credits: 1,
          },
        };
      }
      const r = await profileByUrl(opts.rapidapiKey, profileUrl(u), true);
      const d = r.data;
      if (!d) return { status: "not_found", message: "The statistics API has no data for this account.", quota: r.quota };
      if (d.isClosed) return { status: "private", message: "This account is private.", quota: r.quota };
      const platform = SOCIAL_TYPE[d.socialType] ?? u.platform;
      const posts: IntelPost[] = (d.lastPosts ?? []).map((p: any) => ({ id: p.url, url: p.url, text: p.text, createdAt: p.date, thumbnailUrl: p.image, metrics: metricsOf([["likes", p.likes], ["comments", p.comments]]) }));
      const outcome: IntelOutcome = {
        status: d.communityStatus === "COLLECTING" && !d.usersCount ? "partial" : "ok",
        quota: r.quota,
        result: {
          platform,
          kind: "profile",
          externalId: u.externalId,
          url: d.url ?? u.url,
          title: d.name,
          profile: { handle: d.screenName ?? u.handle, displayName: d.name, avatarUrl: d.image, verified: !!d.verified, bio: d.description, private: !!d.isClosed },
          metrics: metricsOf([["followers", d.usersCount]]),
          posts,
          audience: audienceFrom(d),
          unavailable: [
            ...(d.communityStatus === "COLLECTING" ? [{ metric: "freshness", reason: "The provider is (re)collecting this account — some figures may be older or incomplete. Try again later for fresher data." }] : []),
            ...(num(d.audienceSeverity) !== undefined && num(d.audienceSeverity)! < 0.1 ? [{ metric: "demographics", reason: "Audience demographics are still being processed by the provider (low coverage)." }] : []),
          ],
          source: "rapidapi-stats",
          sourceLabel: "Instagram Statistics API (RapidAPI)",
          confidence: d.communityStatus === "DONE" ? "exact" : "partial",
          credits: 1,
        },
      };
      return outcome;
    } catch (e) {
      if (e instanceof RapidStatsError) return { status: e.status === 404 ? "not_found" : e.status === 429 ? "rate_limited" : "error", message: e.message, quota: e.quota };
      throw e;
    }
  },
};
