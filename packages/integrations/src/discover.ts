import { XMLParser } from "fast-xml-parser";
import { providerFetch, safeFetch } from "@socialpilot/core";

export interface SourceItem {
  externalId: string;
  title: string;
  url: string;
  summary: string;
  author?: string;
  publishedAt: Date;
  score?: number;
  comments?: number;
  tags: string[];
  raw: Record<string, unknown>;
}

const strip = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const idx = i++;
        try {
          out[idx] = await fn(items[idx]);
        } catch {
          /* skip item */
        }
      }
    }),
  );
  return out.filter(Boolean);
}

export async function fetchHackerNews(listUrl: string, limit = 40): Promise<SourceItem[]> {
  const ids = await providerFetch<number[]>("hackernews", listUrl, { timeoutMs: 15000 });
  const items = await mapLimit(ids.slice(0, limit), 8, (id) => providerFetch<any>("hackernews", `https://hacker-news.firebaseio.com/v0/item/${id}.json`, { timeoutMs: 10000 }));
  return items
    .filter((it) => it && it.type === "story" && !it.dead && !it.deleted && it.title)
    .map((it) => ({
      externalId: String(it.id),
      title: it.title,
      url: it.url ?? `https://news.ycombinator.com/item?id=${it.id}`,
      summary: it.text ? strip(it.text).slice(0, 600) : "",
      author: it.by,
      publishedAt: new Date(it.time * 1000),
      score: it.score,
      comments: it.descendants ?? 0,
      tags: [],
      raw: { discussionUrl: `https://news.ycombinator.com/item?id=${it.id}` },
    }));
}

export async function fetchGithubNewRepos(token?: string, days = 7): Promise<SourceItem[]> {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const r = await providerFetch<any>("github", `https://api.github.com/search/repositories?q=${encodeURIComponent(`created:>${since}`)}&sort=stars&order=desc&per_page=30`, {
    headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}), "user-agent": "SocialPilot" },
  });
  return (r.items ?? []).map((repo: any) => ({
    externalId: String(repo.id),
    title: `${repo.full_name}${repo.description ? ` — ${repo.description}` : ""}`.slice(0, 300),
    url: repo.html_url,
    summary: repo.description ?? "",
    author: repo.owner?.login,
    publishedAt: new Date(repo.created_at),
    score: repo.stargazers_count,
    comments: repo.forks_count,
    tags: [repo.language, ...(repo.topics ?? [])].filter(Boolean).slice(0, 8),
    raw: { stars: repo.stargazers_count, forks: repo.forks_count, language: repo.language },
  }));
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });
const text = (v: any): string => (v == null ? "" : typeof v === "string" ? v : typeof v === "number" ? String(v) : v["#text"] ?? "");

export async function fetchRss(feedUrl: string, limit = 30): Promise<SourceItem[]> {
  const res = await safeFetch(feedUrl, { timeoutMs: 15000, maxBytes: 5_000_000, headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
  if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}`);
  const doc = xml.parse(res.text());
  const out: SourceItem[] = [];
  const rssItems = doc?.rss?.channel?.item ?? doc?.["rdf:RDF"]?.item;
  if (rssItems) {
    for (const it of (Array.isArray(rssItems) ? rssItems : [rssItems]).slice(0, limit)) {
      const link = text(it.link) || text(it.guid);
      const date = new Date(text(it.pubDate) || text(it["dc:date"]) || Date.now());
      if (!link) continue;
      out.push({
        externalId: text(it.guid) || link,
        title: strip(text(it.title)),
        url: link,
        summary: strip(text(it.description) || text(it["content:encoded"])).slice(0, 600),
        author: text(it["dc:creator"]) || text(it.author) || undefined,
        publishedAt: isNaN(date.getTime()) ? new Date() : date,
        tags: (Array.isArray(it.category) ? it.category : it.category ? [it.category] : []).map(text).filter(Boolean).slice(0, 6),
        raw: {},
      });
    }
    return out;
  }
  const entries = doc?.feed?.entry;
  if (entries) {
    for (const e of (Array.isArray(entries) ? entries : [entries]).slice(0, limit)) {
      const links = Array.isArray(e.link) ? e.link : [e.link];
      const link = links.find((l: any) => !l?.["@_rel"] || l["@_rel"] === "alternate")?.["@_href"] ?? links[0]?.["@_href"];
      const date = new Date(text(e.published) || text(e.updated) || Date.now());
      if (!link) continue;
      out.push({
        externalId: text(e.id) || link,
        title: strip(text(e.title)),
        url: link,
        summary: strip(text(e.summary) || text(e.content)).slice(0, 600),
        author: text(e.author?.name) || undefined,
        publishedAt: isNaN(date.getTime()) ? new Date() : date,
        tags: (Array.isArray(e.category) ? e.category : e.category ? [e.category] : []).map((c: any) => c?.["@_term"] ?? text(c)).filter(Boolean).slice(0, 6),
        raw: {},
      });
    }
    return out;
  }
  throw new Error("Unrecognized feed format");
}

export async function fetchNewsApi(apiKey: string): Promise<SourceItem[]> {
  const r = await providerFetch<any>("newsapi", "https://newsapi.org/v2/top-headlines?category=technology&language=en&pageSize=50", {
    headers: { "x-api-key": apiKey },
  });
  return (r.articles ?? [])
    .filter((a: any) => a.url && a.title && a.title !== "[Removed]")
    .map((a: any) => ({
      externalId: a.url,
      title: a.title,
      url: a.url,
      summary: a.description ?? "",
      author: a.source?.name ?? a.author,
      publishedAt: new Date(a.publishedAt),
      tags: [a.source?.name].filter(Boolean),
      raw: { source: a.source?.name },
    }));
}

export async function fetchProductHunt(token: string): Promise<SourceItem[]> {
  const postedAfter = new Date(Date.now() - 36 * 3600_000).toISOString();
  const query = `query { posts(first: 30, order: VOTES, postedAfter: "${postedAfter}") { edges { node { id name tagline description url website votesCount commentsCount createdAt topics(first: 4) { edges { node { name } } } } } } }`;
  const r = await providerFetch<any>("producthunt", "https://api.producthunt.com/v2/api/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query }),
  });
  return (r.data?.posts?.edges ?? []).map(({ node }: any) => ({
    externalId: String(node.id),
    title: `${node.name} — ${node.tagline}`,
    url: node.url,
    summary: node.description ?? node.tagline ?? "",
    publishedAt: new Date(node.createdAt),
    score: node.votesCount,
    comments: node.commentsCount,
    tags: (node.topics?.edges ?? []).map((t: any) => t.node.name),
    raw: { website: node.website },
  }));
}

const CATEGORY_RULES: [string, RegExp][] = [
  ["ai", /\b(ai|a\.i\.|llm|gpt|claude|gemini|openai|anthropic|model|agent|machine learning|neural|diffusion|transformer|inference|hugging ?face|copilot|chatbot|rag)\b/i],
  ["devtools", /\b(developer|devtools?|sdk|api|framework|library|open[- ]source|github|typescript|javascript|python|rust|golang|database|kubernetes|docker|cli|compiler|ide)\b/i],
  ["startup", /\b(startup|launch(es|ed)?|founder|seed|series [abc]|funding|raises?|yc|y combinator|product hunt|show hn|acqui(re|sition))\b/i],
  ["social", /\b(tiktok|instagram|twitter|x\.com|threads|youtube|creator|influencer|viral|meme|social media|reddit)\b/i],
  ["business", /\b(revenue|market|earnings|ipo|layoffs?|regulation|antitrust|policy|economy|pricing|enterprise)\b/i],
];

export function categorize(title: string, summary: string, fallback: string): { category: string; tags: string[] } {
  const hay = `${title} ${summary}`;
  const hits = CATEGORY_RULES.filter(([, re]) => re.test(hay)).map(([c]) => c);
  return { category: hits[0] ?? fallback, tags: hits };
}
