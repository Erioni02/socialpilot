export const SOCIAL_PLATFORMS = ["instagram", "tiktok", "x"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const INTEGRATION_PROVIDERS = [
  "instagram",
  "tiktok",
  "x",
  "ga4",
  "plausible",
  "github",
  "vercel",
] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const INTEGRATION_KINDS = ["social", "analytics", "repository", "deployment"] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

export const AI_PROVIDERS = ["anthropic", "openai", "gemini", "replicate", "stability"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

/** Non-AI data providers that use API keys (search / news / measurement). */
export const DATA_PROVIDERS = ["newsapi", "producthunt", "pagespeed", "github_public"] as const;
export type DataProviderId = (typeof DATA_PROVIDERS)[number];

export const POST_TYPES = ["text", "thread", "image", "carousel", "video", "reel"] as const;
export type PostType = (typeof POST_TYPES)[number];

export const POST_STATUSES = [
  "draft",
  "in_review",
  "approved",
  "scheduled",
  "publishing",
  "published",
  "partially_published",
  "failed",
  "cancelled",
  "manual_handoff",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const TARGET_STATUSES = ["pending", "scheduled", "publishing", "published", "failed", "cancelled", "manual"] as const;
export type TargetStatus = (typeof TARGET_STATUSES)[number];

export const TASK_STATUSES = ["queued", "planning", "running", "awaiting_approval", "completed", "failed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const APPROVAL_TYPES = ["publish", "reply", "merge", "deploy", "spend", "code_change"] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const AGENT_TYPES = [
  "general",
  "marketing_strategy",
  "trend_research",
  "content_creation",
  "image_editing",
  "video_creation",
  "social_publishing",
  "community_management",
  "website_audit",
  "website_code",
  "analytics",
  "growth_experiments",
] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export const AGENT_LABELS: Record<AgentType, { name: string; description: string }> = {
  general: { name: "Operator", description: "Plans multi-step work across all agents and tools." },
  marketing_strategy: { name: "Marketing strategist", description: "Positioning, campaign plans, channel mix." },
  trend_research: { name: "Trend researcher", description: "Finds sourced developments relevant to the project." },
  content_creation: { name: "Content creator", description: "Writes posts, threads, captions and campaign drafts." },
  image_editing: { name: "Image editor", description: "Generates and edits images with real media tools." },
  video_creation: { name: "Video creator", description: "Storyboards, video generation and FFmpeg processing." },
  social_publishing: { name: "Publisher", description: "Schedules and publishes within approval rules." },
  community_management: { name: "Community manager", description: "Classifies comments and drafts replies." },
  website_audit: { name: "Website auditor", description: "Crawls the site and reports evidence-based issues." },
  website_code: { name: "Website engineer", description: "Reads the repo and proposes code changes on branches." },
  analytics: { name: "Analyst", description: "Reads measured metrics and separates facts from hypotheses." },
  growth_experiments: { name: "Growth experimenter", description: "Designs testable growth experiments." },
};

export const INBOX_CLASSES = ["question", "product_interest", "praise", "complaint", "sensitive", "spam", "other"] as const;
export type InboxClass = (typeof INBOX_CLASSES)[number];
