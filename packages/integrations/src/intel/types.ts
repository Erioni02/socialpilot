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
  /** Credits used on a credit-based source (SocialCrawl, PostPeer, RapidAPI requests). */
  credits?: number;
  /** Account statistics and audience demographics (RapidAPI Instagram Statistics API). */
  audience?: AudienceInsights;
}

export interface AudienceInsights {
  qualityScore?: number;
  fakeFollowersPct?: number;
  avgEngagementRate?: number;
  avgInteractions?: number;
  avgLikes?: number;
  avgComments?: number;
  avgViews?: number;
  followerGrowth180dPct?: number;
  accountType?: string;
  categories?: string[];
  country?: string;
  audienceTypes: { name: string; percent: number }[];
  reachability: { name: string; percent: number }[];
  countries: { name: string; percent: number }[];
  cities: { name: string; percent: number }[];
  genders: { name: string; percent: number }[];
  ages: { name: string; percent: number }[];
  genderAge: { age: string; m: number; f: number }[];
  brandSafety?: Record<string, number>;
  mentions180d?: { posts?: number; accounts?: number; reach?: number };
  /** Share of the audience the provider has analyzed (0–1); ≥ 0.1 is usable. */
  demographicsCoverage?: number;
  dataStatus?: string;
  statsUpdatedAt?: string;
  postsUpdatedAt?: string;
}

export type IntelStatus = "ok" | "partial" | "unavailable" | "private" | "not_found" | "rate_limited" | "error";

export interface IntelOutcome {
  status: IntelStatus;
  result?: IntelResult;
  message?: string;
  /** Paid, opt-in sources that could retrieve this (never run without explicit approval). */
  paidOptions?: PaidOption[];
  /** Quota state reported by a quota-based source (RapidAPI). */
  quota?: { limit?: number; remaining?: number; resetInSec?: number; hardLimit: boolean };
}

export type PaidSourceKey = "apify" | "socialcrawl" | "postpeer" | "rapidapi";

export interface PaidOption {
  provider: string;
  label: string;
  /** Which stored key this source needs. */
  requires: PaidSourceKey;
  /** Apify sources bill in USD … */
  estimatedCostUsd?: number;
  /** … SocialCrawl / PostPeer bill in credits. */
  estimatedCredits?: number;
  /** Quota-based sources: requests used from the monthly allowance. */
  estimatedRequests?: number;
  note: string;
}

export interface IntelProvider {
  id: string;
  label: string;
  paid: boolean;
  supports(u: ParsedSocialUrl): boolean;
  fetch(u: ParsedSocialUrl, opts: { apifyToken?: string; socialcrawlKey?: string; postpeerKey?: string; rapidapiKey?: string; maxChargeUsd?: number }): Promise<IntelOutcome>;
}
