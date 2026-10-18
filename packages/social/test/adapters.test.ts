import { describe, expect, it } from "vitest";
import { parseProfileUrl, xAdapter, tiktokAdapter, instagramAdapter } from "../src";

describe("public profile URLs", () => {
  it("parses supported platforms", () => {
    expect(parseProfileUrl("https://www.instagram.com/vibejudge/")).toMatchObject({ platform: "instagram", handle: "vibejudge" });
    expect(parseProfileUrl("tiktok.com/@vibejudge")).toMatchObject({ platform: "tiktok", handle: "vibejudge" });
    expect(parseProfileUrl("https://twitter.com/vibejudge")).toMatchObject({ platform: "x", handle: "vibejudge", url: "https://x.com/vibejudge" });
  });
  it("rejects post URLs and unknown hosts", () => {
    expect(parseProfileUrl("https://www.instagram.com/p/abc123/")).toBeNull();
    expect(parseProfileUrl("https://example.com/vibejudge")).toBeNull();
  });
});

describe("OAuth authorize URLs", () => {
  const creds = { clientId: "cid", clientSecret: "secret" };
  it("X uses PKCE S256 with space-separated scopes", () => {
    const u = new URL(xAdapter.buildAuthUrl({ creds, redirectUri: "http://localhost:4000/api/oauth/x/callback", state: "st", codeChallenge: "ch", scopes: ["tweet.read", "tweet.write"] }));
    expect(u.origin).toBe("https://x.com");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("scope")).toBe("tweet.read tweet.write");
    expect(u.searchParams.has("client_secret")).toBe(false);
  });
  it("TikTok uses client_key and comma-separated scopes", () => {
    const u = new URL(tiktokAdapter.buildAuthUrl({ creds, redirectUri: "https://r", state: "st", scopes: ["user.info.basic", "video.list"] }));
    expect(u.searchParams.get("client_key")).toBe("cid");
    expect(u.searchParams.get("scope")).toBe("user.info.basic,video.list");
  });
  it("Instagram uses Instagram Login", () => {
    const u = new URL(instagramAdapter.buildAuthUrl({ creds, redirectUri: "https://r", state: "st", scopes: ["instagram_business_basic"] }));
    expect(u.hostname).toBe("www.instagram.com");
    expect(u.searchParams.get("response_type")).toBe("code");
  });
});

describe("idempotent resume", () => {
  it("instagram publish returns the stored media id instead of re-posting", async () => {
    const r = await instagramAdapter.publish({ accessToken: "t", accountId: "1", scopes: [], config: {} }, { type: "image", text: "x", media: [] }, { mediaId: "999", permalink: "https://instagram.com/p/x" }, async () => {});
    expect(r).toEqual({ status: "published", remoteId: "999", remoteUrl: "https://instagram.com/p/x" });
  });
});
