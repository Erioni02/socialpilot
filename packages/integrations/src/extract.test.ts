import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractPage } from "./extract";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("extractPage", () => {
  const good = extractPage("https://vibejudge.app/", fixture("good.html"), 200);

  it("extracts head metadata", () => {
    expect(good.title).toBe("VibeJudge — Get your vibe judged");
    expect(good.metaDescription).toMatch(/honest AI roast/);
    expect(good.lang).toBe("en");
    expect(good.canonical).toBe("https://vibejudge.app/");
    expect(good.ogTags["og:title"]).toBe("VibeJudge");
  });

  it("extracts headings and CTAs", () => {
    expect(good.h1).toEqual(["Get your vibe judged"]);
    expect(good.h2).toEqual(["How it works"]);
    expect(good.ctas).toContainEqual({ text: "Get started", href: "https://vibejudge.app/signup" });
  });

  it("splits internal and external links as absolute URLs", () => {
    expect(good.internalLinks).toContain("https://vibejudge.app/pricing");
    expect(good.externalLinks).toContain("https://twitter.com/vibejudge");
  });

  it("counts images missing alt text", () => {
    const bad = extractPage("https://x.com/", fixture("bad.html"), 200);
    expect(bad.title).toBe("");
    expect(bad.imagesTotal).toBe(2);
    expect(bad.imagesMissingAlt).toBe(2);
  });

  it("ignores script content in the word count", () => {
    expect(extractPage("https://x.com/", fixture("spa.html"), 200).wordCount).toBe(0);
  });

  it("keeps a capped sample of visible body text", () => {
    expect(good.textSample).toMatch(/^Home Pricing Twitter Get your vibe judged/);
    expect(good.textSample).not.toContain("<");
    const long = extractPage("https://x.com/", `<body><p>${"word ".repeat(2000)}</p></body>`, 200);
    expect(long.textSample.length).toBeLessThanOrEqual(2000);
  });

  it("handles an empty body", () => {
    const empty = extractPage("https://x.com/", "", 403);
    expect(empty.httpStatus).toBe(403);
    expect(empty.wordCount).toBe(0);
  });
});
