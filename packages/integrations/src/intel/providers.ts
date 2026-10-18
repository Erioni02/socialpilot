import { ProviderError, safeFetch } from "@socialpilot/core";
import { postpeerX, socialcrawlCredits, socialcrawlInstagram, socialcrawlTiktok } from "./credit-sources";
import type { IntelOutcome, IntelPost, IntelProvider, IntelResult, MetricKey, MetricValue, PaidOption } from "./types";
import type { ParsedSocialUrl } from "./urls";

/**
 * Data providers for public social metrics. Each is independent and replaceable:
 *  - Free providers read data the platform itself publishes to logged-out visitors (no login, no CAPTCHA solving,
 *    no proxy rotation, an honest User-Agent). They can stop working whenever a platform changes its pages.
 *  - Paid providers (SocialCrawl, PostPeer, Apify) run ONLY when the user explicitly approves a specific request,
 *    with a hard spend cap.
 */

// ───────────── Rate limiting (per provider, in-process) ─────────────
const nextSlot = new Map<string, number>();
async function throttle(key: string, minIntervalMs: number) {
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(key) ?? 0);
  nextSlot.set(key, at + minIntervalMs);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

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

// ───────────── TikTok: public video page ─────────────
/** TikTok rounds creator totals on public pages (e.g. 9,000,000); post stats are exact counters. */
const looksRounded = (n?: number) => n !== undefined && n >= 10_000 && n % 1000 === 0;

export const tiktokPublicPage: IntelProvider = {
  id: "tiktok-public-page",
  label: "TikTok public video page",
  paid: false,
  supports: (u) => u.platform === "tiktok" && u.kind === "post",
  async fetch(u) {
    await throttle("tiktok", 2500);
    const r = await safeFetch(u.url, { timeoutMs: 15000, maxBytes: 4_000_000, headers: { accept: "text/html", "accept-language": "en-US,en;q=0.9" } });
    if (r.status === 429) return { status: "rate_limited", message: "TikTok is rate-limiting requests. Try again in a few minutes." };
    if (r.status === 404) return { status: "not_found", message: "TikTok returned 404 — the video may be deleted." };
    const m = r.text().match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return { status: "unavailable", message: "TikTok did not return public data for this page (it may be showing a verification page). Try again later." };
    let detail: any;
    try {
      detail = JSON.parse(m[1])?.__DEFAULT_SCOPE__?.["webapp.video-detail"];
    } catch {
      return { status: "error", message: "Could not parse TikTok's page data." };
    }
    const sc = detail?.statusCode;
    const item = detail?.itemInfo?.itemStruct;
    if (sc === 10204 || sc === 10216) return { status: "not_found", message: "This video is unavailable or deleted." };
    if (sc === 10222) return { status: "private", message: "This video is private." };
    if (!item) return { status: "unavailable", message: `TikTok returned no video data (status ${sc ?? "unknown"}).` };
    const s = item.statsV2 ?? item.stats ?? {};
    const a = item.authorStatsV2 ?? item.authorStats ?? {};
    const author = item.author ?? {};
    const result: IntelResult = {
      platform: "tiktok",
      kind: "post",
      externalId: String(item.id ?? u.externalId),
      url: u.url,
      title: item.desc || undefined,
      createdAt: item.createTime ? new Date(Number(item.createTime) * 1000).toISOString() : undefined,
      profile: { handle: author.uniqueId, displayName: author.nickname, avatarUrl: author.avatarThumb ?? author.avatarMedium, verified: !!author.verified, private: !!author.privateAccount },
      metrics: metrics([
        ["views", s.playCount],
        ["likes", s.diggCount],
        ["comments", s.commentCount],
        ["shares", s.shareCount],
        ["saves", s.collectCount],
      ]),
      author: {
        profile: { handle: author.uniqueId, displayName: author.nickname, avatarUrl: author.avatarThumb, verified: !!author.verified, bio: author.signature },
        metrics: metrics([
          ["followers", a.followerCount, looksRounded(num(a.followerCount))],
          ["following", a.followingCount],
          ["total_likes", a.heartCount ?? a.heart, looksRounded(num(a.heartCount ?? a.heart))],
          ["posts", a.videoCount],
        ]),
      },
      unavailable: [{ metric: "reach / impressions / watch time", reason: "TikTok only shares these with the account owner." }],
      source: "tiktok-public-page",
      sourceLabel: "TikTok public video page (logged-out)",
      confidence: "exact",
    };
    return { status: "ok", result };
  },
};

/** TikTok profile pages are not served to non-browser clients (verification page), so profile stats come from videos. */
export const tiktokProfileUnavailable: IntelProvider = {
  id: "tiktok-profile-free",
  label: "TikTok public profile",
  paid: false,
  supports: (u) => u.platform === "tiktok" && u.kind === "profile",
  async fetch() {
    return {
      status: "unavailable",
      message:
        "TikTok doesn't serve profile pages to non-browser clients, so there is no free source for profile stats. Analyze any of this creator's video URLs instead — follower, likes and video counts are included with each video.",
    };
  },
};

// ───────────── X: public syndication endpoint (used by embedded posts) ─────────────
function syndicationToken(id: string) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

export const xSyndication: IntelProvider = {
  id: "x-syndication",
  label: "X embedded-post data",
  paid: false,
  supports: (u) => u.platform === "x" && u.kind === "post",
  async fetch(u) {
    await throttle("x", 1500);
    const r = await safeFetch(`https://cdn.syndication.twimg.com/tweet-result?id=${u.externalId}&lang=en&token=${syndicationToken(u.externalId)}`, { timeoutMs: 12000, maxBytes: 2_000_000 });
    if (r.status === 429) return { status: "rate_limited", message: "X is rate-limiting requests. Try again later." };
    if (r.status === 404) return { status: "not_found", message: "Post not found, deleted, or from a protected account." };
    let j: any;
    try {
      j = r.json();
    } catch {
      return { status: "unavailable", message: `X returned no post data (HTTP ${r.status}). The post may be protected, age-restricted or removed.` };
    }
    if (j?.__typename === "TweetTombstone" || j?.tombstone) return { status: "unavailable", message: j?.tombstone?.text?.text ?? "X does not show this post publicly." };
    if (!j?.id_str) return { status: "unavailable", message: "X returned no post data." };
    const result: IntelResult = {
      platform: "x",
      kind: "post",
      externalId: j.id_str,
      url: `https://x.com/${j.user?.screen_name ?? "i/web"}/status/${j.id_str}`,
      title: j.text,
      createdAt: j.created_at,
      profile: { handle: j.user?.screen_name, displayName: j.user?.name, avatarUrl: j.user?.profile_image_url_https, verified: !!(j.user?.is_blue_verified || j.user?.verified) },
      metrics: metrics([
        ["likes", j.favorite_count],
        ["comments", j.conversation_count],
      ]),
      unavailable: [
        { metric: "views", reason: "Not included in X's public embed data. Views require the paid X API." },
        { metric: "shares", reason: "Reposts aren't included in X's public embed data (paid X API only)." },
        { metric: "quotes", reason: "Quotes aren't included in X's public embed data (paid X API only)." },
      ],
      source: "x-syndication",
      sourceLabel: "X embedded-post data (public)",
      confidence: "partial",
    };
    return { status: "partial", result };
  },
};

export const xProfileUnavailable: IntelProvider = {
  id: "x-profile-free",
  label: "X public profile",
  paid: false,
  supports: (u) => u.platform === "x" && u.kind === "profile",
  async fetch() {
    return {
      status: "unavailable",
      message:
        "X no longer exposes profile stats (followers, posts) to logged-out clients for free. Analyze individual post URLs, or read your own account's post analytics through PostPeer (connect your X account to PostPeer first). SocialPilot never makes paid calls automatically.",
    };
  },
};

// ───────────── Instagram ─────────────
export const instagramUnavailable: IntelProvider = {
  id: "instagram-free",
  label: "Instagram public pages",
  paid: false,
  supports: (u) => u.platform === "instagram",
  async fetch(u) {
    return {
      status: "unavailable",
      message:
        "Instagram requires login to view post and profile data, and its old Basic Display API was discontinued, so there is no free logged-out source. For your own professional account, connect Instagram on the Integrations page (official API: insights, reach, likes, comments). For other public accounts you can run a paid lookup (SocialCrawl or Apify) with your approval.",
    };
  },
};

// ───────────── Paid, opt-in: Apify ─────────────
async function runApifyActor(actor: string, token: string, input: Record<string, unknown>, maxChargeUsd: number) {
  const params = new URLSearchParams({ timeout: "120", maxTotalChargeUsd: String(maxChargeUsd), maxItems: String(input.__maxItems ?? 30) });
  delete input.__maxItems;
  const res = await fetch(`https://api.apify.com/v2/acts/${actor.replace("/", "~")}/run-sync-get-dataset-items?${params}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(150_000),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try {
      msg = JSON.parse(text)?.error?.message ?? msg;
    } catch {
      /* keep */
    }
    throw new ProviderError("apify", `${msg} (HTTP ${res.status})`, res.status, undefined, res.status >= 500);
  }
  return JSON.parse(text) as any[];
}

const igPost = (p: any): IntelPost => ({
  id: p.shortCode ?? p.id,
  url: p.url ?? `https://www.instagram.com/p/${p.shortCode}/`,
  text: p.caption,
  createdAt: p.timestamp,
  thumbnailUrl: p.displayUrl,
  metrics: metrics([
    ["likes", p.likesCount >= 0 ? p.likesCount : undefined],
    ["comments", p.commentsCount],
    ["views", p.videoPlayCount ?? p.videoViewCount],
  ]),
});

export const apifyInstagram: IntelProvider = {
  id: "apify-instagram",
  label: "Apify Instagram Scraper (paid, opt-in)",
  paid: true,
  supports: (u) => u.platform === "instagram",
  async fetch(u, opts) {
    if (!opts.apifyToken) return { status: "error", message: "Add an Apify API token in Settings → Data sources first." };
    const items = await runApifyActor(
      "apify/instagram-scraper",
      opts.apifyToken,
      { directUrls: [u.url], resultsType: u.kind === "profile" ? "details" : "posts", resultsLimit: u.kind === "profile" ? 12 : 1, addParentData: false, __maxItems: u.kind === "profile" ? 1 : 1 },
      opts.maxChargeUsd ?? 0.1,
    );
    const first = items[0];
    if (!first || first.error) return { status: first?.error === "not_found" ? "not_found" : "unavailable", message: first?.errorDescription ?? first?.error ?? "Apify returned no data for this URL." };
    if (u.kind === "profile") {
      if (first.private) return { status: "private", message: "This Instagram account is private." };
      const posts = (first.latestPosts ?? []).map(igPost);
      return {
        status: "ok",
        result: {
          platform: "instagram",
          kind: "profile",
          externalId: u.externalId,
          url: u.url,
          title: first.fullName,
          profile: { handle: first.username, displayName: first.fullName, avatarUrl: first.profilePicUrl, verified: !!first.verified, bio: first.biography, private: !!first.private },
          metrics: metrics([
            ["followers", first.followersCount],
            ["following", first.followsCount],
            ["posts", first.postsCount],
          ]),
          posts,
          unavailable: [{ metric: "reach / impressions / saves / demographics", reason: "Only the account owner can see these (connect your professional account)." }],
          source: "apify-instagram",
          sourceLabel: "Apify Instagram Scraper (paid, approved by you)",
          confidence: "exact",
        },
      };
    }
    const p = igPost(first);
    return {
      status: "ok",
      result: {
        platform: "instagram",
        kind: "post",
        externalId: u.externalId,
        url: u.url,
        title: first.caption,
        createdAt: first.timestamp,
        profile: { handle: first.ownerUsername, displayName: first.ownerFullName },
        metrics: p.metrics,
        unavailable: [
          ...(first.likesCount === -1 ? [{ metric: "likes", reason: "The creator hides like counts." }] : []),
          ...(p.metrics.views ? [] : [{ metric: "views", reason: "Instagram only reports plays for videos/Reels." }]),
          { metric: "reach / saves / shares", reason: "Only the account owner can see these." },
        ],
        source: "apify-instagram",
        sourceLabel: "Apify Instagram Scraper (paid, approved by you)",
        confidence: "exact",
      },
    };
  },
};

export const apifyTiktok: IntelProvider = {
  id: "apify-tiktok",
  label: "Apify TikTok Scraper (paid, opt-in)",
  paid: true,
  supports: (u) => u.platform === "tiktok" && u.kind === "profile",
  async fetch(u, opts) {
    if (!opts.apifyToken) return { status: "error", message: "Add an Apify API token in Settings → Data sources first." };
    const items = await runApifyActor("clockworks/tiktok-scraper", opts.apifyToken, { profiles: [u.handle], resultsPerPage: 20, profileScrapeSections: ["videos"], profileSorting: "latest", __maxItems: 20 }, opts.maxChargeUsd ?? 0.1);
    const errItem = items.find((i) => i.error || i.errorCode);
    if (!items.length || (errItem && items.length === 1)) {
      const code = errItem?.errorCode;
      return { status: code === "PROFILE_PRIVATE" ? "private" : code === "NOT_FOUND" ? "not_found" : "unavailable", message: errItem?.error ?? "Apify returned no data for this profile." };
    }
    const vids = items.filter((i) => !i.error);
    const meta = vids[0]?.authorMeta ?? {};
    const posts: IntelPost[] = vids.map((v) => ({
      id: String(v.id),
      url: v.webVideoUrl,
      text: v.text,
      createdAt: v.createTimeISO,
      thumbnailUrl: v.videoMeta?.coverUrl,
      metrics: metrics([
        ["views", v.playCount],
        ["likes", v.diggCount],
        ["comments", v.commentCount],
        ["shares", v.shareCount],
        ["saves", v.collectCount],
      ]),
    }));
    return {
      status: "ok",
      result: {
        platform: "tiktok",
        kind: "profile",
        externalId: u.externalId,
        url: u.url,
        title: meta.nickName,
        profile: { handle: meta.name, displayName: meta.nickName, avatarUrl: meta.avatar, verified: !!meta.verified, bio: meta.signature, private: !!meta.privateAccount },
        metrics: metrics([
          ["followers", meta.fans],
          ["following", meta.following],
          ["total_likes", meta.heart],
          ["posts", meta.video],
        ]),
        posts,
        unavailable: [{ metric: "reach / watch time / demographics", reason: "Only the account owner can see these." }],
        source: "apify-tiktok",
        sourceLabel: "Apify TikTok Scraper (paid, approved by you)",
        confidence: "exact",
      },
    };
  },
};

export const FREE_PROVIDERS: IntelProvider[] = [tiktokPublicPage, tiktokProfileUnavailable, xSyndication, xProfileUnavailable, instagramUnavailable];
export const PAID_PROVIDERS: IntelProvider[] = [socialcrawlTiktok, socialcrawlInstagram, postpeerX, apifyInstagram, apifyTiktok];
export const PAID_PROVIDER_IDS = ["socialcrawl-tiktok", "socialcrawl-instagram", "postpeer-x", "apify-instagram", "apify-tiktok"] as const;

/**
 * Paid, opt-in sources that could fill in what the free source couldn't. Offered to the user — never run without an
 * explicit per-request confirmation.
 */
export function paidOptionsFor(u: ParsedSocialUrl, outcome: IntelOutcome): PaidOption[] {
  if (outcome.status === "ok" || outcome.status === "not_found" || outcome.status === "private") return [];
  const who = u.handle ?? u.externalId;
  if (u.platform === "tiktok") {
    return u.kind === "profile"
      ? [
          { provider: "socialcrawl-tiktok", requires: "socialcrawl", label: "SocialCrawl", estimatedCredits: socialcrawlCredits(u), note: `Exact profile stats + 10 recent videos for @${who}` },
          { provider: "apify-tiktok", requires: "apify", label: "Apify TikTok Scraper", estimatedCostUsd: 0.06, note: `Profile + up to 20 recent videos for @${who}` },
        ]
      : [{ provider: "socialcrawl-tiktok", requires: "socialcrawl", label: "SocialCrawl", estimatedCredits: 1, note: "Views, likes, comments, shares and saves for this video" }];
  }
  if (u.platform === "instagram") {
    return u.kind === "profile"
      ? [
          { provider: "socialcrawl-instagram", requires: "socialcrawl", label: "SocialCrawl", estimatedCredits: socialcrawlCredits(u), note: `Exact followers, posts + 12 recent posts for @${who}` },
          { provider: "apify-instagram", requires: "apify", label: "Apify Instagram Scraper", estimatedCostUsd: 0.06, note: `Profile details + up to 12 recent posts for @${who}` },
        ]
      : [
          { provider: "socialcrawl-instagram", requires: "socialcrawl", label: "SocialCrawl", estimatedCredits: 1, note: "Likes, comments, views (Reels) and caption for this post" },
          { provider: "apify-instagram", requires: "apify", label: "Apify Instagram Scraper", estimatedCostUsd: 0.01, note: "Likes, comments, views (Reels), caption and timestamp for this post" },
        ];
  }
  return u.kind === "profile"
    ? [{ provider: "postpeer-x", requires: "postpeer", label: "PostPeer", estimatedCredits: 1, note: `Impressions, likes and replies for @${who}'s recent posts (only if @${who} is your account connected in PostPeer)` }]
    : [{ provider: "postpeer-x", requires: "postpeer", label: "PostPeer", estimatedCredits: 1, note: "Impressions, likes and replies for this post, read through your X account connected in PostPeer" }];
}
