import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runChecks } from "./checks";
import { extractPage } from "./extract";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const base = { rootResponseMs: 300, robotsTxt: "User-agent: *", sitemapFound: true, brokenLinks: [] };
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe("runChecks", () => {
  it("flags the problems in a bad page", () => {
    const page = extractPage("https://x.com/", fixture("bad.html"), 200);
    expect(codes(runChecks({ ...base, pages: [page] }))).toEqual(
      expect.arrayContaining(["missing_title", "missing_h1", "images_missing_alt", "missing_lang", "missing_og", "insecure_links", "missing_description"])
    );
  });

  it("finds nothing high-severity on a good page", () => {
    const page = extractPage("https://vibejudge.app/", fixture("good.html"), 200);
    expect(runChecks({ ...base, pages: [page] }).filter((i) => i.severity === "high")).toEqual([]);
  });

  it("flags thin content under 50 words", () => {
    const page = extractPage("https://x.com/", fixture("spa.html"), 200);
    expect(codes(runChecks({ ...base, pages: [page] }))).toContain("thin_content");
  });

  it("flags a slow root response over 3000 ms", () => {
    const page = extractPage("https://vibejudge.app/", fixture("good.html"), 200);
    expect(codes(runChecks({ ...base, rootResponseMs: 3500, pages: [page] }))).toContain("slow_response");
  });

  it("flags a blocked root as high severity and skips page-content checks", () => {
    const page = extractPage("https://x.com/", "", 403);
    const issues = runChecks({ ...base, pages: [page] });
    expect(issues.find((i) => i.code === "fetch_blocked")?.severity).toBe("high");
    expect(codes(issues)).not.toContain("missing_title");
  });

  it("flags duplicate titles across pages", () => {
    const a = extractPage("https://vibejudge.app/", fixture("good.html"), 200);
    const b = extractPage("https://vibejudge.app/about", fixture("good.html"), 200);
    expect(codes(runChecks({ ...base, pages: [a, b] }))).toContain("duplicate_title");
  });

  it("reports missing sitemap and robots, and broken links", () => {
    const page = extractPage("https://vibejudge.app/", fixture("good.html"), 200);
    const issues = runChecks({
      ...base,
      robotsTxt: null,
      sitemapFound: false,
      brokenLinks: [{ url: "https://vibejudge.app/gone", from: "https://vibejudge.app/", status: 404 }],
      pages: [page]
    });
    expect(codes(issues)).toEqual(expect.arrayContaining(["missing_robots", "missing_sitemap", "broken_internal_link"]));
    expect(issues.find((i) => i.code === "broken_internal_link")?.evidence).toMatch(/404/);
  });
});
