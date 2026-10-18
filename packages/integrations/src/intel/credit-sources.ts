import { ProviderError } from "@socialpilot/core";
import type { IntelOutcome, IntelPost, IntelProfile, IntelProvider, MetricKey, MetricValue } from "./types";
import type { ParsedSocialUrl } from "./urls";

/**
 * Credit-based data APIs. Both are paid per call, so they run ONLY when the user confirms a specific request
 * (never from the watchlist scheduler):
 *  - SocialCrawl (socialcrawl.dev): public TikTok + Instagram profiles/posts. 1 credit per call; cache hits and failed
 *    calls are refunded by SocialCrawl.
 *  - PostPeer (postpeer.dev): analytics for X accounts YOU connected through PostPeer's OAuth. 1 credit per call.
 *    It cannot look up arbitrary public accounts.
 */

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
function metrics(entries: [MetricKey, unknown, boolean?][]): Partial<Record<MetricKey, MetricValue>> {
  const out: Partial<Record<MetricKey, MetricValue>> = {};
  for (const [k, v, approx] of entries) {
    const n = num(v);
    if (n !== undefined) out[k] = approx ? { value: n, approx: true } : { value: n };
  }
  return out;
}

// ───────────── SocialCrawl ─────────────
export const SOCIALCRAWL_BASE = "https://www.socialcrawl.dev/v1";

export class SocialCrawlError extends ProviderError {
  constructor(
    message: string,
    status: number,
    public type?: string,
    public reason?: string,
  ) {
    super("socialcrawl", message, status, undefined, ["RATE_LIMITED", "CONCURRENCY_LIMIT", "UPSTREAM_ERROR", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR"].includes(type ?? ""));
  }
}

export async function socialcrawlGet<T = any>(key: string, path: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${SOCIALCRAWL_BASE}${path}${qs ? `?${qs}` : ""}`, { headers: { "x-api-key": key, accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new SocialCrawlError(`SocialCrawl returned an unreadable response (HTTP ${res.status}).`, res.status);
  }
  if (!res.ok || body?.success === false) {
    const e = body?.error ?? {};
    const msg = e.type === "INVALID_API_KEY" || e.type === "MISSING_API_KEY" ? "SocialCrawl rejected the API key." : e.type === "INSUFFICIENT_CREDITS" ? "Your SocialCrawl credits are used up." : (e.message ?? `HTTP ${res.status}`);
    throw new SocialCrawlError(msg, e.status ?? res.status, e.type, e.details?.reason);
  }
  return { data: body.data as T, creditsUsed: num(body.credits_used) ?? 0, creditsRemaining: num(body.credits_remaining), cached: !!body.cached };
}

/** Free call. */
export async function socialcrawlBalance(key: string) {
  const r = await socialcrawlGet<{ balance: number }>(key, "/credits/balance");
  return r.data.balance;
}

const scProfile = (a: any): IntelProfile => ({ handle: a?.username, displayName: a?.display_name ?? undefined, avatarUrl: a?.avatar_url ?? undefined, verified: a?.verified ?? undefined, bio: a?.bio ?? undefined, private: a?.private ?? undefined });
const scAuthorMetrics = (a: any) => {
  const approx = !!a?.ext?.followers_approximate;
  return metrics([
    ["followers", a?.followers, approx],
    ["following", a?.following],
    ["posts", a?.posts_count],
    ["total_likes", a?.likes_count],
  ]);
};
const scPostMetrics = (p: any) =>
  metrics([
    ["views", p?.engagement?.views],
    ["likes", p?.engagement?.likes],
    ["comments", p?.engagement?.comments],
    ["shares", p?.engagement?.shares],
    ["saves", p?.engagement?.saves],
  ]);
const scPost = (p: any): IntelPost => ({
  id: String(p.id),
  url: p.url,
  text: p.content?.text ?? undefined,
  createdAt: p.published_at ?? undefined,
  thumbnailUrl: p.content?.thumbnail_url ?? undefined,
  metrics: scPostMetrics(p),
});

function scFailure(e: unknown, u: ParsedSocialUrl): IntelOutcome | null {
  if (!(e instanceof SocialCrawlError)) return null;
  if (e.status === 404) {
    if (e.reason === "account_private") return { status: "private", message: `This ${u.platform === "tiktok" ? "TikTok" : "Instagram"} account is private.` };
    return { status: "not_found", message: e.reason === "account_gone" ? "This account no longer exists." : "SocialCrawl couldn't find this (deleted or never public). No credits are charged for not-found results." };
  }
  if (e.status === 429) return { status: "rate_limited", message: "SocialCrawl is rate limiting requests. Try again in a minute." };
  return { status: "error", message: `SocialCrawl: ${e.message}` };
}

const PLATFORM_NAME = { tiktok: "TikTok", instagram: "Instagram", x: "X" } as const;

function socialcrawlProvider(platform: "tiktok" | "instagram"): IntelProvider {
  const label = `SocialCrawl (${PLATFORM_NAME[platform]})`;
  return {
    id: `socialcrawl-${platform}`,
    label: `${label} — paid credits, opt-in`,
    paid: true,
    supports: (u) => u.platform === platform,
    async fetch(u, opts) {
      if (!opts.socialcrawlKey) return { status: "error", message: "Add your SocialCrawl API key in Settings → Data sources first." };
      try {
        if (u.kind === "post") {
          const r = await socialcrawlGet(opts.socialcrawlKey, `/${platform}/post`, { url: u.url, ...(platform === "tiktok" ? { trim: "true" } : {}) });
          const p = r.data.post;
          if (!p) return { status: "not_found", message: "SocialCrawl returned no data for this post." };
          const m = scPostMetrics(p);
          const isVideo = platform === "tiktok" || m.views !== undefined;
          return {
            status: "ok",
            result: {
              platform,
              kind: "post",
              externalId: u.externalId,
              url: p.url ?? u.url,
              title: p.content?.text?.slice(0, 200),
              createdAt: p.published_at ?? undefined,
              profile: scProfile(p.author),
              metrics: m,
              unavailable: [
                ...(isVideo ? [] : [{ metric: "views", reason: "Instagram only reports plays for videos and Reels." }]),
                ...(m.shares === undefined ? [{ metric: "shares", reason: `${PLATFORM_NAME[platform]} doesn't expose share counts publicly for this post.` }] : []),
                { metric: "reach / watch time / demographics", reason: "Only the account owner can see these." },
              ],
              source: `socialcrawl-${platform}`,
              sourceLabel: `${label} (paid, approved by you)`,
              confidence: "exact",
              credits: r.creditsUsed,
            },
          };
        }
        const handle = u.handle ?? u.externalId;
        const prof = await socialcrawlGet(opts.socialcrawlKey, `/${platform}/profile`, { handle });
        const a = prof.data.author;
        if (!a) return { status: "not_found", message: "SocialCrawl returned no profile data." };
        let posts: IntelPost[] = [];
        let credits = prof.creditsUsed;
        let postsNote: string | undefined;
        if (!a.private) {
          try {
            const list = await socialcrawlGet(opts.socialcrawlKey, platform === "tiktok" ? "/tiktok/profile/videos" : "/instagram/profile/posts", { handle });
            posts = (list.data.items ?? []).map((i: any) => i.post).filter(Boolean).map(scPost);
            credits += list.creditsUsed;
          } catch (e) {
            postsNote = `Recent posts couldn't be loaded: ${(e as Error).message}`;
          }
        }
        const approx = !!a.ext?.followers_approximate;
        return {
          status: postsNote ? "partial" : "ok",
          result: {
            platform,
            kind: "profile",
            externalId: u.externalId,
            url: u.url,
            title: a.display_name ?? a.username,
            profile: scProfile(a),
            metrics: scAuthorMetrics(a),
            posts,
            unavailable: [
              ...(postsNote ? [{ metric: "recent posts", reason: postsNote }] : []),
              ...(a.private ? [{ metric: "recent posts", reason: "The account is private." }] : []),
              { metric: "reach / impressions / demographics", reason: "Only the account owner can see these." },
            ],
            source: `socialcrawl-${platform}`,
            sourceLabel: `${label} (paid, approved by you)`,
            confidence: approx ? "rounded" : "exact",
            credits,
          },
        };
      } catch (e) {
        const f = scFailure(e, u);
        if (f) return f;
        throw e;
      }
    },
  };
}

export const socialcrawlTiktok = socialcrawlProvider("tiktok");
export const socialcrawlInstagram = socialcrawlProvider("instagram");

/** Credits a SocialCrawl request will use at most (profile + one page of posts, or one post). */
export const socialcrawlCredits = (u: ParsedSocialUrl) => (u.kind === "profile" ? 2 : 1);

// ───────────── PostPeer (X analytics for accounts connected through PostPeer) ─────────────
export const POSTPEER_BASE = "https://api.postpeer.dev/v1";

export async function postpeerGet<T = any>(key: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${POSTPEER_BASE}${path}${qs ? `?${qs}` : ""}`, { headers: { "x-access-key": key, accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* handled below */
  }
  if (!res.ok || body?.success === false) {
    const msg = res.status === 401 || res.status === 403 ? "PostPeer rejected the API key." : res.status === 402 ? "Your PostPeer credits are used up." : (body?.error?.message ?? body?.message ?? body?.error ?? `HTTP ${res.status}`);
    throw new ProviderError("postpeer", typeof msg === "string" ? msg : JSON.stringify(msg).slice(0, 300), res.status, undefined, res.status >= 500 || res.status === 429);
  }
  return body as T;
}

export interface PostPeerAccount {
  id: string;
  platform: string;
  platformUserId: string | null;
  displayName: string | null;
  imageUrl: string | null;
}

/** Free: lists the X accounts connected in PostPeer. */
export async function postpeerAccounts(key: string, platform = "twitter"): Promise<PostPeerAccount[]> {
  const r = await postpeerGet<{ integrations?: PostPeerAccount[] }>(key, "/connect/integrations", { platform, limit: "100" });
  return r.integrations ?? [];
}

/** Free: OAuth URL to connect an X account to PostPeer. */
export async function postpeerConnectUrl(key: string, redirectUri?: string): Promise<string> {
  const r = await postpeerGet<{ url: string }>(key, "/connect/twitter", redirectUri ? { redirectUri } : {});
  if (!r.url) throw new ProviderError("postpeer", "PostPeer did not return a connect URL.");
  return r.url;
}

/** Free: remaining PostPeer credits (monthly + purchased). */
export async function postpeerBalance(key: string) {
  const r = await postpeerGet<{ balance?: { monthly?: { remaining?: number }; purchased?: { remaining?: number } } }>(key, "/usage");
  return (r.balance?.monthly?.remaining ?? 0) + (r.balance?.purchased?.remaining ?? 0);
}

const ppMetrics = (m: any) =>
  metrics([
    ["views", m?.impressions ?? m?.views],
    ["likes", m?.likes],
    ["comments", m?.comments],
    ["shares", m?.shares],
    ["saves", m?.saves],
  ]);

const handleOf = (a: PostPeerAccount) => (a.displayName ?? "").replace(/^@/, "").toLowerCase();

export const postpeerX: IntelProvider = {
  id: "postpeer-x",
  label: "PostPeer X analytics — paid credits, opt-in",
  paid: true,
  supports: (u) => u.platform === "x",
  async fetch(u, opts) {
    if (!opts.postpeerKey) return { status: "error", message: "Add your PostPeer API key in Settings → Data sources first." };
    const accounts = await postpeerAccounts(opts.postpeerKey);
    if (!accounts.length) return { status: "unavailable", message: "Connect your X account to PostPeer first (Social Intel → PostPeer → Connect X). PostPeer only reads analytics for accounts you connect." };
    if (u.kind === "profile") {
      const acct = accounts.find((a) => handleOf(a) === u.externalId.toLowerCase());
      if (!acct) return { status: "unavailable", message: `@${u.handle ?? u.externalId} isn't connected in PostPeer. PostPeer can only read accounts you connected (${accounts.map((a) => a.displayName).join(", ")}).` };
      const r = await postpeerGet<any>(opts.postpeerKey, "/analytics", { source: "platform", platform: "twitter", accountId: acct.id, limit: "20", sortBy: "date", order: "desc" });
      const posts: IntelPost[] = (r.posts ?? []).map((p: any) => {
        const tw = (p.platforms ?? []).find((x: any) => x.platform === "twitter") ?? {};
        const id = String(tw.platformPostId ?? p.postId ?? "");
        return { id, url: tw.platformPostUrl ?? `https://x.com/${u.externalId}/status/${id}`, text: p.content ?? undefined, createdAt: p.publishedAt ?? undefined, metrics: ppMetrics(p.aggregated ?? tw.metrics) };
      });
      return {
        status: "ok",
        result: {
          platform: "x",
          kind: "profile",
          externalId: u.externalId,
          url: u.url,
          title: acct.displayName ?? undefined,
          profile: { handle: handleOf(acct), displayName: acct.displayName ?? undefined, avatarUrl: acct.imageUrl ?? undefined },
          metrics: {},
          posts,
          unavailable: [{ metric: "followers / following", reason: "PostPeer analytics report per-post metrics, not follower counts." }],
          source: "postpeer-x",
          sourceLabel: "PostPeer X analytics (your connected account, approved by you)",
          confidence: "exact",
          credits: 1,
        },
      };
    }
    // Post: resolved through your connected account (PostPeer's direct platform lookup).
    const acct = accounts.find((a) => u.handle && handleOf(a) === u.handle.toLowerCase()) ?? accounts[0];
    const r = await postpeerGet<any>(opts.postpeerKey, "/analytics", { postId: u.externalId, platform: "twitter", accountId: acct.id });
    const p = r.post;
    if (!p) return { status: "not_found", message: "PostPeer returned no analytics for this post." };
    const tw = (p.platforms ?? []).find((x: any) => x.platform === "twitter") ?? {};
    const m = ppMetrics(p.aggregated ?? tw.metrics);
    return {
      status: "ok",
      result: {
        platform: "x",
        kind: "post",
        externalId: u.externalId,
        url: tw.platformPostUrl ?? u.url,
        title: p.content?.slice(0, 200) ?? undefined,
        createdAt: p.publishedAt ?? undefined,
        profile: u.handle ? { handle: u.handle } : undefined,
        metrics: m,
        unavailable: [
          ...(m.shares === undefined ? [{ metric: "shares", reason: "PostPeer doesn't report reposts for X." }] : []),
          { metric: "quotes", reason: "Not included in PostPeer analytics." },
        ],
        source: "postpeer-x",
        sourceLabel: `PostPeer X analytics via ${acct.displayName ?? "your connected account"} (approved by you)`,
        confidence: "exact",
        credits: 1,
      },
    };
  },
};
