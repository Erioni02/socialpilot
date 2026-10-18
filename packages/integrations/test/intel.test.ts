import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeSocialUrl, parseSocialUrl, xSyndication, tiktokPublicPage, apifyInstagram } from "../src";

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
    expect(r.outcome.paidOptions?.[0].provider).toBe("apify-instagram");
    expect(calls.some((c) => c.includes("apify.com"))).toBe(false);
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
