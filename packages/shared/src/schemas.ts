import { z } from "zod";
import { AGENT_TYPES, POST_TYPES, SOCIAL_PLATFORMS } from "./enums";

const url = z
  .string()
  .trim()
  .max(2048)
  .transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`))
  .pipe(z.string().url());

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10, "Use at least 10 characters").max(256),
  name: z.string().trim().min(1).max(100),
});
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(256),
});

export const brandSchema = z.object({
  colors: z.array(z.string().max(32)).max(12).default([]),
  fonts: z.array(z.string().max(64)).max(6).default([]),
  voice: z.string().max(2000).default(""),
  tone: z.array(z.string().max(40)).max(12).default([]),
  guidelines: z.string().max(8000).default(""),
  doNotSay: z.array(z.string().max(120)).max(50).default([]),
  hashtags: z.array(z.string().max(60)).max(40).default([]),
});
export type Brand = z.infer<typeof brandSchema>;

export const productSchema = z.object({ name: z.string().max(200), description: z.string().max(2000).default("") });

export const projectProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  websiteUrl: url.optional().nullable(),
  logoUrl: z.string().max(2048).optional().nullable(),
  description: z.string().max(5000).optional().default(""),
  targetAudience: z.string().max(3000).optional().default(""),
  industry: z.string().max(200).optional().default(""),
  products: z.array(productSchema).max(50).optional().default([]),
  objectives: z.array(z.string().max(300)).max(20).optional().default([]),
  brand: brandSchema.optional(),
  timezone: z.string().max(64).optional().default("UTC"),
  competitors: z.array(z.string().max(200)).max(20).optional().default([]),
  keywords: z.array(z.string().max(80)).max(50).optional().default([]),
});
export const projectUpdateSchema = projectProfileSchema.partial().extend({
  setupStep: z.number().int().min(1).max(8).optional(),
  setupComplete: z.boolean().optional(),
});
export type ProjectProfileInput = z.infer<typeof projectProfileSchema>;

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  websiteUrl: url.optional().nullable(),
});

export const analyzeUrlSchema = z.object({ url, maxPages: z.number().int().min(1).max(30).optional() });

export const aiConfigSchema = z.object({
  textProvider: z.string().max(40).optional().nullable(),
  textModel: z.string().max(120).optional().nullable(),
  imageProvider: z.string().max(40).optional().nullable(),
  imageModel: z.string().max(120).optional().nullable(),
  videoProvider: z.string().max(40).optional().nullable(),
  videoModel: z.string().max(120).optional().nullable(),
  transcriptionProvider: z.string().max(40).optional().nullable(),
});
export type AiConfig = z.infer<typeof aiConfigSchema>;

export const providerCredentialSchema = z.object({
  provider: z.string().min(2).max(60),
  label: z.string().max(80).optional(),
  apiKey: z.string().min(8).max(4000).optional(),
  clientId: z.string().min(2).max(500).optional(),
  clientSecret: z.string().min(2).max(2000).optional(),
});

export const campaignSchema = z.object({
  name: z.string().trim().min(1).max(200),
  objective: z.string().max(2000).default(""),
  targetAudience: z.string().max(2000).default(""),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  platforms: z.array(z.enum(SOCIAL_PLATFORMS)).default([]),
  pillars: z.array(z.string().max(200)).max(20).default([]),
  guidelines: z.string().max(5000).default(""),
  budgetUsd: z.number().min(0).max(1_000_000).optional().nullable(),
  status: z.enum(["planning", "active", "paused", "completed", "archived"]).default("planning"),
});

export const platformVariantSchema = z.object({
  text: z.string().max(10000).default(""),
  thread: z.array(z.string().max(1000)).max(25).optional(),
  title: z.string().max(150).optional(),
  privacyLevel: z.enum(["SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "PUBLIC_TO_EVERYONE"]).optional(),
});

export const postSchema = z.object({
  title: z.string().max(200).default(""),
  type: z.enum(POST_TYPES).default("text"),
  body: z.string().max(10000).default(""),
  campaignId: z.string().optional().nullable(),
  platforms: z.array(z.enum(SOCIAL_PLATFORMS)).default([]),
  variants: z.record(z.enum(SOCIAL_PLATFORMS), platformVariantSchema).default({}),
  hashtags: z.array(z.string().max(80)).max(40).default([]),
  cta: z.string().max(500).default(""),
  link: z.string().max(2048).optional().nullable(),
  mediaAssetIds: z.array(z.string()).max(35).default([]),
  notes: z.string().max(5000).default(""),
});
export const postUpdateSchema = postSchema.partial();
export type PostInput = z.infer<typeof postSchema>;

export const scheduleSchema = z.object({
  scheduledAt: z.coerce.date(),
  timezone: z.string().max(64).default("UTC"),
  platforms: z.array(z.enum(SOCIAL_PLATFORMS)).min(1).optional(),
});

export const taskCreateSchema = z.object({
  instruction: z.string().trim().min(3).max(8000),
  agentType: z.enum(AGENT_TYPES).default("general"),
  attachmentAssetIds: z.array(z.string()).max(10).default([]),
  model: z.string().max(120).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

export const AUTOMATION_STEP_TYPES = [
  "gather_sources",
  "find_opportunities",
  "analyze_metrics",
  "create_drafts",
  "generate_media",
  "brand_safety_check",
  "schedule_drafts",
  "notify",
  "publish_approved",
  "sync_inbox",
  "classify_inbox",
  "website_audit",
  "agent_task",
] as const;
export type AutomationStepType = (typeof AUTOMATION_STEP_TYPES)[number];

export const automationStepSchema = z.object({
  id: z.string().max(60),
  type: z.enum(AUTOMATION_STEP_TYPES),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type AutomationStep = z.infer<typeof automationStepSchema>;

export const automationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).default(""),
  trigger: z.object({
    type: z.enum(["cron", "manual"]),
    cron: z.string().max(100).optional(),
    timezone: z.string().max(64).default("UTC"),
  }),
  steps: z.array(automationStepSchema).min(1).max(30),
  active: z.boolean().default(false),
  allowAutoPublish: z.boolean().default(false),
});

export const replySchema = z.object({ text: z.string().trim().min(1).max(2000) });

export const imageGenSchema = z.object({
  prompt: z.string().trim().min(3).max(4000),
  size: z.enum(["1024x1024", "1024x1536", "1536x1024"]).default("1024x1024"),
  folder: z.string().max(200).default("/"),
  campaignId: z.string().optional().nullable(),
  provider: z.string().max(40).optional(),
  model: z.string().max(120).optional(),
  n: z.number().int().min(1).max(4).default(1),
});

export const imageOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("crop"), left: z.number().int().min(0), top: z.number().int().min(0), width: z.number().int().min(1), height: z.number().int().min(1) }),
  z.object({ op: z.literal("resize"), width: z.number().int().min(16).max(8192), height: z.number().int().min(16).max(8192), fit: z.enum(["cover", "contain", "fill", "inside"]).default("cover") }),
  z.object({ op: z.literal("preset"), preset: z.enum(["instagram_square", "instagram_portrait", "story_9_16", "x_landscape", "tiktok_9_16"]) }),
  z.object({ op: z.literal("format"), format: z.enum(["jpeg", "png", "webp"]), quality: z.number().int().min(30).max(100).default(90) }),
  z.object({
    op: z.literal("brand"),
    overlayText: z.string().max(200).optional(),
    textPosition: z.enum(["top", "bottom", "center"]).default("bottom"),
    color: z.string().max(32).optional(),
    logoAssetId: z.string().optional(),
    border: z.number().int().min(0).max(200).default(0),
  }),
  z.object({ op: z.literal("ai_edit"), instruction: z.string().min(3).max(2000), provider: z.string().optional(), model: z.string().optional() }),
  z.object({ op: z.literal("remove_background"), provider: z.string().optional() }),
  z.object({ op: z.literal("variations"), n: z.number().int().min(1).max(4).default(2), instruction: z.string().max(1000).optional() }),
]);
export type ImageOp = z.infer<typeof imageOpSchema>;

export const videoOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("trim"), start: z.number().min(0), end: z.number().min(0.1) }),
  z.object({ op: z.literal("aspect"), aspect: z.enum(["9:16", "1:1", "16:9", "4:5"]), mode: z.enum(["crop", "pad"]).default("crop") }),
  z.object({ op: z.literal("subtitles"), srt: z.string().max(100000).optional(), autoTranscribe: z.boolean().default(false) }),
  z.object({ op: z.literal("concat"), assetIds: z.array(z.string()).min(1).max(20) }),
  z.object({ op: z.literal("thumbnail"), at: z.number().min(0).default(1) }),
  z.object({ op: z.literal("compress"), crf: z.number().int().min(18).max(35).default(26) }),
]);
export type VideoOp = z.infer<typeof videoOpSchema>;

export const videoGenSchema = z.object({
  prompt: z.string().trim().min(3).max(4000),
  imageAssetId: z.string().optional(),
  aspect: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
  durationSec: z.number().int().min(2).max(20).default(6),
  provider: z.string().optional(),
  model: z.string().optional(),
  folder: z.string().max(200).default("/"),
  campaignId: z.string().optional().nullable(),
});
