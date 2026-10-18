import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeSocialUrl, parseSocialUrl, xSyndication, tiktokPublicPage, apifyInstagram, socialcrawlTiktok, socialcrawlInstagram, postpeerX } from "../src";

afterEach(() => vi.unstubAllGlobals());

describe("social URL parsing", () => {
  it.each([
    ["https://www.tiktok.com/@scout2015/video/6718335390845095173", "tiktok", "post", "6718335390845095173"],
    ["tiktok.com/@Scout2015", "tiktok", "profile", "scout2015"],
    ["https://www.instagram.com/reel/C2zMqZ7uWQf/?igsh=abc", "instagram", "post", "C2zMqZ7uWQf"],
    ["https://instagram.com/p/C1ySEcgOvIC", "instagram", "post", "C1ySEcgOvIC"],
    ["https://www.instagram.com/natgeo/", "instagram", "profile", "natgeo"],
    ["https://twitter.com/jack/status/20?s=20", "x", "post", "20"],
    ["https://x.com/i/web/status/20", "x", "post", "20"],
    ["x.com/NASA", "x", "profile", "nasa"],
  ])("%s", (url, platform, kind, id) => {
    expect(parseSocialUrl(url)).toMatchObject({ platform, kind, externalId: id });
  });
  it.each(["https://youtube.com/watch?v=1", "x.com/settings", "https://www.instagram.com/explore/", "tiktok.com/video/123", "not a url", "ftp://x.com/a", "https://x.com/jack/status/abc"])("rejects %s", (url) => {
    expect(() => parseSocialUrl(url)).toThrow();
  });
});

const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html" } });

describe("free providers", () => {
  it("reads TikTok public video stats and marks rounded creator totals", async () => {
    const data = {
      __DEFAULT_SCOPE__: {
        "webapp.video-detail": {
          statusCode: 0,
          itemInfo: { itemStruct: { id: "123456789", desc: "hi", createTime: 1700000000, stats: { playCount: 1000, diggCount: 100, commentCount: 10, shareCount: 5, collectCount: "3" }, author: { uniqueId: "abc", nickname: "A" }, authorStats: { followerCount: 9000000, followingCount: 12, heartCount: 50, videoCount: 7 } } },
        },
      },
    };
    vi.stubGlobal("fetch", async () => html(`<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(data)}</script></html>`));
    const r = await tiktokPublicPage.fetch(parseSocialUrl("https://www.tiktok.com/@abc/video/123456789"), {});
    expect(r.status).toBe("ok");
    expect(r.result!.metrics).toEqual({ views: { value: 1000 }, likes: { value: 100 }, comments: { value: 10 }, shares: { value: 5 }, saves: { value: 3 } });
    expect(r.result!.author!.metrics.followers).toEqual({ value: 9000000, approx: true });
    expect(r.result!.author!.metrics.total_likes).toEqual({ value: 50 });
  });
  it("reports private and deleted TikTok videos", async () => {
    vi.stubGlobal("fetch", async () => html(`<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify({ __DEFAULT_SCOPE__: { "webapp.video-detail": { statusCode: 10222 } } })}</script>`));
    expect((await tiktokPublicPage.fetch(parseSocialUrl("https://www.tiktok.com/@abc/video/123456789"), {})).status).toBe("private");
  });
  it("handles TikTok verification pages gracefully", async () => {
    vi.stubGlobal("fetch", async () => html("<html>please verify</html>"));
    expect((await tiktokPublicPage.fetch(parseSocialUrl("https://www.tiktok.com/@abc/video/123456789"), {})).status).toBe("unavailable");
  });
  it("reads X embed data and lists views/reposts as unavailable instead of zero", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id_str: "20", text: "just setting up", favorite_count: 5, conversation_count: 2, created_at: "2006-03-21T20:50:14.000Z", user: { screen_name: "jack", name: "jack" } }), { headers: { "content-type": "application/json" } }));
    const r = await xSyndication.fetch(parseSocialUrl("https://x.com/jack/status/20"), {});
    expect(r.status).toBe("partial");
    expect(r.result!.metrics).toEqual({ likes: { value: 5 }, comments: { value: 2 } });
    expect(r.result!.metrics.views).toBeUndefined();
    expect(r.result!.unavailable.map((u) => u.metric)).toEqual(["views", "shares", "quotes"]);
  });
  it("maps X 404 to not_found", async () => {
    vi.stubGlobal("fetch", async () => html("<!DOCTYPE html>", 404));
    expect((await xSyndication.fetch(parseSocialUrl("https://x.com/jack/status/1"), {})).status).toBe("not_found");
  });
});

describe("paid providers are opt-in", () => {
  it("never calls Apify unless a paid provider is requested", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      calls.push(String(u));
      return html("<html></html>");
    });
    const r = await analyzeSocialUrl("https://www.instagram.com/natgeo/");
    expect(r.outcome.status).toBe("unavailable");
    expect(r.outcome.paidOptions?.map((p) => p.provider)).toEqual(["rapidapi-stats", "socialcrawl-instagram", "apify-instagram"]);
    expect(calls.some((c) => /apify.com|socialcrawl|postpeer|rapidapi/.test(c))).toBe(false);
  });
  it("passes the spend cap to Apify and maps profile data", async () => {
    let url = "";
    vi.stubGlobal("fetch", async (u: string) => {
      url = String(u);
      return new Response(JSON.stringify([{ username: "natgeo", fullName: "National Geographic", followersCount: 280000000, followsCount: 100, postsCount: 30000, latestPosts: [{ shortCode: "abc12", likesCount: -1, commentsCount: 5 }] }]), { headers: { "content-type": "application/json" } });
    });
    const r = await apifyInstagram.fetch(parseSocialUrl("instagram.com/natgeo"), { apifyToken: "t", maxChargeUsd: 0.07 });
    expect(url).toContain("maxTotalChargeUsd=0.07");
    expect(r.result!.metrics.followers).toEqual({ value: 280000000 });
    expect(r.result!.posts![0].metrics.likes).toBeUndefined(); // hidden likes (-1) are not shown as a number
  });
});

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("SocialCrawl (credits, opt-in)", () => {
  it("maps a TikTok profile plus recent videos and sends the key header", async () => {
    const calls: { url: string; key?: string }[] = [];
    vi.stubGlobal("fetch", async (u: string, init: RequestInit = {}) => {
      calls.push({ url: String(u), key: (init.headers as Record<string, string>)["x-api-key"] });
      if (String(u).includes("/profile/videos"))
        return jsonRes({ success: true, data: { items: [{ post: { id: "7", url: "https://www.tiktok.com/@a/video/7", content: { text: "hi" }, engagement: { views: 100, likes: 10, comments: 2, shares: 1, saves: null }, published_at: "2026-10-01T00:00:00Z" } }] }, credits_used: 1, credits_remaining: 97 });
      return jsonRes({ success: true, data: { author: { username: "a", display_name: "A", followers: 9000000, following: 3, posts_count: 50, likes_count: 1000, private: false, ext: { followers_approximate: true } } }, credits_used: 1, credits_remaining: 98 });
    });
    const r = await socialcrawlTiktok.fetch(parseSocialUrl("tiktok.com/@a"), { socialcrawlKey: "sc_test" });
    expect(calls[0].url).toBe("https://www.socialcrawl.dev/v1/tiktok/profile?handle=a");
    expect(calls[0].key).toBe("sc_test");
    expect(r.status).toBe("ok");
    expect(r.result!.metrics.followers).toEqual({ value: 9000000, approx: true });
    expect(r.result!.confidence).toBe("rounded");
    expect(r.result!.credits).toBe(2);
    expect(r.result!.posts![0].metrics).toEqual({ views: { value: 100 }, likes: { value: 10 }, comments: { value: 2 }, shares: { value: 1 } });
  });

  it("reports private accounts from SocialCrawl's 404 reason", async () => {
    vi.stubGlobal("fetch", async () => jsonRes({ success: false, error: { type: "RESOURCE_NOT_FOUND", message: "nope", status: 404, details: { reason: "account_private" } } }, 404));
    const r = await socialcrawlInstagram.fetch(parseSocialUrl("instagram.com/someone"), { socialcrawlKey: "sc_test" });
    expect(r.status).toBe("private");
  });

  it("refuses to run without a key", async () => {
    const r = await socialcrawlInstagram.fetch(parseSocialUrl("instagram.com/p/C1ySEcgOvIC"), {});
    expect(r.status).toBe("error");
  });
});

describe("PostPeer X analytics (credits, opt-in)", () => {
  it("reads post analytics through the connected account", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      urls.push(String(u));
      if (String(u).includes("/connect/integrations")) return jsonRes({ success: true, integrations: [{ id: "acc1", platform: "twitter", displayName: "@jack" }] });
      return jsonRes({ success: true, post: { aggregated: { impressions: 22, likes: 1, comments: 1, shares: null }, platforms: [{ platform: "twitter", platformPostId: "20", metrics: {} }] } });
    });
    const r = await postpeerX.fetch(parseSocialUrl("https://x.com/jack/status/20"), { postpeerKey: "k" });
    expect(urls[1]).toBe("https://api.postpeer.dev/v1/analytics?postId=20&platform=twitter&accountId=acc1");
    expect(r.result!.metrics).toEqual({ views: { value: 22 }, likes: { value: 1 }, comments: { value: 1 } });
  });

  it("explains when no X account is connected (and spends nothing)", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      urls.push(String(u));
      return jsonRes({ success: true, integrations: [] });
    });
    const r = await postpeerX.fetch(parseSocialUrl("x.com/jack"), { postpeerKey: "k" });
    expect(r.status).toBe("unavailable");
    expect(urls.every((u) => !u.includes("/analytics"))).toBe(true);
  });
});
