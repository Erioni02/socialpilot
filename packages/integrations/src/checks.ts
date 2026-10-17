import type { BrokenLink, PageInfo, WebsiteIssue } from "@sp/shared";

export const SLOW_RESPONSE_MS = 3000;
export const THIN_CONTENT_WORDS = 50;

export type CheckInput = {
  pages: PageInfo[];
  rootResponseMs: number;
  robotsTxt: string | null;
  sitemapFound: boolean;
  brokenLinks: BrokenLink[];
};

/** Deterministic "basic checks" over a crawl. Each issue carries evidence and a recommendation. */
export function runChecks(input: CheckInput): WebsiteIssue[] {
  const issues: WebsiteIssue[] = [];
  const add = (issue: WebsiteIssue) => issues.push(issue);
  const root = input.pages[0];
  if (!root) return issues;

  if (root.httpStatus >= 400) {
    add({
      code: "fetch_blocked",
      severity: "high",
      url: root.url,
      evidence: `The homepage answered HTTP ${root.httpStatus} to our crawler.`,
      recommendation: "Check firewall/bot-protection rules, or analyze the site after allowing the SocialPilotBot user agent."
    });
    return issues;
  }

  const okPages = input.pages.filter((p) => p.httpStatus < 400);
  for (const page of okPages) {
    if (!page.title)
      add({ code: "missing_title", severity: "high", url: page.url, evidence: "No <title> text.", recommendation: "Add a unique, descriptive title of 50–60 characters." });
    if (!page.metaDescription)
      add({ code: "missing_description", severity: "medium", url: page.url, evidence: 'No <meta name="description">.', recommendation: "Add a 140–160 character description that sells the page." });
    if (page.h1.length === 0)
      add({ code: "missing_h1", severity: "medium", url: page.url, evidence: "No <h1> heading.", recommendation: "Add one <h1> that states the page's main promise." });
    if (page.h1.length > 1)
      add({ code: "multiple_h1", severity: "low", url: page.url, evidence: `${page.h1.length} <h1> headings: ${page.h1.slice(0, 3).join(" | ")}`, recommendation: "Keep a single <h1>; demote the rest to <h2>." });
    if (page.imagesMissingAlt > 0)
      add({ code: "images_missing_alt", severity: "medium", url: page.url, evidence: `${page.imagesMissingAlt} of ${page.imagesTotal} images have no alt attribute.`, recommendation: 'Describe meaningful images in alt text; use alt="" for decorative ones.' });
    if (!page.lang)
      add({ code: "missing_lang", severity: "low", url: page.url, evidence: "<html> has no lang attribute.", recommendation: 'Set <html lang="en"> (or the page language) for screen readers and search engines.' });
    if (!page.ogTags["og:title"])
      add({ code: "missing_og", severity: "low", url: page.url, evidence: "No og:title meta tag.", recommendation: "Add Open Graph tags (og:title, og:description, og:image) so shared links render well." });
    const insecure = [...page.internalLinks, ...page.externalLinks].filter((l) => l.startsWith("http://"));
    if (insecure.length)
      add({ code: "insecure_links", severity: "low", url: page.url, evidence: `${insecure.length} http:// links, e.g. ${insecure[0]}`, recommendation: "Link to https:// versions." });
    if (page.wordCount < THIN_CONTENT_WORDS)
      add({ code: "thin_content", severity: "medium", url: page.url, evidence: `Only ${page.wordCount} words of server-rendered text.`, recommendation: "Render key copy on the server (SSR/SSG) so search engines and link previews can read it." });
  }

  for (const [field, code, severity] of [
    ["title", "duplicate_title", "medium"],
    ["metaDescription", "duplicate_description", "low"]
  ] as const) {
    const seen = new Map<string, string[]>();
    for (const page of okPages) {
      const value = page[field];
      if (value) seen.set(value, [...(seen.get(value) ?? []), page.url]);
    }
    for (const [value, urls] of seen)
      if (urls.length > 1)
        add({ code, severity, url: urls[0]!, evidence: `"${value}" is used on ${urls.length} pages: ${urls.slice(0, 3).join(", ")}`, recommendation: "Give every page its own wording." });
  }

  if (input.robotsTxt === null)
    add({ code: "missing_robots", severity: "low", url: root.url, evidence: "No /robots.txt.", recommendation: "Add a robots.txt that points to your sitemap." });
  if (!input.sitemapFound)
    add({ code: "missing_sitemap", severity: "low", url: root.url, evidence: "No sitemap found in robots.txt or at /sitemap.xml.", recommendation: "Publish /sitemap.xml listing your public pages." });
  if (input.rootResponseMs > SLOW_RESPONSE_MS)
    add({ code: "slow_response", severity: "medium", url: root.url, evidence: `Homepage took ${input.rootResponseMs} ms to respond.`, recommendation: "Investigate server response time (caching, CDN, cold starts)." });
  for (const link of input.brokenLinks)
    add({ code: "broken_internal_link", severity: "medium", url: link.from, evidence: `${link.url} returned HTTP ${link.status}.`, recommendation: "Fix or remove the link, or redirect the old URL." });

  return issues;
}
