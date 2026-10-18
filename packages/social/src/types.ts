import type { SocialPlatform } from "@socialpilot/shared";

export interface AppCredentials {
  clientId: string;
  clientSecret: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date | null;
  refreshExpiresAt?: Date | null;
  scopes: string[];
}

export interface AccountInfo {
  id: string;
  name?: string;
  handle?: string;
  avatarUrl?: string;
  url?: string;
  accountType?: string;
  followers?: number;
  following?: number;
  postsCount?: number;
  likes?: number;
}

export interface AdapterContext {
  accessToken: string;
  accountId: string;
  scopes: string[];
  config: Record<string, unknown>;
}

export interface MetricPoint {
  metric: string;
  value: number;
  /** UTC day the value refers to; for gauges (followers) this is the capture day. */
  date: Date;
  dimension?: string;
}

export interface RemotePost {
  id: string;
  text: string;
  url?: string;
  mediaType?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  createdAt: Date;
  metrics: Record<string, number>;
}

export interface RemoteComment {
  id: string;
  kind: "comment" | "reply" | "mention";
  text: string;
  authorName?: string;
  authorHandle?: string;
  createdAt: Date;
  postId?: string;
  postUrl?: string;
  parentId?: string;
  url?: string;
}

export interface PublishMedia {
  kind: "image" | "video";
  mimeType: string;
  /** Public HTTPS URL the platform can fetch (required by Instagram/TikTok). */
  publicUrl?: string;
  sizeBytes: number;
  load(): Promise<Buffer>;
}

export interface PublishRequest {
  type: "text" | "thread" | "image" | "carousel" | "video" | "reel";
  text: string;
  thread?: string[];
  title?: string;
  media: PublishMedia[];
  /** TikTok privacy level; must be one of the creator's allowed options. */
  privacyLevel?: string;
}

export interface PublishResult {
  status: "published" | "processing";
  remoteId?: string;
  remoteUrl?: string;
}

/** Persisted provider state lets a retried publish resume instead of duplicating (e.g. containers already created). */
export type ProviderState = Record<string, unknown>;
export type Checkpoint = (state: ProviderState) => Promise<void>;

export interface SocialAdapter {
  platform: SocialPlatform;
  usesPkce: boolean;
  buildAuthUrl(args: { creds: AppCredentials; redirectUri: string; state: string; codeChallenge?: string; scopes: string[] }): string;
  exchangeCode(args: { creds: AppCredentials; code: string; redirectUri: string; codeVerifier?: string }): Promise<{ tokens: OAuthTokens; account: AccountInfo }>;
  refresh?(creds: AppCredentials, tokens: OAuthTokens): Promise<OAuthTokens>;
  revoke?(creds: AppCredentials, tokens: OAuthTokens): Promise<void>;
  getProfile(ctx: AdapterContext): Promise<AccountInfo>;
  getAccountMetrics(ctx: AdapterContext, range: { since: Date; until: Date }): Promise<MetricPoint[]>;
  listPosts(ctx: AdapterContext, opts: { limit: number }): Promise<RemotePost[]>;
  publish(ctx: AdapterContext, req: PublishRequest, state: ProviderState, checkpoint: Checkpoint): Promise<PublishResult>;
  checkPublishStatus?(ctx: AdapterContext, state: ProviderState): Promise<PublishResult & { failed?: string }>;
  listComments?(ctx: AdapterContext, opts: { since?: Date; postIds?: string[] }): Promise<RemoteComment[]>;
  reply?(ctx: AdapterContext, args: { commentId: string; text: string }): Promise<{ id: string; url?: string }>;
}
