import type { PageInfo } from "@sp/shared";
import { load } from "cheerio";

const CTA_TEXT = /get started|sign ?up|try|start|buy|subscribe|book|contact|download|join/i;
export const TEXT_SAMPLE_CHARS = 2000;
const CTA_CLASS = /btn|button|cta/i;

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

function absolute(href: string | undefined, base: string): string | null {
  if (!href || /^(mailto:|tel:|javascript:|data:|#)/i.test(href.trim())) return null;
  try {
    const url = new URL(href, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

/** Pulls the SEO/messaging facts we need out of one HTML page. Never throws on bad markup. */
export function extractPage(url: string, html: string, status: number): PageInfo {
  const $ = load(html);
  const origin = new URL(url).origin;

  const headings = (tag: string) => $(tag).map((_, el) => clean($(el).text())).get().filter(Boolean);

  const internal = new Set<string>();
  const external = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = absolute($(el).attr("href"), url);
    if (!href) return;
    (new URL(href).origin === origin ? internal : external).add(href);
  });

  const ctas: { text: string; href: string }[] = [];
  $("a, button").each((_, el) => {
    const text = clean($(el).text());
    if (!text || text.length > 60) return;
    if (!CTA_TEXT.test(text) && !CTA_CLASS.test($(el).attr("class") ?? "")) return;
    const href = absolute($(el).attr("href"), url) ?? "";
    if (!ctas.some((c) => c.text === text && c.href === href)) ctas.push({ text, href });
  });

  const ogTags: Record<string, string> = {};
  $('meta[property^="og:"], meta[name^="twitter:"]').each((_, el) => {
    const key = $(el).attr("property") ?? $(el).attr("name");
    const value = $(el).attr("content");
    if (key && value) ogTags[key] = value;
  });

  const images = $("img");
  const imagesMissingAlt = images.filter((_, el) => $(el).attr("alt") === undefined).length;

  const canonicalHref = $('link[rel="canonical"]').attr("href");
  const lang = $("html").attr("lang")?.trim() || null;

  $("script, style, noscript, template, svg").remove();
  // Separate adjacent elements ("<a>Home</a><a>Pricing</a>") so words don't run together.
  $("body *").each((_, el) => void $(el).append(" "));
  const bodyText = clean($("body").text());
  const wordCount = bodyText.split(" ").filter(Boolean).length;

  return {
    url,
    title: clean($("title").first().text()),
    metaDescription: clean($('meta[name="description"]').attr("content") ?? ""),
    canonical: absolute(canonicalHref, url),
    robotsMeta: $('meta[name="robots"]').attr("content") ?? null,
    lang,
    h1: headings("h1"),
    h2: headings("h2"),
    h3: headings("h3"),
    ctas,
    internalLinks: [...internal],
    externalLinks: [...external],
    imagesTotal: images.length,
    imagesMissingAlt,
    ogTags,
    wordCount,
    textSample: bodyText.slice(0, TEXT_SAMPLE_CHARS),
    httpStatus: status
  };
}
