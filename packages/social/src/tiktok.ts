import { providerFetch, ProviderError, SetupRequiredError } from "@socialpilot/core";
import type { AdapterContext, MetricPoint, PublishRequest, SocialAdapter } from "./types";

/** TikTok Login Kit v2 + Display API + Content Posting API. */
const API = "https://open.tiktokapis.com/v2";
const day = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

async function tt<T = any>(ctx: AdapterContext, path: string, body?: unknown, method = body ? "POST" : "GET"): Promise<T> {
  const r = await providerFetch<any>("tiktok", `${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${ctx.accessToken}`, "content-type": "application/json; charset=UTF-8" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r?.error?.code && r.error.code !== "ok") throw new ProviderError("tiktok", `${r.error.code}: ${r.error.message ?? ""}`);
  return r.data as T;
}

async function tokenRequest(form: Record<string, string>) {
  const r = await providerFetch<any>("tiktok", `${API}/oauth/token/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  if (r.error && r.error !== "ok") throw new ProviderError("tiktok", `${r.error}: ${r.error_description ?? ""}`);
  return {
    accessToken: r.access_token as string,
    refreshToken: r.refresh_token as string,
    expiresAt: new Date(Date.now() + (r.expires_in ?? 86400) * 1000),
    refreshExpiresAt: r.refresh_expires_in ? new Date(Date.now() + r.refresh_expires_in * 1000) : null,
    scopes: String(r.scope ?? "").split(",").filter(Boolean),
    openId: r.open_id as string,
  };
}

const USER_FIELDS = "open_id,union_id,avatar_url,display_name,username,profile_deep_link,follower_count,following_count,likes_count,video_count";

export const tiktokAdapter: SocialAdapter = {
  platform: "tiktok",
  usesPkce: false,
  buildAuthUrl({ creds, redirectUri, state, scopes }) {
    const p = new URLSearchParams({ client_key: creds.clientId, scope: scopes.join(","), response_type: "code", redirect_uri: redirectUri, state });
    return `https://www.tiktok.com/v2/auth/authorize/?${p.toString()}`;
  },
  async exchangeCode({ creds, code, redirectUri }) {
    const t = await tokenRequest({ client_key: creds.clientId, client_secret: creds.clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri });
    const account = await tiktokAdapter.getProfile({ accessToken: t.accessToken, accountId: t.openId, scopes: t.scopes, config: {} });
    return { tokens: t, account };
  },
  async refresh(creds, tokens) {
    if (!tokens.refreshToken) throw new ProviderError("tiktok", "No refresh token; reconnect the account");
    return tokenRequest({ client_key: creds.clientId, client_secret: creds.clientSecret, grant_type: "refresh_token", refresh_token: tokens.refreshToken });
  },
  async revoke(creds, tokens) {
    await providerFetch("tiktok", `${API}/oauth/revoke/`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_key: creds.clientId, client_secret: creds.clientSecret, token: tokens.accessToken }).toString(),
    });
  },
  async getProfile(ctx) {
    const fields = ctx.scopes.includes("user.info.stats") ? USER_FIELDS : "open_id,union_id,avatar_url,display_name";
    const d = await tt<any>(ctx, `/user/info/?fields=${fields}`);
    const u = d.user ?? {};
    return {
      id: u.open_id ?? ctx.accountId,
      name: u.display_name,
      handle: u.username,
      avatarUrl: u.avatar_url,
      url: u.profile_deep_link ?? (u.username ? `https://www.tiktok.com/@${u.username}` : undefined),
      followers: u.follower_count,
      following: u.following_count,
      likes: u.likes_count,
      postsCount: u.video_count,
    };
  },
  async getAccountMetrics(ctx) {
    const p = await tiktokAdapter.getProfile(ctx);
    const today = day(new Date());
    const out: MetricPoint[] = [];
    if (p.followers != null) out.push({ metric: "followers", value: p.followers, date: today });
    if (p.following != null) out.push({ metric: "following", value: p.following, date: today });
    if (p.likes != null) out.push({ metric: "likes_total", value: p.likes, date: today });
    if (p.postsCount != null) out.push({ metric: "posts", value: p.postsCount, date: today });
    if (ctx.scopes.includes("video.list")) {
      const posts = await tiktokAdapter.listPosts(ctx, { limit: 20 });
      out.push({ metric: "recent_views", value: posts.reduce((s, x) => s + (x.metrics.views ?? 0), 0), date: today, dimension: "last20" });
    }
    return out;
  },
  async listPosts(ctx, { limit }) {
    const fields = "id,title,video_description,create_time,cover_image_url,share_url,view_count,like_count,comment_count,share_count,duration";
    const d = await tt<any>(ctx, `/video/list/?fields=${fields}`, { max_count: Math.min(limit, 20) });
    return (d.videos ?? []).map((v: any) => ({
      id: v.id,
      text: v.video_description || v.title || "",
      url: v.share_url,
      mediaType: "VIDEO",
      thumbnailUrl: v.cover_image_url,
      createdAt: new Date((v.create_time ?? 0) * 1000),
      metrics: { views: v.view_count ?? 0, likes: v.like_count ?? 0, comments: v.comment_count ?? 0, shares: v.share_count ?? 0 },
    }));
  },
  async publish(ctx, req: PublishRequest, state, checkpoint) {
    if (state.publishId) return (await tiktokAdapter.checkPublishStatus!(ctx, state)) as any;
    const creator = await tt<any>(ctx, "/post/publish/creator_info/query/", {});
    const options: string[] = creator.privacy_level_options ?? [];
    const privacy = req.privacyLevel && options.includes(req.privacyLevel) ? req.privacyLevel : options.includes("SELF_ONLY") ? "SELF_ONLY" : options[0];
    if (!privacy) throw new ProviderError("tiktok", "This creator account cannot post right now (no privacy options returned).");

    const images = req.media.filter((m) => m.kind === "image");
    const video = req.media.find((m) => m.kind === "video");
    let publishId: string;
    if (video) {
      if (creator.max_video_post_duration_sec == null) {
        /* informational only */
      }
      const size = video.sizeBytes;
      const MB = 1024 * 1024;
      const chunkSize = size <= 64 * MB ? size : 10 * MB;
      const totalChunks = size <= 64 * MB ? 1 : Math.floor(size / chunkSize);
      const init = await tt<any>(ctx, "/post/publish/video/init/", {
        post_info: { title: req.text.slice(0, 2200), privacy_level: privacy, disable_comment: false, disable_duet: false, disable_stitch: false },
        source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunkSize, total_chunk_count: totalChunks },
      });
      publishId = init.publish_id;
      await checkpoint({ ...state, publishId, privacy });
      const data = await video.load();
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = i === totalChunks - 1 ? size - 1 : start + chunkSize - 1;
        const res = await fetch(init.upload_url, {
          method: "PUT",
          headers: { "content-type": video.mimeType || "video/mp4", "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
          body: new Uint8Array(data.subarray(start, end + 1)),
        });
        if (!res.ok && res.status !== 206) throw new ProviderError("tiktok", `video upload chunk ${i + 1} failed (HTTP ${res.status})`, res.status, undefined, true);
      }
    } else if (images.length) {
      const urls = images.map((m) => {
        if (!m.publicUrl) {
          throw new SetupRequiredError("TikTok photo posts pull images from a public URL on a verified domain. Set PUBLIC_BASE_URL and verify it in the TikTok developer portal.", {
            kind: "config",
            provider: "tiktok",
          });
        }
        return m.publicUrl;
      });
      const init = await tt<any>(ctx, "/post/publish/content/init/", {
        post_info: { title: (req.title ?? req.text).slice(0, 90), description: req.text.slice(0, 4000), privacy_level: privacy, disable_comment: false },
        source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: urls.slice(0, 35) },
        post_mode: "DIRECT_POST",
        media_type: "PHOTO",
      });
      publishId = init.publish_id;
      await checkpoint({ ...state, publishId, privacy });
    } else {
      throw new ProviderError("tiktok", "TikTok posts require a video or images.");
    }
    return { status: "processing", remoteId: undefined };
  },
  async checkPublishStatus(ctx, state) {
    const d = await tt<any>(ctx, "/post/publish/status/fetch/", { publish_id: state.publishId });
    if (d.status === "FAILED") return { status: "processing", failed: d.fail_reason ?? "TikTok reported FAILED" };
    if (d.status === "PUBLISH_COMPLETE") {
      const id = d.publicaly_available_post_id?.[0] ?? d.publicly_available_post_id?.[0];
      return { status: "published", remoteId: id ? String(id) : String(state.publishId), remoteUrl: undefined };
    }
    return { status: "processing" };
  },
};
