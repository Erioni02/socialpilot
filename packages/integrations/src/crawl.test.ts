import { describe, expect, it } from "vitest";
import { crawlSite } from "./crawl";
import type { SafeFetchResult } from "./fetcher";

type Site = Record<string, { status: number; body: string }>;

function fakeFetch(site: Site) {
  const calls: string[] = [];
  const fetch = async (url: string): Promise<SafeFetchResult> => {
    calls.push(url);
    const page = site[url] ?? { status: 404, body: "not found" };
    return { url, status: page.status, headers: { "content-type": "text/html" }, body: page.body, responseMs: 50, redirects: [] };
  };
  return { fetch, calls };
}

const html = (links: string[], words = 80) =>
  `<html lang="en"><head><title>T</title></head><body><h1>H</h1><p>${"word ".repeat(words)}</p>${links
    .map((l) => `<a href="${l}">l</a>`)
    .join("")}</body></html>`;

describe("crawlSite", () => {
  it("stops at maxPages and stays on the same origin", async () => {
    const site: Site = {
      "https://a.test/robots.txt": { status: 200, body: "User-agent: *\nAllow: /" },
      "https://a.test/": { status: 200, body: html([...Array.from({ length: 30 }, (_, i) => `/p${i}`), "https://other.test/x"]) }
    };
    for (let i = 0; i < 30; i++) site[`https://a.test/p${i}`] = { status: 200, body: html([]) };
    const { fetch, calls } = fakeFetch(site);
    const result = await crawlSite("https://a.test/", { fetch, maxPages: 15, checkLinks: false });
    expect(result.pages).toHaveLength(15);
    expect(calls.some((c) => c.startsWith("https://other.test"))).toBe(false);
  });

  it("respects robots.txt Disallow", async () => {
    const site: Site = {
      "https://a.test/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /admin" },
      "https://a.test/": { status: 200, body: html(["/admin/panel", "/about"]) },
      "https://a.test/about": { status: 200, body: html([]) },
      "https://a.test/admin/panel": { status: 200, body: html([]) }
    };
    const { fetch, calls } = fakeFetch(site);
    const result = await crawlSite("https://a.test/", { fetch });
    expect(result.pages.map((p) => p.url)).toEqual(["https://a.test/", "https://a.test/about"]);
    expect(calls).not.toContain("https://a.test/admin/panel");
  });

  it("reports broken internal links", async () => {
    const site: Site = {
      "https://a.test/robots.txt": { status: 404, body: "" },
      "https://a.test/": { status: 200, body: html(["/gone"]) }
    };
    const { fetch } = fakeFetch(site);
    const result = await crawlSite("https://a.test/", { fetch });
    expect(result.brokenLinks).toEqual([{ url: "https://a.test/gone", from: "https://a.test/", status: 404 }]);
    expect(result.issues.map((i) => i.code)).toContain("broken_internal_link");
    expect(result.robotsTxt).toBeNull();
  });

  it("returns a result with fetch_blocked when the root is refused", async () => {
    const site: Site = { "https://a.test/": { status: 403, body: "Forbidden" } };
    const { fetch } = fakeFetch(site);
    const result = await crawlSite("https://a.test/", { fetch });
    expect(result.httpStatus).toBe(403);
    expect(result.pages).toHaveLength(1);
    expect(result.issues.filter((i) => i.code === "fetch_blocked")).toHaveLength(1);
  });

  it("follows the root redirect and crawls the final origin", async () => {
    const fetch = async (url: string): Promise<SafeFetchResult> => {
      if (url === "https://a.test/") return { url: "https://www.a.test/", status: 200, headers: {}, body: html(["/about"]), responseMs: 40, redirects: ["https://www.a.test/"] };
      if (url === "https://www.a.test/about") return { url, status: 200, headers: {}, body: html([]), responseMs: 40, redirects: [] };
      return { url, status: 404, headers: {}, body: "", responseMs: 10, redirects: [] };
    };
    const result = await crawlSite("https://a.test/", { fetch });
    expect(result.rootUrl).toBe("https://www.a.test/");
    expect(result.pages.map((p) => p.url)).toEqual(["https://www.a.test/", "https://www.a.test/about"]);
  });

  it("detects a sitemap and calls onPage per page", async () => {
    const site: Site = {
      "https://a.test/robots.txt": { status: 200, body: "Sitemap: https://a.test/sitemap.xml" },
      "https://a.test/sitemap.xml": { status: 200, body: "<urlset><url><loc>https://a.test/from-sitemap</loc></url></urlset>" },
      "https://a.test/": { status: 200, body: html([]) },
      "https://a.test/from-sitemap": { status: 200, body: html([]) }
    };
    const { fetch } = fakeFetch(site);
    const seen: string[] = [];
    const result = await crawlSite("https://a.test/", { fetch, onPage: (p) => void seen.push(p.url) });
    expect(result.sitemapFound).toBe(true);
    expect(seen).toEqual(["https://a.test/", "https://a.test/from-sitemap"]);
  });
});
