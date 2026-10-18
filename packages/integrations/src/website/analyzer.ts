import * as cheerio from "cheerio";
import { safeFetch, USER_AGENT } from "@socialpilot/core";

export type IssueCategory = "seo" | "accessibility" | "performance" | "content" | "conversion" | "security" | "links";
export type Severity = "critical" | "high" | "medium" | "low";

export interface AuditIssue {
  id: string;
  category: IssueCategory;
  severity: Severity;
  title: string;
  detail: string;
  recommendation: string;
  evidence: { url: string; snippet?: string; count?: number }[];
}

export interface PageReport {
  url: string;
  status: number;
  timingMs: number;
  bytes: number;
  title: string;
  metaDescription: string;
  canonical?: string;
  lang?: string;
  robotsMeta?: string;
  viewport?: string;
  h1: string[];
  h2: string[];
  h3: string[];
  wordCount: number;
  textExcerpt: string;
  ctas: { text: string; href?: string }[];
  forms: number;
  images: { total: number; missingAlt: number; examples: string[] };
  links: { internal: number; external: number };
  scripts: { external: number; inlineBytes: number; blockingInHead: number };
  stylesheets: number;
  structuredData: string[];
  og: Record<string, string>;
  headers: Record<string, string>;
  a11y: { unlabeledInputs: number; emptyButtons: number; emptyLinks: number; headingSkips: string[] };
  mixedContent: string[];
}

export interface WebsiteReport {
  url: string;
  finalUrl: string;
  fetchedAt: string;
  robotsTxt: { present: boolean; disallowAll: boolean; sitemaps: string[] };
  sitemap: { present: boolean; url?: string; urlCount: number };
  pages: PageReport[];
  brokenLinks: { url: string; status: number | string; foundOn: string }[];
  linksChecked: number;
  issues: AuditIssue[];
  scores: Record<IssueCategory, number> & { overall: number; method: "heuristic" };
  profileHints: {
    siteName?: string;
    title: string;
    description: string;
    headings: string[];
    keywords: string[];
    socialLinks: { platform: string; url: string }[];
    logoCandidates: string[];
    themeColor?: string;
    colors: string[];
    fonts: string[];
    contactEmails: string[];
  };
  pagespeed?: unknown;
}

const CTA_WORDS = /\b(get started|start|sign ?up|try|join|book|buy|subscribe|download|contact|request|demo|free|register|order|shop|learn more|apply|upgrade|pricing|waitlist|judge|create|launch)\b/i;
const SOCIAL_HOSTS: [RegExp, string][] = [
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)(x|twitter)\.com$/, "x"],
  [/(^|\.)linkedin\.com$/, "linkedin"],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, "youtube"],
  [/(^|\.)facebook\.com$/, "facebook"],
  [/(^|\.)github\.com$/, "github"],
  [/(^|\.)discord\.(gg|com)$/, "discord"],
  [/(^|\.)threads\.net$/, "threads"],
];
const STOP = new Set(
  "the a an and or for to of in on with your you our we is are be it this that from by at as can will all more new get how what why use using into about best free".split(" "),
);

function norm(u: string, base: string): string | null {
  try {
    const url = new URL(u, base);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function parseRobots(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim());
  const sitemaps: string[] = [];
  const disallow: string[] = [];
  let applies = false;
  for (const line of lines) {
    const [k, ...rest] = line.split(":");
    const v = rest.join(":").trim();
    const key = k?.toLowerCase();
    if (key === "sitemap" && v) sitemaps.push(v);
    else if (key === "user-agent") applies = v === "*" || /socialpilot/i.test(v);
    else if (key === "disallow" && applies && v) disallow.push(v);
  }
  return { sitemaps, disallow };
}

function analyzePage(url: string, html: string, status: number, timingMs: number, headers: Headers): { page: PageReport; links: string[]; $: cheerio.CheerioAPI } {
  const $ = cheerio.load(html);
  const origin = new URL(url).origin;
  const text = $("body").clone().find("script,style,noscript,svg").remove().end().text().replace(/\s+/g, " ").trim();
  const links: string[] = [];
  let internal = 0;
  let external = 0;
  $("a[href]").each((_, el) => {
    const n = norm($(el).attr("href") ?? "", url);
    if (!n) return;
    links.push(n);
    if (n.startsWith(origin)) internal++;
    else external++;
  });
  const ctas: { text: string; href?: string }[] = [];
  $("a,button,input[type=submit]").each((_, el) => {
    const t = ($(el).text() || $(el).attr("value") || $(el).attr("aria-label") || "").replace(/\s+/g, " ").trim();
    const cls = $(el).attr("class") ?? "";
    if (t && t.length < 60 && (CTA_WORDS.test(t) || /btn|button|cta/i.test(cls) || el.tagName === "button")) {
      if (!ctas.some((c) => c.text === t)) ctas.push({ text: t, href: $(el).attr("href") ? norm($(el).attr("href")!, url) ?? undefined : undefined });
    }
  });
  let missingAlt = 0;
  const altExamples: string[] = [];
  $("img").each((_, el) => {
    if ($(el).attr("alt") === undefined) {
      missingAlt++;
      if (altExamples.length < 5) altExamples.push($(el).attr("src")?.slice(0, 200) ?? "(no src)");
    }
  });
  let unlabeled = 0;
  $("input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea").each((_, el) => {
    const id = $(el).attr("id");
    const labelled = $(el).attr("aria-label") || $(el).attr("aria-labelledby") || $(el).attr("title") || (id && $(`label[for="${id}"]`).length) || $(el).closest("label").length;
    if (!labelled) unlabeled++;
  });
  let emptyButtons = 0;
  $("button").each((_, el) => {
    if (!$(el).text().trim() && !$(el).attr("aria-label") && !$(el).attr("title") && !$(el).find("img[alt]").length) emptyButtons++;
  });
  let emptyLinks = 0;
  $("a[href]").each((_, el) => {
    if (!$(el).text().trim() && !$(el).attr("aria-label") && !$(el).attr("title") && !$(el).find("img[alt]:not([alt=''])").length) emptyLinks++;
  });
  const headingSkips: string[] = [];
  let prev = 0;
  $("h1,h2,h3,h4,h5,h6").each((_, el) => {
    const lvl = Number(el.tagName.slice(1));
    if (prev && lvl > prev + 1) headingSkips.push(`h${prev}→h${lvl}`);
    prev = lvl;
  });
  const structuredData: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const j = JSON.parse($(el).text());
      for (const item of Array.isArray(j) ? j : j["@graph"] ?? [j]) if (item?.["@type"]) structuredData.push(String(item["@type"]));
    } catch {
      structuredData.push("(invalid JSON-LD)");
    }
  });
  const og: Record<string, string> = {};
  $('meta[property^="og:"],meta[name^="twitter:"]').each((_, el) => {
    const k = $(el).attr("property") ?? $(el).attr("name");
    if (k) og[k] = $(el).attr("content") ?? "";
  });
  let inlineBytes = 0;
  let extScripts = 0;
  $("script").each((_, el) => {
    if ($(el).attr("src")) extScripts++;
    else inlineBytes += $(el).text().length;
  });
  const blockingInHead = $("head script[src]:not([async]):not([defer]):not([type=module])").length;
  const mixed: string[] = [];
  if (url.startsWith("https:")) {
    $("img[src],script[src],link[href],iframe[src]").each((_, el) => {
      const v = $(el).attr("src") ?? $(el).attr("href") ?? "";
      if (v.startsWith("http://") && mixed.length < 10) mixed.push(v);
    });
  }
  const pickHeaders = ["content-type", "content-encoding", "cache-control", "strict-transport-security", "content-security-policy", "x-content-type-options", "x-frame-options", "server", "x-powered-by"];
  const hdrs: Record<string, string> = {};
  for (const h of pickHeaders) {
    const v = headers.get(h);
    if (v) hdrs[h] = v.slice(0, 300);
  }
  const page: PageReport = {
    url,
    status,
    timingMs,
    bytes: Buffer.byteLength(html),
    title: $("title").first().text().trim(),
    metaDescription: $('meta[name="description"]').attr("content")?.trim() ?? "",
    canonical: $('link[rel="canonical"]').attr("href"),
    lang: $("html").attr("lang"),
    robotsMeta: $('meta[name="robots"]').attr("content"),
    viewport: $('meta[name="viewport"]').attr("content"),
    h1: $("h1").map((_, e) => $(e).text().replace(/\s+/g, " ").trim()).get().filter(Boolean).slice(0, 10),
    h2: $("h2").map((_, e) => $(e).text().replace(/\s+/g, " ").trim()).get().filter(Boolean).slice(0, 20),
    h3: $("h3").map((_, e) => $(e).text().replace(/\s+/g, " ").trim()).get().filter(Boolean).slice(0, 20),
    wordCount: text ? text.split(" ").length : 0,
    textExcerpt: text.slice(0, 2500),
    ctas: ctas.slice(0, 15),
    forms: $("form").length,
    images: { total: $("img").length, missingAlt, examples: altExamples },
    links: { internal, external },
    scripts: { external: extScripts, inlineBytes, blockingInHead },
    stylesheets: $('link[rel="stylesheet"]').length,
    structuredData,
    og,
    headers: hdrs,
    a11y: { unlabeledInputs: unlabeled, emptyButtons, emptyLinks, headingSkips: headingSkips.slice(0, 10) },
    mixedContent: mixed,
  };
  return { page, links, $ };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export interface AnalyzeOptions {
  maxPages?: number;
  maxLinkChecks?: number;
  pagespeedKey?: string;
  runPagespeed?: boolean;
  onProgress?: (msg: string) => void;
}

/** Crawls a public website (same origin, robots-aware, SSRF-safe) and produces an evidence-based audit. */
export async function analyzeWebsite(inputUrl: string, opts: AnalyzeOptions = {}): Promise<WebsiteReport> {
  const maxPages = opts.maxPages ?? 12;
  const progress = opts.onProgress ?? (() => {});
  progress(`Fetching ${inputUrl}`);
  const home = await safeFetch(inputUrl, { headers: { accept: "text/html,*/*" } });
  const finalUrl = home.url;
  const origin = new URL(finalUrl).origin;

  let robots = { present: false, disallowAll: false, sitemaps: [] as string[] };
  let disallow: string[] = [];
  try {
    const r = await safeFetch(`${origin}/robots.txt`, { timeoutMs: 8000, maxBytes: 200_000 });
    if (r.ok && !/<html/i.test(r.text().slice(0, 200))) {
      const parsed = parseRobots(r.text());
      disallow = parsed.disallow;
      robots = { present: true, disallowAll: parsed.disallow.includes("/"), sitemaps: parsed.sitemaps };
    }
  } catch {
    /* robots optional */
  }
  const allowed = (u: string) => {
    const p = new URL(u).pathname;
    return !disallow.some((d) => d !== "/" && p.startsWith(d));
  };

  const sitemapUrls: string[] = [];
  let sitemap: WebsiteReport["sitemap"] = { present: false, urlCount: 0 };
  for (const sm of robots.sitemaps.length ? robots.sitemaps.slice(0, 2) : [`${origin}/sitemap.xml`]) {
    try {
      const r = await safeFetch(sm, { timeoutMs: 10000, maxBytes: 3_000_000 });
      if (!r.ok) continue;
      const locs = [...r.text().matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
      if (locs.length) {
        sitemap = { present: true, url: sm, urlCount: locs.length };
        sitemapUrls.push(...locs.filter((l) => l.startsWith(origin) && !l.endsWith(".xml")));
        break;
      }
    } catch {
      /* optional */
    }
  }

  const pages: PageReport[] = [];
  const allLinks = new Map<string, string>();
  const seen = new Set<string>();
  const queue: string[] = [finalUrl];
  const $pages: cheerio.CheerioAPI[] = [];
  const addPage = (url: string, html: string, status: number, timing: number, headers: Headers) => {
    const { page, links, $ } = analyzePage(url, html, status, timing, headers);
    pages.push(page);
    $pages.push($);
    for (const l of links) {
      if (!allLinks.has(l)) allLinks.set(l, url);
      if (l.startsWith(origin) && !seen.has(l) && !/\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|mp4|mp3|xml|json)$/i.test(l)) queue.push(l);
    }
  };
  seen.add(finalUrl);
  if (home.headers.get("content-type")?.includes("html") || /<html/i.test(home.text().slice(0, 500))) {
    addPage(finalUrl, home.text(), home.status, home.timingMs, home.headers);
  } else {
    throw new Error(`${finalUrl} did not return an HTML page (content-type ${home.headers.get("content-type")})`);
  }
  queue.shift();
  for (const s of sitemapUrls.slice(0, maxPages)) if (!queue.includes(s)) queue.push(s);

  while (pages.length < maxPages && queue.length) {
    const batch: string[] = [];
    while (batch.length < 4 && queue.length) {
      const next = queue.shift()!;
      if (seen.has(next) || !allowed(next)) continue;
      seen.add(next);
      batch.push(next);
    }
    if (!batch.length) break;
    progress(`Crawling ${batch.length} page(s) (${pages.length}/${maxPages})`);
    await Promise.all(
      batch.map(async (u) => {
        try {
          const r = await safeFetch(u, { timeoutMs: 12000, headers: { accept: "text/html" } });
          if ((r.headers.get("content-type") ?? "").includes("html") && pages.length < maxPages) addPage(r.url, r.text(), r.status, r.timingMs, r.headers);
        } catch {
          /* recorded via link checks */
        }
      }),
    );
  }

  // Broken link check (HEAD with GET fallback), internal first.
  const toCheck = [...allLinks.entries()]
    .filter(([l]) => !/^mailto:|^tel:/.test(l))
    .sort(([a], [b]) => Number(b.startsWith(origin)) - Number(a.startsWith(origin)))
    .slice(0, opts.maxLinkChecks ?? 60);
  progress(`Checking ${toCheck.length} links`);
  const crawledStatus = new Map(pages.map((p) => [p.url, p.status]));
  const brokenLinks: WebsiteReport["brokenLinks"] = [];
  await pool(toCheck, 6, async ([link, foundOn]) => {
    if (crawledStatus.has(link)) {
      const s = crawledStatus.get(link)!;
      if (s >= 400) brokenLinks.push({ url: link, status: s, foundOn });
      return;
    }
    try {
      let r = await safeFetch(link, { method: "HEAD", timeoutMs: 8000, maxBytes: 1 });
      if (r.status === 405 || r.status === 403 || r.status === 501) r = await safeFetch(link, { timeoutMs: 8000, maxBytes: 20_000 });
      // Many social sites block bots with 403/429/999; those are not reported as broken.
      if (r.status === 404 || r.status === 410 || r.status >= 500) brokenLinks.push({ url: link, status: r.status, foundOn });
    } catch (e) {
      const msg = (e as Error).message;
      if (!/Blocked/.test(msg)) brokenLinks.push({ url: link, status: msg.slice(0, 80), foundOn });
    }
  });

  let pagespeed: unknown;
  if (opts.runPagespeed !== false) {
    try {
      progress("Running PageSpeed Insights (Lighthouse)");
      pagespeed = await runPagespeed(finalUrl, opts.pagespeedKey);
    } catch (e) {
      pagespeed = { error: (e as Error).message.slice(0, 300) };
    }
  }

  const issues = buildIssues(finalUrl, pages, robots, sitemap, brokenLinks, pagespeed);
  const scores = scoreIssues(issues);
  const profileHints = extractProfileHints(finalUrl, pages, $pages);
  return {
    url: inputUrl,
    finalUrl,
    fetchedAt: new Date().toISOString(),
    robotsTxt: robots,
    sitemap,
    pages,
    brokenLinks,
    linksChecked: toCheck.length,
    issues,
    scores,
    profileHints,
    pagespeed,
  };
}

export async function runPagespeed(url: string, key?: string) {
  const params = new URLSearchParams({ url, strategy: "mobile" });
  for (const c of ["performance", "accessibility", "seo", "best-practices"]) params.append("category", c);
  if (key) params.set("key", key);
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, { headers: { "user-agent": USER_AGENT } });
  const j: any = await res.json();
  if (!res.ok) throw new Error(j?.error?.message ?? `PageSpeed HTTP ${res.status}`);
  const lr = j.lighthouseResult ?? {};
  const cat = (k: string) => (lr.categories?.[k]?.score != null ? Math.round(lr.categories[k].score * 100) : null);
  const audit = (k: string) => lr.audits?.[k]?.displayValue ?? null;
  return {
    strategy: "mobile",
    scores: { performance: cat("performance"), accessibility: cat("accessibility"), seo: cat("seo"), bestPractices: cat("best-practices") },
    metrics: {
      lcp: audit("largest-contentful-paint"),
      fcp: audit("first-contentful-paint"),
      cls: audit("cumulative-layout-shift"),
      tbt: audit("total-blocking-time"),
      speedIndex: audit("speed-index"),
    },
    fieldData: j.loadingExperience?.overall_category ?? null,
    fetchedAt: lr.fetchTime,
  };
}

function buildIssues(
  url: string,
  pages: PageReport[],
  robots: WebsiteReport["robotsTxt"],
  sitemap: WebsiteReport["sitemap"],
  broken: WebsiteReport["brokenLinks"],
  pagespeed: any,
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const add = (i: AuditIssue) => issues.push(i);
  const home = pages[0];
  const forPages = (pred: (p: PageReport) => boolean) => pages.filter(pred).map((p) => ({ url: p.url }));

  if (!url.startsWith("https://")) add({ id: "no-https", category: "security", severity: "critical", title: "Site is not served over HTTPS", detail: "The final URL uses plain HTTP.", recommendation: "Serve the site over HTTPS and redirect HTTP to HTTPS.", evidence: [{ url }] });
  if (home && !home.headers["strict-transport-security"] && url.startsWith("https://"))
    add({ id: "no-hsts", category: "security", severity: "low", title: "No HSTS header", detail: "Strict-Transport-Security is not set on the homepage.", recommendation: "Add `Strict-Transport-Security: max-age=31536000; includeSubDomains`.", evidence: [{ url: home.url }] });
  if (home && !home.headers["content-security-policy"])
    add({ id: "no-csp", category: "security", severity: "low", title: "No Content-Security-Policy", detail: "No CSP header on the homepage.", recommendation: "Define a Content-Security-Policy to reduce XSS risk.", evidence: [{ url: home.url }] });
  const mixed = pages.filter((p) => p.mixedContent.length);
  if (mixed.length) add({ id: "mixed-content", category: "security", severity: "high", title: "Mixed content (HTTP resources on HTTPS pages)", detail: `${mixed.length} page(s) load insecure resources.`, recommendation: "Load every resource over HTTPS.", evidence: mixed.map((p) => ({ url: p.url, snippet: p.mixedContent.slice(0, 3).join(", ") })) });

  const noTitle = forPages((p) => !p.title);
  if (noTitle.length) add({ id: "missing-title", category: "seo", severity: "high", title: "Pages without a <title>", detail: `${noTitle.length} page(s) have no title.`, recommendation: "Give every page a unique, descriptive title (30–60 characters).", evidence: noTitle });
  const badTitle = pages.filter((p) => p.title && (p.title.length < 20 || p.title.length > 65));
  if (badTitle.length) add({ id: "title-length", category: "seo", severity: "low", title: "Title length outside 20–65 characters", detail: "Very short or long titles are truncated or under-informative in search results.", recommendation: "Aim for 30–60 characters including the brand.", evidence: badTitle.map((p) => ({ url: p.url, snippet: `${p.title} (${p.title.length} chars)` })) });
  const noDesc = forPages((p) => !p.metaDescription);
  if (noDesc.length) add({ id: "missing-description", category: "seo", severity: "medium", title: "Missing meta description", detail: `${noDesc.length} page(s) lack a meta description.`, recommendation: "Write a 70–160 character description that states the value proposition.", evidence: noDesc });
  const titles = new Map<string, string[]>();
  for (const p of pages) if (p.title) titles.set(p.title, [...(titles.get(p.title) ?? []), p.url]);
  const dupTitles = [...titles.entries()].filter(([, v]) => v.length > 1);
  if (dupTitles.length) add({ id: "duplicate-titles", category: "seo", severity: "medium", title: "Duplicate page titles", detail: `${dupTitles.length} title(s) are reused across pages.`, recommendation: "Make each page title unique.", evidence: dupTitles.map(([t, urls]) => ({ url: urls[0], snippet: `"${t}" used on ${urls.length} pages`, count: urls.length })) });
  const h1Issues = pages.filter((p) => p.h1.length !== 1);
  if (h1Issues.length) add({ id: "h1-count", category: "seo", severity: "medium", title: "Pages without exactly one H1", detail: "Each page should have one H1 that states its topic.", recommendation: "Use a single descriptive H1 per page.", evidence: h1Issues.map((p) => ({ url: p.url, snippet: `${p.h1.length} H1 element(s)` })) });
  if (home && !home.canonical) add({ id: "no-canonical", category: "seo", severity: "low", title: "No canonical URL on homepage", detail: "A canonical link helps search engines consolidate duplicate URLs.", recommendation: 'Add <link rel="canonical" href="…">.', evidence: [{ url: home.url }] });
  if (home && !home.og["og:image"]) add({ id: "no-og-image", category: "content", severity: "medium", title: "No social preview image (og:image)", detail: "Links shared on social networks will have no preview image.", recommendation: "Add og:title, og:description and a 1200×630 og:image.", evidence: [{ url: home.url }] });
  if (!sitemap.present) add({ id: "no-sitemap", category: "seo", severity: "low", title: "No XML sitemap found", detail: "Neither robots.txt nor /sitemap.xml exposes a sitemap.", recommendation: "Publish a sitemap.xml and reference it in robots.txt.", evidence: [{ url }] });
  if (!robots.present) add({ id: "no-robots", category: "seo", severity: "low", title: "No robots.txt", detail: "robots.txt is missing.", recommendation: "Add a robots.txt with a Sitemap line.", evidence: [{ url }] });
  if (robots.disallowAll) add({ id: "robots-disallow-all", category: "seo", severity: "critical", title: "robots.txt blocks all crawlers", detail: "`Disallow: /` prevents search engines from indexing the site.", recommendation: "Remove the blanket disallow for production.", evidence: [{ url }] });
  const noindex = pages.filter((p) => /noindex/i.test(p.robotsMeta ?? ""));
  if (noindex.length) add({ id: "noindex", category: "seo", severity: "high", title: "Pages marked noindex", detail: "These pages ask search engines not to index them.", recommendation: "Remove noindex from pages that should rank.", evidence: noindex.map((p) => ({ url: p.url })) });
  if (home && !home.structuredData.length) add({ id: "no-structured-data", category: "seo", severity: "low", title: "No structured data (JSON-LD)", detail: "Structured data can enable rich results.", recommendation: "Add Organization / SoftwareApplication / Product JSON-LD.", evidence: [{ url: home.url }] });
  const thin = pages.filter((p) => p.wordCount < 150);
  if (thin.length) add({ id: "thin-content", category: "content", severity: "medium", title: "Thin content in server HTML", detail: "These pages have little text in the HTML delivered to crawlers (client-rendered apps can look empty to bots and social previews).", recommendation: "Server-render or pre-render key marketing copy; expand thin pages.", evidence: thin.map((p) => ({ url: p.url, snippet: `${p.wordCount} words` })) });

  const noLang = forPages((p) => !p.lang);
  if (noLang.length) add({ id: "no-lang", category: "accessibility", severity: "medium", title: "Missing html lang attribute", detail: "Screen readers rely on lang to choose pronunciation.", recommendation: 'Set <html lang="en"> (or the right language).', evidence: noLang });
  const alt = pages.filter((p) => p.images.missingAlt);
  if (alt.length) add({ id: "img-alt", category: "accessibility", severity: "medium", title: "Images without alt text", detail: `${alt.reduce((s, p) => s + p.images.missingAlt, 0)} image(s) have no alt attribute.`, recommendation: 'Add meaningful alt text, or alt="" for decorative images.', evidence: alt.map((p) => ({ url: p.url, snippet: p.images.examples.join(", "), count: p.images.missingAlt })) });
  const unl = pages.filter((p) => p.a11y.unlabeledInputs);
  if (unl.length) add({ id: "unlabeled-inputs", category: "accessibility", severity: "high", title: "Form fields without labels", detail: "Inputs need an accessible name.", recommendation: "Associate a <label> or aria-label with each field.", evidence: unl.map((p) => ({ url: p.url, count: p.a11y.unlabeledInputs })) });
  const eb = pages.filter((p) => p.a11y.emptyButtons || p.a11y.emptyLinks);
  if (eb.length) add({ id: "empty-controls", category: "accessibility", severity: "medium", title: "Buttons or links without accessible text", detail: "Icon-only controls need an aria-label.", recommendation: "Add aria-label to icon-only buttons and links.", evidence: eb.map((p) => ({ url: p.url, snippet: `${p.a11y.emptyButtons} buttons, ${p.a11y.emptyLinks} links` })) });
  const skips = pages.filter((p) => p.a11y.headingSkips.length);
  if (skips.length) add({ id: "heading-order", category: "accessibility", severity: "low", title: "Skipped heading levels", detail: "Heading levels jump (e.g. h1→h3).", recommendation: "Keep a logical heading hierarchy.", evidence: skips.map((p) => ({ url: p.url, snippet: p.a11y.headingSkips.join(", ") })) });
  const zoom = pages.filter((p) => /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(p.viewport ?? ""));
  if (zoom.length) add({ id: "zoom-disabled", category: "accessibility", severity: "medium", title: "Pinch-zoom disabled", detail: "The viewport prevents users from zooming.", recommendation: "Remove user-scalable=no / maximum-scale=1.", evidence: zoom.map((p) => ({ url: p.url, snippet: p.viewport })) });
  const noVp = forPages((p) => !p.viewport);
  if (noVp.length) add({ id: "no-viewport", category: "performance", severity: "high", title: "No mobile viewport meta tag", detail: "Pages will render zoomed-out on phones.", recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.', evidence: noVp });

  const slow = pages.filter((p) => p.timingMs > 1500);
  if (slow.length) add({ id: "slow-response", category: "performance", severity: slow.some((p) => p.timingMs > 3000) ? "high" : "medium", title: "Slow server response", detail: "Measured time to download the HTML from SocialPilot's server.", recommendation: "Use caching/CDN for HTML and check server-side rendering time.", evidence: slow.map((p) => ({ url: p.url, snippet: `${p.timingMs} ms` })) });
  const heavy = pages.filter((p) => p.bytes > 500_000);
  if (heavy.length) add({ id: "heavy-html", category: "performance", severity: "medium", title: "Large HTML documents", detail: "HTML over 500 KB slows first render.", recommendation: "Reduce inline data/scripts and paginate long pages.", evidence: heavy.map((p) => ({ url: p.url, snippet: `${Math.round(p.bytes / 1024)} KB` })) });
  if (home && !home.headers["content-encoding"]) add({ id: "no-compression", category: "performance", severity: "medium", title: "HTML not compressed", detail: "No Content-Encoding (gzip/br) on the homepage response.", recommendation: "Enable Brotli or gzip compression.", evidence: [{ url: home.url }] });
  const blocking = pages.filter((p) => p.scripts.blockingInHead > 0);
  if (blocking.length) add({ id: "render-blocking", category: "performance", severity: "low", title: "Render-blocking scripts in <head>", detail: "Synchronous scripts in the head delay first paint.", recommendation: "Add defer/async or move scripts to the end of body.", evidence: blocking.map((p) => ({ url: p.url, count: p.scripts.blockingInHead })) });
  if (pagespeed?.scores?.performance != null && pagespeed.scores.performance < 70)
    add({ id: "lighthouse-performance", category: "performance", severity: pagespeed.scores.performance < 50 ? "high" : "medium", title: `Lighthouse mobile performance score ${pagespeed.scores.performance}/100`, detail: `LCP ${pagespeed.metrics.lcp}, TBT ${pagespeed.metrics.tbt}, CLS ${pagespeed.metrics.cls} (Google PageSpeed Insights, mobile).`, recommendation: "Optimize the largest contentful element, reduce JavaScript and fix layout shifts.", evidence: [{ url }] });

  if (broken.length) add({ id: "broken-links", category: "links", severity: broken.some((b) => b.url.startsWith(new URL(url).origin)) ? "high" : "medium", title: `${broken.length} broken link(s)`, detail: "Links that returned 404/410/5xx or failed to load.", recommendation: "Fix or remove broken links.", evidence: broken.slice(0, 20).map((b) => ({ url: b.url, snippet: `HTTP ${b.status} — found on ${b.foundOn}` })) });

  if (home && home.ctas.length === 0) add({ id: "no-cta", category: "conversion", severity: "high", title: "No clear call to action on homepage", detail: "No buttons or action-oriented links were detected in the server HTML.", recommendation: "Add a prominent primary CTA above the fold (e.g. “Get started free”).", evidence: [{ url: home.url }] });
  if (home && home.ctas.length > 8) add({ id: "too-many-ctas", category: "conversion", severity: "low", title: "Many competing calls to action", detail: `${home.ctas.length} action elements on the homepage may dilute focus.`, recommendation: "Prioritize one primary and one secondary CTA.", evidence: [{ url: home.url, snippet: home.ctas.slice(0, 8).map((c) => c.text).join(" · ") }] });
  if (home && home.metaDescription && home.h1[0] && home.wordCount < 300) add({ id: "value-prop-depth", category: "conversion", severity: "low", title: "Limited explanatory copy on homepage", detail: "Visitors may not understand the product from the delivered HTML alone.", recommendation: "Add a concise explanation, social proof and an FAQ section.", evidence: [{ url: home.url, snippet: `${home.wordCount} words` }] });

  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}

function scoreIssues(issues: AuditIssue[]): WebsiteReport["scores"] {
  const penalty: Record<Severity, number> = { critical: 35, high: 18, medium: 9, low: 4 };
  const cats: IssueCategory[] = ["seo", "accessibility", "performance", "content", "conversion", "security", "links"];
  const scores = Object.fromEntries(
    cats.map((c) => [c, Math.max(0, 100 - issues.filter((i) => i.category === c).reduce((s, i) => s + penalty[i.severity], 0))]),
  ) as Record<IssueCategory, number>;
  const overall = Math.round(cats.reduce((s, c) => s + scores[c], 0) / cats.length);
  return { ...scores, overall, method: "heuristic" };
}

function extractProfileHints(url: string, pages: PageReport[], $pages: cheerio.CheerioAPI[]): WebsiteReport["profileHints"] {
  const home = pages[0];
  const $ = $pages[0];
  const socialLinks: { platform: string; url: string }[] = [];
  const emails = new Set<string>();
  for (const $p of $pages) {
    $p("a[href]").each((_, el) => {
      const href = $p(el).attr("href") ?? "";
      if (href.startsWith("mailto:")) emails.add(href.slice(7).split("?")[0]);
      try {
        const h = new URL(href, url).hostname.replace(/^www\./, "");
        for (const [re, platform] of SOCIAL_HOSTS) {
          if (re.test(h) && !socialLinks.some((s) => s.platform === platform)) socialLinks.push({ platform, url: new URL(href, url).href });
        }
      } catch {
        /* ignore */
      }
    });
  }
  const logoCandidates = [
    home?.og["og:image"],
    $('link[rel="apple-touch-icon"]').attr("href"),
    $('link[rel="icon"][type="image/svg+xml"]').attr("href"),
    $('link[rel="icon"]').attr("href"),
    $('img[alt*="logo" i],img[src*="logo" i]').first().attr("src"),
    "/favicon.ico",
  ]
    .filter((x): x is string => !!x)
    .map((x) => norm(x, url))
    .filter((x): x is string => !!x);
  const colors = new Set<string>();
  const themeColor = $('meta[name="theme-color"]').attr("content");
  if (themeColor) colors.add(themeColor);
  const styleText = $("style").text().slice(0, 200_000);
  for (const m of styleText.matchAll(/--[\w-]*(?:primary|brand|accent|main)[\w-]*\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))/gi)) colors.add(m[1]);
  const fonts = new Set<string>();
  $('link[href*="fonts.googleapis.com"]').each((_, el) => {
    for (const m of ($(el).attr("href") ?? "").matchAll(/family=([^:&]+)/g)) fonts.add(decodeURIComponent(m[1].replace(/\+/g, " ")));
  });
  const words = new Map<string, number>();
  for (const p of pages.slice(0, 5)) {
    for (const w of `${p.title} ${p.metaDescription} ${p.h1.join(" ")} ${p.h2.join(" ")}`.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []) {
      if (!STOP.has(w)) words.set(w, (words.get(w) ?? 0) + 1);
    }
  }
  return {
    siteName: home?.og["og:site_name"],
    title: home?.title ?? "",
    description: home?.metaDescription || home?.og["og:description"] || "",
    headings: [...(home?.h1 ?? []), ...(home?.h2 ?? []), ...(home?.h3 ?? [])].slice(0, 25),
    keywords: [...words.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([w]) => w),
    socialLinks,
    logoCandidates: [...new Set(logoCandidates)].slice(0, 5),
    themeColor,
    colors: [...colors].slice(0, 8),
    fonts: [...fonts].slice(0, 4),
    contactEmails: [...emails].slice(0, 5),
  };
}
