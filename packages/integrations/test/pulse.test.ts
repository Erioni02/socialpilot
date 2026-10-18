import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBlueskyTrending, fetchGoogleTrends, fetchMastodonTrends, fetchSocialCrawlTrending } from "../src";

afterEach(() => vi.unstubAllGlobals());
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

describe("Social Pulse sources", () => {
  it("maps Bluesky trending topics in rank order", async () => {
    vi.stubGlobal("fetch", async () => json({ topics: [{ topic: "a", displayName: "A", link: "/profile/x/feed/1", description: "d" }, { topic: "b", displayName: "B", link: "/profile/x/feed/2" }] }));
    const r = await fetchBlueskyTrending(25);
    expect(r[0]).toMatchObject({ platform: "bluesky", kind: "topic", title: "A", url: "https://bsky.app/profile/x/feed/1", score: 25 });
    expect(r[1].score).toBe(24);
  });

  it("maps Mastodon statuses, hashtags and links with real counts", async () => {
    vi.stubGlobal("fetch", async (u: string) => {
      if (String(u).includes("trends/statuses")) return json([{ id: "1", uri: "https://m/1", url: "https://m/@a/1", content: "<p>Hello <b>world</b></p>", favourites_count: 10, reblogs_count: 3, replies_count: 2, created_at: "2026-10-18T00:00:00Z", account: { acct: "a" }, tags: [{ name: "News" }] }]);
      if (String(u).includes("trends/tags")) return json([{ name: "Coffee", url: "https://m/tags/coffee", history: [{ uses: "40", accounts: "12" }] }]);
      return json([{ url: "https://site/x", title: "Story", description: "desc", history: [{ uses: "7" }] }]);
    });
    const r = await fetchMastodonTrends();
    const post = r.find((i) => i.kind === "post")!;
    expect(post).toMatchObject({ title: "Hello world", score: 16, comments: 2, tags: ["news"] });
    expect(r.find((i) => i.kind === "hashtag")).toMatchObject({ title: "#Coffee", score: 40 });
    expect(r.find((i) => i.kind === "link")).toMatchObject({ title: "Story", score: 7 });
  });

  it("parses Google Trends RSS with traffic and news link", async () => {
    vi.stubGlobal("fetch", async () => new Response(`<rss><channel><item><title>big game</title><ht:approx_traffic>200K+</ht:approx_traffic><pubDate>Sun, 18 Oct 2026 14:00:00 -0700</pubDate><ht:news_item><ht:news_item_title>Recap</ht:news_item_title><ht:news_item_url>https://news.example/recap</ht:news_item_url><ht:news_item_source>News</ht:news_item_source></ht:news_item></item></channel></rss>`));
    const r = await fetchGoogleTrends("US");
    expect(r[0]).toMatchObject({ platform: "google_trends", title: "big game", score: 200000, url: "https://news.example/recap", author: "News" });
  });

  it("reports credits for paid SocialCrawl trending", async () => {
    vi.stubGlobal("fetch", async () => json({ success: true, data: { items: [{ post: { id: "9", url: "https://www.tiktok.com/@a/video/9", content: { text: "dance #fyp" }, engagement: { views: 5000, comments: 3 }, author: { username: "a" } } }] }, credits_used: 5 }));
    const r = await fetchSocialCrawlTrending("sc_k", "tiktok", "US");
    expect(r.credits).toBe(5);
    expect(r.items[0]).toMatchObject({ platform: "tiktok", score: 5000, tags: ["fyp"] });
  });
});
