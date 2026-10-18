import { XMLParser } from "fast-xml-parser";
import { ProviderError } from "@socialpilot/core";
import { socialcrawlGet } from "./intel/credit-sources";

/**
 * Social Pulse: what is rising on social media right now.
 *
 * Free sources are public, documented, logged-out endpoints that platforms publish for exactly this purpose
 * (no login, no proxies, no CAPTCHA solving, an honest User-Agent):
 *  - Bluesky trending topics (public AppView API)
 *  - Mastodon trends: statuses, hashtags, links (instance API) + hashtag timelines for project keywords
 *  - Google Trends "Trending now" RSS
 * TikTok / Instagram trending feeds have no free logged-out source; they come from SocialCrawl only when the user
 * opted in with a daily credit cap.
 */

export type PulsePlatform = "bluesky" | "mastodon" | "google_trends" | "tiktok" | "instagram";
export type PulseKind = "post" | "topic" | "hashtag" | "link" | "search";

export interface PulseItem {
  platform: PulsePlatform;
  kind: PulseKind;
  externalId: string;
  title: string;
  url: string;
  summary: string;
  author?: string;
  publishedAt: Date;
  /** Real engagement signal from the source (likes+reposts, hashtag uses, plays, search volume). */
  score?: number;
  comments?: number;
  tags: string[];
  raw: Record<string, unknown>;
}

const UA = "SocialPilot/1.0 (+https://github.com/Erioni02/socialpilot; trend monitoring)";

async function getJson<T = any>(source: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new ProviderError(source, `HTTP ${res.status}`, res.status, undefined, res.status === 429 || res.status >= 500);
  return (await res.json()) as T;
}

const stripHtml = (h: string) =>
  h
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

// ───────────── Bluesky ─────────────
export async function fetchBlueskyTrending(limit = 25): Promise<PulseItem[]> {
  const j = await getJson("bluesky", `https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrendingTopics?limit=${limit}`);
  const now = new Date();
  return (j.topics ?? []).map((t: any, i: number) => ({
    platform: "bluesky",
    kind: "topic",
    externalId: `topic:${String(t.topic ?? t.displayName).toLowerCase().slice(0, 200)}`,
    title: t.displayName ?? t.topic,
    url: t.link?.startsWith("http") ? t.link : `https://bsky.app${t.link ?? "/"}`,
    summary: t.description ?? "",
    publishedAt: now,
    // Bluesky returns topics in rank order without counts: keep the rank as the signal (higher = better).
    score: limit - i,
    tags: [],
    raw: { rank: i + 1, ...t },
  }));
}

// ───────────── Mastodon ─────────────
const masto = (instance: string) => `https://${instance.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}`;

function mastoStatus(s: any, platformTag: string[] = []): PulseItem {
  const text = stripHtml(s.content ?? "") || (s.card?.title ?? "");
  return {
    platform: "mastodon",
    kind: "post",
    externalId: `status:${s.uri ?? s.url ?? s.id}`.slice(0, 500),
    title: text.slice(0, 180) || `Post by @${s.account?.acct}`,
    url: s.url ?? s.uri,
    summary: text.slice(0, 1000),
    author: s.account?.acct,
    publishedAt: new Date(s.created_at ?? Date.now()),
    score: n(s.favourites_count) + n(s.reblogs_count) * 2,
    comments: n(s.replies_count),
    tags: [...(s.tags ?? []).map((t: any) => String(t.name).toLowerCase()), ...platformTag].slice(0, 10),
    raw: { favourites: s.favourites_count, reblogs: s.reblogs_count, replies: s.replies_count, media: (s.media_attachments ?? []).map((m: any) => m.preview_url).slice(0, 2) },
  };
}

export async function fetchMastodonTrends(instance = "mastodon.social"): Promise<PulseItem[]> {
  const base = masto(instance);
  const [statuses, tags, links] = await Promise.all([
    getJson<any[]>("mastodon", `${base}/api/v1/trends/statuses?limit=20`).catch(() => []),
    getJson<any[]>("mastodon", `${base}/api/v1/trends/tags?limit=15`).catch(() => []),
    getJson<any[]>("mastodon", `${base}/api/v1/trends/links?limit=15`).catch(() => []),
  ]);
  const now = new Date();
  const out: PulseItem[] = statuses.map((s) => mastoStatus(s));
  for (const t of tags) {
    const today = t.history?.[0] ?? {};
    out.push({
      platform: "mastodon",
      kind: "hashtag",
      externalId: `tag:${String(t.name).toLowerCase()}`,
      title: `#${t.name}`,
      url: t.url,
      summary: `${n(today.uses)} posts by ${n(today.accounts)} people today`,
      publishedAt: now,
      score: n(today.uses),
      tags: [String(t.name).toLowerCase()],
      raw: { history: t.history },
    });
  }
  for (const l of links) {
    const uses = (l.history ?? []).slice(0, 1).reduce((s: number, h: any) => s + n(h.uses), 0);
    out.push({
      platform: "mastodon",
      kind: "link",
      externalId: `link:${l.url}`.slice(0, 500),
      title: l.title || l.url,
      url: l.url,
      summary: l.description ?? "",
      author: l.provider_name || undefined,
      publishedAt: l.published_at ? new Date(l.published_at) : now,
      score: uses,
      tags: [],
      raw: { provider: l.provider_name, image: l.image, history: l.history },
    });
  }
  if (!out.length) throw new ProviderError("mastodon", "Mastodon returned no trends");
  return out;
}

/** Recent public posts for a hashtag (used for project keywords). */
export async function fetchMastodonTag(tag: string, instance = "mastodon.social"): Promise<PulseItem[]> {
  const clean = tag.replace(/[^\p{L}\p{N}_]/gu, "");
  if (!clean) return [];
  const statuses = await getJson<any[]>("mastodon", `${masto(instance)}/api/v1/timelines/tag/${encodeURIComponent(clean)}?limit=20`);
  return statuses.filter((s) => !s.sensitive).map((s) => mastoStatus(s, [clean.toLowerCase()]));
}

// ───────────── Google Trends ─────────────
const parseTraffic = (v: unknown) => {
  const m = String(v ?? "").match(/([\d.,]+)\s*([KkMm])?\+?/);
  if (!m) return 0;
  const base = Number(m[1].replace(/,/g, ""));
  return base * (m[2]?.toLowerCase() === "m" ? 1e6 : m[2]?.toLowerCase() === "k" ? 1e3 : 1);
};

export async function fetchGoogleTrends(geo = "US"): Promise<PulseItem[]> {
  const res = await fetch(`https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new ProviderError("google_trends", `HTTP ${res.status}`, res.status);
  const xml = new XMLParser({ ignoreAttributes: true }).parse(await res.text());
  const items = [xml?.rss?.channel?.item ?? []].flat();
  return items.map((it: any) => {
    const news = [it["ht:news_item"] ?? []].flat();
    const first = news[0] ?? {};
    return {
      platform: "google_trends",
      kind: "search",
      externalId: `${geo}:${String(it.title).toLowerCase()}`.slice(0, 500),
      title: String(it.title),
      url: first["ht:news_item_url"] || `https://trends.google.com/trends/explore?geo=${geo}&q=${encodeURIComponent(it.title)}`,
      summary: [it["ht:approx_traffic"] ? `${it["ht:approx_traffic"]} searches` : "", first["ht:news_item_title"] ? `· ${first["ht:news_item_title"]}` : ""].join(" ").trim(),
      author: first["ht:news_item_source"],
      publishedAt: it.pubDate ? new Date(it.pubDate) : new Date(),
      score: parseTraffic(it["ht:approx_traffic"]),
      tags: [],
      raw: { geo, traffic: it["ht:approx_traffic"], picture: it["ht:picture"], news: news.slice(0, 3) },
    } satisfies PulseItem;
  });
}

// ───────────── Paid (opt-in): SocialCrawl trending feeds ─────────────
/** Credits per call, from SocialCrawl's catalogue. */
export const SOCIALCRAWL_TRENDING_CREDITS = { tiktok: 5, instagram: 5 } as const;

export async function fetchSocialCrawlTrending(key: string, platform: "tiktok" | "instagram", region = "US"): Promise<{ items: PulseItem[]; credits: number }> {
  const r = await socialcrawlGet(key, platform === "tiktok" ? "/tiktok/trending" : "/instagram/reels/trending", platform === "tiktok" ? { region } : {});
  const rows: any[] = r.data?.items ?? r.data?.posts ?? [];
  const items: PulseItem[] = rows
    .map((row) => row.post ?? row)
    .filter((p) => p?.url)
    .map((p) => ({
      platform,
      kind: "post",
      externalId: `post:${p.id ?? p.url}`.slice(0, 500),
      title: (p.content?.text ?? "").slice(0, 180) || `${platform === "tiktok" ? "TikTok" : "Reel"} by @${p.author?.username ?? "?"}`,
      url: p.url,
      summary: (p.content?.text ?? "").slice(0, 1000),
      author: p.author?.username,
      publishedAt: p.published_at ? new Date(p.published_at) : new Date(),
      score: n(p.engagement?.views) || n(p.engagement?.likes),
      comments: n(p.engagement?.comments),
      tags: (String(p.content?.text ?? "").match(/#[\p{L}\p{N}_]+/gu) ?? []).map((t) => t.slice(1).toLowerCase()).slice(0, 10),
      raw: { engagement: p.engagement, thumbnail: p.content?.thumbnail_url },
    }));
  return { items, credits: r.creditsUsed };
}
