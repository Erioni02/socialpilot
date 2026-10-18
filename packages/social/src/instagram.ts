import { providerFetch, ProviderError, SetupRequiredError } from "@socialpilot/core";
import type { AdapterContext, MetricPoint, PublishRequest, RemoteComment, SocialAdapter } from "./types";

/** Instagram API with Instagram Login (graph.instagram.com). */
const GRAPH = "https://graph.instagram.com/v23.0";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const day = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

function q(params: Record<string, string | number | undefined>) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
}

async function graph<T = any>(ctx: AdapterContext, path: string, params: Record<string, string | number | undefined> = {}, method = "GET"): Promise<T> {
  const all = { ...params, access_token: ctx.accessToken };
  if (method === "GET") return providerFetch<T>("instagram", `${GRAPH}${path}?${q(all)}`);
  return providerFetch<T>("instagram", `${GRAPH}${path}`, {
    method,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: q(all),
  });
}

function requirePublicUrl(m: { publicUrl?: string }) {
  if (!m.publicUrl) {
    throw new SetupRequiredError(
      "Instagram downloads media from a public HTTPS URL. Set PUBLIC_BASE_URL to a URL where the SocialPilot API is reachable from the internet.",
      { kind: "config", provider: "instagram" },
    );
  }
  return m.publicUrl;
}

async function waitForContainer(ctx: AdapterContext, id: string, timeoutMs = 5 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = await graph<{ status_code: string; status?: string }>(ctx, `/${id}`, { fields: "status_code,status" });
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new ProviderError("instagram", `media container ${s.status_code}: ${s.status ?? ""}`);
    if (Date.now() > deadline) throw new ProviderError("instagram", "media processing timed out", undefined, undefined, true);
    await sleep(4000);
  }
}

export const instagramAdapter: SocialAdapter = {
  platform: "instagram",
  usesPkce: false,
  buildAuthUrl({ creds, redirectUri, state, scopes }) {
    return `https://www.instagram.com/oauth/authorize?${q({
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes.join(","),
      state,
      enable_fb_login: 0,
    })}`;
  },
  async exchangeCode({ creds, code, redirectUri }) {
    const form = new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    });
    const short = await providerFetch<any>("instagram", "https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const data = short.data?.[0] ?? short;
    // Exchange for a long-lived (60 day) token.
    const long = await providerFetch<any>(
      "instagram",
      `https://graph.instagram.com/access_token?${q({ grant_type: "ig_exchange_token", client_secret: creds.clientSecret, access_token: data.access_token })}`,
    );
    const scopes: string[] = typeof data.permissions === "string" ? data.permissions.split(",") : (data.permissions ?? []);
    const tokens = {
      accessToken: long.access_token as string,
      expiresAt: new Date(Date.now() + (long.expires_in ?? 5184000) * 1000),
      scopes,
    };
    const account = await instagramAdapter.getProfile({ accessToken: tokens.accessToken, accountId: String(data.user_id), scopes, config: {} });
    return { tokens, account };
  },
  async refresh(_creds, tokens) {
    const r = await providerFetch<any>("instagram", `https://graph.instagram.com/refresh_access_token?${q({ grant_type: "ig_refresh_token", access_token: tokens.accessToken })}`);
    return { ...tokens, accessToken: r.access_token, expiresAt: new Date(Date.now() + (r.expires_in ?? 5184000) * 1000) };
  },
  async getProfile(ctx) {
    const me = await graph(ctx, "/me", { fields: "user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count" });
    return {
      id: String(me.user_id ?? me.id),
      name: me.name,
      handle: me.username,
      avatarUrl: me.profile_picture_url,
      url: me.username ? `https://www.instagram.com/${me.username}/` : undefined,
      accountType: me.account_type,
      followers: me.followers_count,
      following: me.follows_count,
      postsCount: me.media_count,
    };
  },
  async getAccountMetrics(ctx, range) {
    const out: MetricPoint[] = [];
    const profile = await instagramAdapter.getProfile(ctx);
    const today = day(new Date());
    if (profile.followers != null) out.push({ metric: "followers", value: profile.followers, date: today });
    if (profile.postsCount != null) out.push({ metric: "posts", value: profile.postsCount, date: today });
    // Daily time series: reach. Totals over the range: views, interactions, accounts engaged.
    const since = Math.floor(range.since.getTime() / 1000);
    const until = Math.floor(range.until.getTime() / 1000);
    try {
      const series = await graph(ctx, `/${ctx.accountId}/insights`, { metric: "reach", period: "day", since, until });
      for (const m of series.data ?? []) {
        for (const v of m.values ?? []) out.push({ metric: m.name, value: Number(v.value ?? 0), date: day(new Date(v.end_time)) });
      }
      const totals = await graph(ctx, `/${ctx.accountId}/insights`, {
        metric: "views,total_interactions,accounts_engaged,profile_links_taps",
        period: "day",
        metric_type: "total_value",
        since,
        until,
      });
      for (const m of totals.data ?? []) {
        out.push({ metric: `${m.name}_period`, value: Number(m.total_value?.value ?? 0), date: day(range.until), dimension: `range:${range.since.toISOString().slice(0, 10)}` });
      }
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err;
      // Insights need instagram_business_manage_insights and a professional account; profile counts are still returned.
      out.push({ metric: "_insights_error", value: 0, date: today, dimension: err.message.slice(0, 180) });
    }
    return out;
  },
  async listPosts(ctx, { limit }) {
    const r = await graph(ctx, "/me/media", {
      fields: "id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count",
      limit,
    });
    return (r.data ?? []).map((m: any) => ({
      id: m.id,
      text: m.caption ?? "",
      url: m.permalink,
      mediaType: m.media_type,
      mediaUrl: m.media_url,
      thumbnailUrl: m.thumbnail_url,
      createdAt: new Date(m.timestamp),
      metrics: { likes: m.like_count ?? 0, comments: m.comments_count ?? 0 },
    }));
  },
  async publish(ctx, req: PublishRequest, state, checkpoint) {
    if (state.mediaId) return { status: "published", remoteId: String(state.mediaId), remoteUrl: state.permalink as string | undefined };
    if (!req.media.length) {
      throw new ProviderError("instagram", "Instagram posts require at least one image or video. Generate or attach media first.");
    }
    const caption = req.text;
    let creationId = state.containerId as string | undefined;
    if (!creationId) {
      if (req.media.length === 1) {
        const m = req.media[0];
        const params =
          m.kind === "video"
            ? { media_type: "REELS", video_url: requirePublicUrl(m), caption }
            : { image_url: requirePublicUrl(m), caption };
        creationId = (await graph(ctx, `/${ctx.accountId}/media`, params, "POST")).id as string;
      } else {
        const children: string[] = (state.children as string[]) ?? [];
        for (let i = children.length; i < Math.min(req.media.length, 10); i++) {
          const m = req.media[i];
          const params =
            m.kind === "video"
              ? { media_type: "VIDEO", video_url: requirePublicUrl(m), is_carousel_item: "true" }
              : { image_url: requirePublicUrl(m), is_carousel_item: "true" };
          children.push((await graph(ctx, `/${ctx.accountId}/media`, params, "POST")).id);
          await checkpoint({ ...state, children });
        }
        for (const c of children) await waitForContainer(ctx, c);
        creationId = (await graph(ctx, `/${ctx.accountId}/media`, { media_type: "CAROUSEL", children: children.join(","), caption }, "POST")).id as string;
      }
      state = { ...state, containerId: creationId };
      await checkpoint(state);
    }
    await waitForContainer(ctx, creationId);
    const published = await graph(ctx, `/${ctx.accountId}/media_publish`, { creation_id: creationId }, "POST");
    const mediaId = String(published.id);
    let permalink: string | undefined;
    try {
      permalink = (await graph(ctx, `/${mediaId}`, { fields: "permalink" })).permalink;
    } catch {
      /* permalink is best effort */
    }
    await checkpoint({ ...state, mediaId, permalink });
    return { status: "published", remoteId: mediaId, remoteUrl: permalink };
  },
  async listComments(ctx, { since, postIds }) {
    const ids = postIds?.length ? postIds : (await instagramAdapter.listPosts(ctx, { limit: 15 })).map((p) => p.id);
    const out: RemoteComment[] = [];
    for (const mediaId of ids) {
      const r = await graph(ctx, `/${mediaId}/comments`, { fields: "id,text,username,timestamp,replies{id,text,username,timestamp}", limit: 50 });
      for (const c of r.data ?? []) {
        const created = new Date(c.timestamp);
        if (!since || created > since) {
          out.push({ id: c.id, kind: "comment", text: c.text ?? "", authorHandle: c.username, createdAt: created, postId: mediaId });
        }
        for (const rep of c.replies?.data ?? []) {
          const rc = new Date(rep.timestamp);
          if (!since || rc > since) out.push({ id: rep.id, kind: "reply", text: rep.text ?? "", authorHandle: rep.username, createdAt: rc, postId: mediaId, parentId: c.id });
        }
      }
    }
    return out;
  },
  async reply(ctx, { commentId, text }) {
    const r = await graph(ctx, `/${commentId}/replies`, { message: text }, "POST");
    return { id: String(r.id) };
  },
};
