import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);
const list = (maxItems: number, maxLen = 200) => z.array(z.string().trim().min(1).max(maxLen)).max(maxItems);

/** What the owner edits and confirms. */
export const BrandProfileInputSchema = z.object({
  description: text(2000).default(""),
  targetAudience: text(1000).default(""),
  industry: text(200).default(""),
  productsServices: list(30).default([]),
  objectives: list(20).default([]),
  voiceTone: text(500).default(""),
  keyMessages: list(20, 300).default([]),
  colors: list(12, 40).default([]),
  competitors: list(20).default([]),
  notes: text(4000).default("")
});
export type BrandProfileInput = z.infer<typeof BrandProfileInputSchema>;

/** What the AI must return when drafting from a website. Lenient on length, trimmed on save. */
export const BrandDraftSchema = z.object({
  description: z.string(),
  targetAudience: z.string(),
  industry: z.string(),
  productsServices: z.array(z.string()).default([]),
  objectives: z.array(z.string()).default([]),
  voiceTone: z.string().default(""),
  keyMessages: z.array(z.string()).default([]),
  competitors: z.array(z.string()).default([]),
  messagingSummary: z.string().default("")
});
export type BrandDraft = z.infer<typeof BrandDraftSchema>;

export type BrandProfileDTO = BrandProfileInput & {
  id: string;
  version: number;
  source: "ai_draft" | "user_edit";
  confirmedAt: string | null;
  createdAt: string;
};

export const PROFILE_SKIP_REASONS = ["no_ai_provider", "fetch_blocked", "thin_content", "ai_failed", "emergency_stop", "not_permitted"] as const;
export type ProfileSkipReason = (typeof PROFILE_SKIP_REASONS)[number];
