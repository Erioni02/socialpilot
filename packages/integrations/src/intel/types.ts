import type { IntelKind, IntelPlatform, ParsedSocialUrl } from "./urls";

/** Comparable metric names. Only aggregate metrics that share a definition across sources. */
export type MetricKey =
  | "views" // video plays / view counts as reported by the platform
  | "likes"
  | "comments" // TikTok/Instagram comments, X replies
  | "shares" // TikTok shares, X reposts
  | "quotes"
  | "saves"
  | "followers"
  | "following"
  | "posts"
  | "total_likes"; // lifetime likes received by a creator

export interface MetricValue {
  value: number;
  /** True when the source rounds (e.g. "9.0M") or estimates. */
  approx?: boolean;
}

export interface IntelProfile {
  handle?: string;
  displayName?: string;
  avatarUrl?: string;
  verified?: boolean;
  bio?: string;
  private?: boolean;
}

export interface IntelPost {
  id: string;
  url: string;
  text?: string;
  createdAt?: string;
  thumbnailUrl?: string;
  metrics: Partial<Record<MetricKey, MetricValue>>;
}

export interface IntelResult {
  platform: IntelPlatform;
  kind: IntelKind;
  externalId: string;
  url: string;
  title?: string;
  createdAt?: string;
  profile?: IntelProfile;
  /** Creator stats attached to a post (e.g. TikTok authorStats). Stored separately from post metrics. */
  author?: { profile: IntelProfile; metrics: Partial<Record<MetricKey, MetricValue>> };
  metrics: Partial<Record<MetricKey, MetricValue>>;
  posts?: IntelPost[];
  unavailable: { metric: MetricKey | string; reason: string }[];
  source: string;
  sourceLabel: string;
  confidence: "exact" | "rounded" | "partial";
  costUsd?: number;
}

export type IntelStatus = "ok" | "partial" | "unavailable" | "private" | "not_found" | "rate_limited" | "error";

export interface IntelOutcome {
  status: IntelStatus;
  result?: IntelResult;
  message?: string;
  /** Paid, opt-in sources that could retrieve this (never run without explicit approval). */
  paidOptions?: { provider: string; label: string; estimatedCostUsd: number; note: string }[];
}

export interface IntelProvider {
  id: string;
  label: string;
  paid: boolean;
  supports(u: ParsedSocialUrl): boolean;
  fetch(u: ParsedSocialUrl, opts: { apifyToken?: string; maxChargeUsd?: number }): Promise<IntelOutcome>;
}
