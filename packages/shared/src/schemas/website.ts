import { z } from "zod";

export const PageInfoSchema = z.object({
  url: z.string(),
  title: z.string(),
  metaDescription: z.string(),
  canonical: z.string().nullable(),
  robotsMeta: z.string().nullable(),
  lang: z.string().nullable(),
  h1: z.array(z.string()),
  h2: z.array(z.string()),
  h3: z.array(z.string()),
  ctas: z.array(z.object({ text: z.string(), href: z.string() })),
  internalLinks: z.array(z.string()),
  externalLinks: z.array(z.string()),
  imagesTotal: z.number(),
  imagesMissingAlt: z.number(),
  ogTags: z.record(z.string()),
  wordCount: z.number(),
  /** First 2000 characters of visible body text (for AI drafting). */
  textSample: z.string(),
  httpStatus: z.number()
});
export type PageInfo = z.infer<typeof PageInfoSchema>;

export const ISSUE_CODES = [
  "missing_title",
  "duplicate_title",
  "missing_description",
  "duplicate_description",
  "missing_h1",
  "multiple_h1",
  "images_missing_alt",
  "missing_lang",
  "missing_og",
  "insecure_links",
  "broken_internal_link",
  "missing_sitemap",
  "missing_robots",
  "slow_response",
  "thin_content",
  "fetch_blocked"
] as const;

export const WebsiteIssueSchema = z.object({
  code: z.enum(ISSUE_CODES),
  severity: z.enum(["high", "medium", "low"]),
  url: z.string(),
  evidence: z.string(),
  recommendation: z.string()
});
export type WebsiteIssue = z.infer<typeof WebsiteIssueSchema>;

export const BrokenLinkSchema = z.object({ url: z.string(), from: z.string(), status: z.number() });
export type BrokenLink = z.infer<typeof BrokenLinkSchema>;
