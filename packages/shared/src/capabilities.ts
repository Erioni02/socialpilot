import type { SocialPlatform } from "./enums";

export const SOCIAL_OPERATIONS = [
  "read_profile",
  "read_metrics",
  "list_posts",
  "read_post_metrics",
  "publish_text",
  "publish_thread",
  "publish_image",
  "publish_carousel",
  "publish_video",
  "native_scheduling",
  "list_comments",
  "reply_comment",
  "list_mentions",
] as const;
export type SocialOperation = (typeof SOCIAL_OPERATIONS)[number];

export const OPERATION_LABELS: Record<SocialOperation, string> = {
  read_profile: "Read profile",
  read_metrics: "Account metrics",
  list_posts: "List posts",
  read_post_metrics: "Post metrics",
  publish_text: "Publish text post",
  publish_thread: "Publish thread",
  publish_image: "Publish image",
  publish_carousel: "Publish carousel",
  publish_video: "Publish video / reel",
  native_scheduling: "Platform-native scheduling",
  list_comments: "Read comments",
  reply_comment: "Reply to comments",
  list_mentions: "Read mentions",
};

export interface CapabilitySpec {
  supported: boolean;
  /** OAuth scopes that must be granted for the operation. */
  scopes?: string[];
  /** Human-readable caveats (account type, review, paid tier...). */
  notes?: string;
  /** What to do instead when unsupported. */
  alternative?: string;
}

/**
 * Static capability registry, written from each platform's official API documentation.
 * Effective capabilities are this registry intersected with the scopes actually granted and the last connection test.
 */
export const CAPABILITY_REGISTRY: Record<SocialPlatform, Record<SocialOperation, CapabilitySpec>> = {
  instagram: {
    read_profile: { supported: true, scopes: ["instagram_business_basic"] },
    read_metrics: {
      supported: true,
      scopes: ["instagram_business_basic", "instagram_business_manage_insights"],
      notes: "Requires an Instagram Business or Creator account.",
    },
    list_posts: { supported: true, scopes: ["instagram_business_basic"] },
    read_post_metrics: { supported: true, scopes: ["instagram_business_manage_insights"] },
    publish_text: {
      supported: false,
      notes: "Instagram feed posts must contain an image or video.",
      alternative: "Generate an image (e.g. a branded quote card) and publish it as an image post.",
    },
    publish_thread: { supported: false, alternative: "Use a carousel to tell a multi-part story." },
    publish_image: {
      supported: true,
      scopes: ["instagram_business_content_publish"],
      notes: "JPEG only; the media must be reachable at a public HTTPS URL (set PUBLIC_BASE_URL). 100 API-published posts per 24h.",
    },
    publish_carousel: { supported: true, scopes: ["instagram_business_content_publish"], notes: "2–10 images/videos." },
    publish_video: { supported: true, scopes: ["instagram_business_content_publish"], notes: "Published as a Reel. MP4/H.264, public URL required." },
    native_scheduling: {
      supported: false,
      notes: "The Graph API has no scheduling endpoint.",
      alternative: "SocialPilot schedules with its own persistent background jobs.",
    },
    list_comments: { supported: true, scopes: ["instagram_business_manage_comments"] },
    reply_comment: { supported: true, scopes: ["instagram_business_manage_comments"] },
    list_mentions: {
      supported: false,
      notes: "Mentions are delivered via webhooks for approved apps only.",
      alternative: "Comments on your own media are synced into the Inbox.",
    },
  },
  tiktok: {
    read_profile: { supported: true, scopes: ["user.info.basic"] },
    read_metrics: { supported: true, scopes: ["user.info.stats"], notes: "Follower, following, likes and video counts." },
    list_posts: { supported: true, scopes: ["video.list"] },
    read_post_metrics: { supported: true, scopes: ["video.list"], notes: "Views, likes, comments and shares per video." },
    publish_text: { supported: false, alternative: "Publish a short video or a photo post." },
    publish_thread: { supported: false },
    publish_image: {
      supported: true,
      scopes: ["video.publish"],
      notes: "Photo posts use PULL_FROM_URL and require a verified URL prefix in the TikTok developer portal.",
    },
    publish_carousel: { supported: true, scopes: ["video.publish"], notes: "Photo mode, up to 35 images; verified URL prefix required." },
    publish_video: {
      supported: true,
      scopes: ["video.publish"],
      notes: "Unaudited apps can only post with SELF_ONLY (private) visibility until TikTok approves the app.",
    },
    native_scheduling: { supported: false, alternative: "SocialPilot schedules with its own background jobs." },
    list_comments: {
      supported: false,
      notes: "TikTok's public APIs do not expose comments of your videos to third-party apps.",
      alternative: "Use a manual handoff: open TikTok Studio to answer comments.",
    },
    reply_comment: { supported: false, alternative: "Manual handoff via TikTok Studio." },
    list_mentions: { supported: false },
  },
  x: {
    read_profile: { supported: true, scopes: ["users.read", "tweet.read"] },
    read_metrics: { supported: true, scopes: ["users.read"], notes: "Public metrics (followers, following, post count). Reads require a paid API plan." },
    list_posts: { supported: true, scopes: ["tweet.read", "users.read"] },
    read_post_metrics: { supported: true, scopes: ["tweet.read"], notes: "Public metrics; impressions only for your own posts." },
    publish_text: { supported: true, scopes: ["tweet.write", "tweet.read", "users.read"] },
    publish_thread: { supported: true, scopes: ["tweet.write"], notes: "Published as a chain of replies." },
    publish_image: { supported: true, scopes: ["tweet.write", "media.write"], notes: "Up to 4 images per post." },
    publish_carousel: { supported: true, scopes: ["tweet.write", "media.write"], notes: "Up to 4 images per post." },
    publish_video: { supported: true, scopes: ["tweet.write", "media.write"], notes: "Chunked upload; MP4/H.264, up to 140s for most accounts." },
    native_scheduling: { supported: false, alternative: "SocialPilot schedules with its own background jobs." },
    list_comments: { supported: true, scopes: ["tweet.read"], notes: "Replies are retrieved through mentions/search; search requires a paid plan." },
    reply_comment: { supported: true, scopes: ["tweet.write"] },
    list_mentions: { supported: true, scopes: ["tweet.read", "users.read"] },
  },
};

export interface EffectiveCapability extends CapabilitySpec {
  operation: SocialOperation;
  label: string;
  /** supported by platform AND scopes granted */
  available: boolean;
  missingScopes: string[];
}

export function effectiveCapabilities(platform: SocialPlatform, grantedScopes: string[]): EffectiveCapability[] {
  const granted = new Set(grantedScopes);
  return (Object.keys(CAPABILITY_REGISTRY[platform]) as SocialOperation[]).map((operation) => {
    const spec = CAPABILITY_REGISTRY[platform][operation];
    const missingScopes = (spec.scopes ?? []).filter((s) => !granted.has(s));
    return {
      ...spec,
      operation,
      label: OPERATION_LABELS[operation],
      available: spec.supported && missingScopes.length === 0,
      missingScopes,
    };
  });
}

export function explainUnavailable(platform: SocialPlatform, operation: SocialOperation, grantedScopes: string[]): string | null {
  const cap = effectiveCapabilities(platform, grantedScopes).find((c) => c.operation === operation)!;
  if (cap.available) return null;
  if (!cap.supported) {
    return `${platform} does not support "${cap.label}" through its official API.${cap.notes ? " " + cap.notes : ""}${
      cap.alternative ? " Alternative: " + cap.alternative : ""
    }`;
  }
  return `"${cap.label}" on ${platform} needs these permissions, which were not granted: ${cap.missingScopes.join(", ")}. Reconnect the account and approve them.`;
}

/** Platform content constraints used by quality checks and previews. */
export const PLATFORM_LIMITS: Record<SocialPlatform, { maxChars: number; maxHashtags: number; maxImages: number; videoMaxSec: number }> = {
  instagram: { maxChars: 2200, maxHashtags: 30, maxImages: 10, videoMaxSec: 900 },
  tiktok: { maxChars: 2200, maxHashtags: 30, maxImages: 35, videoMaxSec: 600 },
  x: { maxChars: 280, maxHashtags: 10, maxImages: 4, videoMaxSec: 140 },
};
