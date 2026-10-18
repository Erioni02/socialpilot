import { providerFetch, ProviderError } from "@socialpilot/core";
import type { AdapterContext, AppCredentials, MetricPoint, PublishMedia, PublishRequest, RemoteComment, SocialAdapter } from "./types";

/** X API v2 with OAuth 2.0 Authorization Code + PKCE. */
const API = "https://api.x.com/2";
const day = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const auth = (ctx: AdapterContext) => ({ authorization: `Bearer ${ctx.accessToken}` });
const basic = (c: AppCredentials) => `Basic ${Buffer.from(`${encodeURIComponent(c.clientId)}:${encodeURIComponent(c.clientSecret)}`).toString("base64")}`;

async function tokenRequest(creds: AppCredentials, form: Record<string, string>) {
  const r = await providerFetch<any>("x", `${API}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: basic(creds) },
    body: new URLSearchParams({ ...form, client_id: creds.clientId }).toString(),
  });
  return {
    accessToken: r.access_token as string,
    refreshToken: r.refresh_token as string | undefined,
    expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000) : null,
    scopes: String(r.scope ?? "").split(" ").filter(Boolean),
  };
}

async function uploadMedia(ctx: AdapterContext, m: PublishMedia): Promise<string> {
  const data = await m.load();
  if (m.kind === "image") {
    const form = new FormData();
    form.append("media", new Blob([new Uint8Array(data)], { type: m.mimeType }), "image");
    form.append("media_category", "tweet_image");
    const r = await providerFetch<any>("x", `${API}/media/upload`, { method: "POST", headers: auth(ctx), body: form });
    return String(r.data?.id ?? r.media_id_string);
  }
  // Chunked video upload: initialize → append segments → finalize → poll processing status.
  const init = await providerFetch<any>("x", `${API}/media/upload/initialize`, {
    method: "POST",
    headers: { ...auth(ctx), "content-type": "application/json" },
    body: JSON.stringify({ media_type: m.mimeType || "video/mp4", total_bytes: data.length, media_category: "tweet_video" }),
  });
  const id = String(init.data?.id);
  const SEG = 4 * 1024 * 1024;
  for (let i = 0, off = 0; off < data.length; i++, off += SEG) {
    const form = new FormData();
    form.append("media", new Blob([new Uint8Array(data.subarray(off, off + SEG))]), "chunk");
    form.append("segment_index", String(i));
    await providerFetch("x", `${API}/media/upload/${id}/append`, { method: "POST", headers: auth(ctx), body: form, timeoutMs: 120000 });
  }
  let fin = await providerFetch<any>("x", `${API}/media/upload/${id}/finalize`, { method: "POST", headers: auth(ctx) });
  let info = fin.data?.processing_info;
  const deadline = Date.now() + 10 * 60_000;
  while (info && (info.state === "pending" || info.state === "in_progress")) {
    if (Date.now() > deadline) throw new ProviderError("x", "video processing timed out", undefined, undefined, true);
    await sleep((info.check_after_secs ?? 3) * 1000);
    fin = await providerFetch<any>("x", `${API}/media/upload?command=STATUS&media_id=${id}`, { headers: auth(ctx) });
    info = fin.data?.processing_info;
  }
  if (info?.state === "failed") throw new ProviderError("x", `video processing failed: ${info.error?.message ?? ""}`);
  return id;
}

export const xAdapter: SocialAdapter = {
  platform: "x",
  usesPkce: true,
  buildAuthUrl({ creds, redirectUri, state, codeChallenge, scopes }) {
    const p = new URLSearchParams({
      response_type: "code",
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      scope: scopes.join(" "),
      state,
      code_challenge: codeChallenge!,
      code_challenge_method: "S256",
    });
    return `https://x.com/i/oauth2/authorize?${p.toString()}`;
  },
  async exchangeCode({ creds, code, redirectUri, codeVerifier }) {
    const tokens = await tokenRequest(creds, { grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier! });
    const account = await xAdapter.getProfile({ accessToken: tokens.accessToken, accountId: "", scopes: tokens.scopes, config: {} });
    return { tokens, account };
  },
  async refresh(creds, tokens) {
    if (!tokens.refreshToken) throw new ProviderError("x", "No refresh token (offline.access not granted); reconnect the account");
    const t = await tokenRequest(creds, { grant_type: "refresh_token", refresh_token: tokens.refreshToken });
    return { ...t, refreshToken: t.refreshToken ?? tokens.refreshToken };
  },
  async revoke(creds, tokens) {
    await providerFetch("x", `${API}/oauth2/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: basic(creds) },
      body: new URLSearchParams({ token: tokens.accessToken, token_type_hint: "access_token", client_id: creds.clientId }).toString(),
    });
  },
  async getProfile(ctx) {
    const r = await providerFetch<any>("x", `${API}/users/me?user.fields=public_metrics,profile_image_url,username,name,verified`, { headers: auth(ctx) });
    const u = r.data;
    return {
      id: u.id,
      name: u.name,
      handle: u.username,
      avatarUrl: u.profile_image_url,
      url: `https://x.com/${u.username}`,
      followers: u.public_metrics?.followers_count,
      following: u.public_metrics?.following_count,
      postsCount: u.public_metrics?.tweet_count,
      likes: u.public_metrics?.like_count,
    };
  },
  async getAccountMetrics(ctx) {
    const p = await xAdapter.getProfile(ctx);
    const today = day(new Date());
    const out: MetricPoint[] = [];
    if (p.followers != null) out.push({ metric: "followers", value: p.followers, date: today });
    if (p.following != null) out.push({ metric: "following", value: p.following, date: today });
    if (p.postsCount != null) out.push({ metric: "posts", value: p.postsCount, date: today });
    return out;
  },
  async listPosts(ctx, { limit }) {
    const r = await providerFetch<any>(
      "x",
      `${API}/users/${ctx.accountId}/tweets?max_results=${Math.max(5, Math.min(limit, 100))}&tweet.fields=created_at,public_metrics,non_public_metrics`,
      { headers: auth(ctx) },
    ).catch(async (err) => {
      // non_public_metrics is only allowed for posts < 30 days old; fall back to public metrics.
      if (err instanceof ProviderError && err.status === 400) {
        return providerFetch<any>("x", `${API}/users/${ctx.accountId}/tweets?max_results=${Math.max(5, Math.min(limit, 100))}&tweet.fields=created_at,public_metrics`, {
          headers: auth(ctx),
        });
      }
      throw err;
    });
    return (r.data ?? []).map((t: any) => ({
      id: t.id,
      text: t.text,
      url: `https://x.com/i/web/status/${t.id}`,
      createdAt: new Date(t.created_at),
      metrics: {
        likes: t.public_metrics?.like_count ?? 0,
        replies: t.public_metrics?.reply_count ?? 0,
        reposts: t.public_metrics?.retweet_count ?? 0,
        quotes: t.public_metrics?.quote_count ?? 0,
        bookmarks: t.public_metrics?.bookmark_count ?? 0,
        impressions: t.non_public_metrics?.impression_count ?? t.public_metrics?.impression_count ?? 0,
      },
    }));
  },
  async publish(ctx, req: PublishRequest, state, checkpoint) {
    const parts = req.type === "thread" && req.thread?.length ? req.thread : [req.text];
    const posted: string[] = (state.tweetIds as string[]) ?? [];
    let mediaIds = state.mediaIds as string[] | undefined;
    if (!mediaIds && req.media.length) {
      mediaIds = [];
      for (const m of req.media.slice(0, m0(req))) mediaIds.push(await uploadMedia(ctx, m));
      state = { ...state, mediaIds };
      await checkpoint(state);
    }
    // Resume a partially-posted thread from the last posted id instead of starting over.
    for (let i = posted.length; i < parts.length; i++) {
      const body: Record<string, unknown> = { text: parts[i] };
      if (i === 0 && mediaIds?.length) body.media = { media_ids: mediaIds };
      if (i > 0) body.reply = { in_reply_to_tweet_id: posted[i - 1] };
      const r = await providerFetch<any>("x", `${API}/tweets`, {
        method: "POST",
        headers: { ...auth(ctx), "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      posted.push(String(r.data.id));
      state = { ...state, tweetIds: posted };
      await checkpoint(state);
    }
    return { status: "published", remoteId: posted[0], remoteUrl: `https://x.com/i/web/status/${posted[0]}` };
  },
  async listComments(ctx, { since }) {
    const params = new URLSearchParams({
      max_results: "50",
      "tweet.fields": "created_at,author_id,conversation_id,in_reply_to_user_id,referenced_tweets",
      expansions: "author_id",
      "user.fields": "username,name",
    });
    if (since) params.set("start_time", since.toISOString());
    const r = await providerFetch<any>("x", `${API}/users/${ctx.accountId}/mentions?${params}`, { headers: auth(ctx) });
    const users = new Map<string, any>((r.includes?.users ?? []).map((u: any) => [u.id, u]));
    return (r.data ?? []).map((t: any): RemoteComment => {
      const u = users.get(t.author_id);
      const parent = (t.referenced_tweets ?? []).find((x: any) => x.type === "replied_to");
      return {
        id: t.id,
        kind: parent ? "reply" : "mention",
        text: t.text,
        authorName: u?.name,
        authorHandle: u?.username,
        createdAt: new Date(t.created_at),
        parentId: parent?.id,
        postId: t.conversation_id,
        url: `https://x.com/${u?.username ?? "i/web"}/status/${t.id}`,
      };
    });
  },
  async reply(ctx, { commentId, text }) {
    const r = await providerFetch<any>("x", `${API}/tweets`, {
      method: "POST",
      headers: { ...auth(ctx), "content-type": "application/json" },
      body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: commentId } }),
    });
    return { id: String(r.data.id), url: `https://x.com/i/web/status/${r.data.id}` };
  },
};

function m0(req: PublishRequest) {
  return req.media.some((m) => m.kind === "video") ? 1 : 4;
}
