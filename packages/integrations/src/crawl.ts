import type { BrokenLink, PageInfo, WebsiteIssue } from "@sp/shared";
import { runChecks } from "./checks";
import { extractPage } from "./extract";
import { safeFetch, type SafeFetchOptions, type SafeFetchResult } from "./fetcher";

export type CrawlFetch = (url: string, opts?: SafeFetchOptions) => Promise<SafeFetchResult>;

export type CrawlOptions = {
  maxPages?: number;
  concurrency?: number;
  checkLinks?: boolean;
  maxLinkChecks?: number;
  fetch?: CrawlFetch;
  onPage?: (page: PageInfo) => void | Promise<void>;
};

export type CrawlResult = {
  rootUrl: string;
  httpStatus: number;
  responseMs: number;
  pages: PageInfo[];
  robotsTxt: string | null;
  sitemapFound: boolean;
  brokenLinks: BrokenLink[];
  issues: WebsiteIssue[];
};

const NON_HTML = /\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|mp4|mov|mp3|css|js|json|xml|txt|woff2?)$/i;

function canonicalPageUrl(href: string): string {
  const url = new URL(href);
  url.hash = "";
  url.search = "";
  return url.href;
}

/** Disallow prefixes that apply to us (User-agent: * or SocialPilotBot). */
export function parseRobots(robotsTxt: string): { disallow: string[]; sitemaps: string[] } {
  const disallow: string[] = [];
  const sitemaps: string[] = [];
  let applies = false;
  let lastWasAgent = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const [, field, value] = match as unknown as [string, string, string];
    const key = field.toLowerCase();
    if (key === "sitemap") sitemaps.push(value);
    else if (key === "user-agent") {
      const matches = value === "*" || /socialpilotbot/i.test(value);
      applies = lastWasAgent ? applies || matches : matches;
      lastWasAgent = true;
      continue;
    } else if (key === "disallow" && applies && value) disallow.push(value);
    lastWasAgent = false;
  }
  return { disallow, sitemaps };
}

const isHtml = (res: SafeFetchResult) => !res.headers["content-type"] || /html/i.test(res.headers["content-type"]);

/**
 * Crawls the root page plus up to `maxPages - 1` same-origin pages (nav links first, then sitemap entries),
 * respecting robots.txt, then checks internal links it didn't crawl. A refused root still returns a result.
 */
export async function crawlSite(startUrl: string, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const { maxPages = 15, concurrency = 3, checkLinks = true, maxLinkChecks = 50, onPage } = opts;
  const fetch = opts.fetch ?? safeFetch;

  const loadRobots = async (origin: string) => {
    try {
      const res = await fetch(`${origin}/robots.txt`, { accept: "text/plain,*/*" });
      return res.status === 200 ? res.body : null;
    } catch {
      return null;
    }
  };

  let robotsOrigin = new URL(startUrl).origin;
  let robotsTxt = await loadRobots(robotsOrigin);

  const root = await fetch(startUrl);
  const rootUrl = root.url;
  const origin = new URL(rootUrl).origin;
  if (origin !== robotsOrigin) {
    robotsOrigin = origin;
    robotsTxt = await loadRobots(origin);
  }
  const robots = parseRobots(robotsTxt ?? "");
  const allowed = (href: string) => !robots.disallow.some((prefix) => new URL(href).pathname.startsWith(prefix));

  const rootPage = extractPage(rootUrl, root.body, root.status);
  const pages: PageInfo[] = [rootPage];
  await onPage?.(rootPage);

  const finish = (sitemapFound: boolean, brokenLinks: BrokenLink[]): CrawlResult => ({
    rootUrl,
    httpStatus: root.status,
    responseMs: root.responseMs,
    pages,
    robotsTxt,
    sitemapFound,
    brokenLinks,
    issues: runChecks({ pages, rootResponseMs: root.responseMs, robotsTxt, sitemapFound, brokenLinks })
  });

  if (root.status >= 400) return finish(false, []);

  // Sitemap: listed in robots.txt, else the conventional location.
  let sitemapFound = false;
  const sitemapUrls: string[] = [];
  for (const candidate of robots.sitemaps.length ? robots.sitemaps : [`${origin}/sitemap.xml`]) {
    try {
      const res = await fetch(candidate, { accept: "application/xml,text/xml,*/*" });
      if (res.status === 200 && /<(urlset|sitemapindex)/i.test(res.body)) {
        sitemapFound = true;
        for (const m of res.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) sitemapUrls.push(m[1]!);
      }
    } catch {
      /* missing sitemap is reported as an issue, not an error */
    }
  }

  const seen = new Set<string>([canonicalPageUrl(rootUrl)]);
  const queue: { url: string; from: string }[] = [];
  const enqueue = (href: string, from: string) => {
    let url: string;
    try {
      url = canonicalPageUrl(href);
    } catch {
      return;
    }
    if (new URL(url).origin !== origin || NON_HTML.test(new URL(url).pathname) || seen.has(url) || !allowed(url)) return;
    seen.add(url);
    queue.push({ url, from });
  };
  rootPage.internalLinks.forEach((l) => enqueue(l, rootUrl));
  sitemapUrls.forEach((l) => enqueue(l, `${origin}/sitemap.xml`));

  const brokenLinks: BrokenLink[] = [];
  while (queue.length && pages.length < maxPages) {
    const batch = queue.splice(0, Math.min(concurrency, maxPages - pages.length));
    const results = await Promise.all(batch.map((item) => fetch(item.url).then((res) => ({ item, res }), () => ({ item, res: null }))));
    for (const { item, res } of results) {
      if (!res) continue;
      if (res.status >= 400) {
        brokenLinks.push({ url: item.url, from: item.from, status: res.status });
        continue;
      }
      if (!isHtml(res)) continue;
      const page = extractPage(res.url, res.body, res.status);
      pages.push(page);
      await onPage?.(page);
      page.internalLinks.forEach((l) => enqueue(l, page.url));
    }
  }

  if (checkLinks) {
    for (const item of queue.slice(0, maxLinkChecks)) {
      try {
        let res = await fetch(item.url, { method: "HEAD" });
        if (res.status === 405) res = await fetch(item.url);
        if (res.status >= 400) brokenLinks.push({ url: item.url, from: item.from, status: res.status });
      } catch {
        /* unreachable links are not proof of a broken page */
      }
    }
  }

  return finish(sitemapFound, brokenLinks);
}
