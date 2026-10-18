import { afterEach, describe, expect, it, vi } from "vitest";
import { audienceFrom, parseSocialUrl, rapidStats, rapidStatsGet } from "../src";

afterEach(() => vi.unstubAllGlobals());

const headers = (remaining: number, hard = true) => ({
  "content-type": "application/json",
  "x-ratelimit-requests-limit": "50",
  "x-ratelimit-requests-remaining": String(remaining),
  "x-ratelimit-requests-reset": "86400",
  ...(hard ? { "x-ratelimit-rapid-free-plans-hard-limit-limit": "500000" } : {}),
});

const community = {
  cid: "INST:1",
  socialType: "INST",
  url: "https://instagram.com/brand",
  name: "Brand",
  screenName: "brand",
  usersCount: 12000,
  verified: true,
  communityStatus: "DONE",
  avgER: 0.031,
  avgLikes: 350,
  avgComments: 12,
  qualityScore: 0.71,
  pctFakeFollowers: 0.08,
  pctUsersCount180d: 0.12,
  audienceSeverity: 0.4,
  membersTypes: [{ name: "real", percent: 0.8 }, { name: "suspicious", percent: 0.05 }],
  membersCountries: [{ category: "united-states", name: "United States", value: 0.4 }, { category: "uk", name: "UK", value: 0.1 }],
  genders: [{ name: "f", percent: 0.6 }, { name: "m", percent: 0.4 }],
  ages: [{ name: "24_27", percent: 0.3 }],
  membersGendersAges: { data: [{ category: "24_27", m: 0.1, f: 0.2 }] },
  brandSafety: { ad: 0.02, toxic: 0, totalScore: 0.001 },
  lastPosts: [{ url: "https://www.instagram.com/p/ABC/", date: "2026-10-01T00:00:00Z", likes: 300, comments: 10, text: "hi" }],
};

describe("RapidAPI Instagram Statistics API", () => {
  it("reads quota headers including the free-plan hard limit", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ meta: { code: 200 }, data: { ok: 1 } }), { headers: headers(44) }));
    const r = await rapidStatsGet("k", "/community", { url: "x" });
    expect(r.quota).toEqual({ limit: 50, remaining: 44, resetInSec: 86400, hardLimit: true });
  });

  it("maps account stats and audience demographics for a profile", async () => {
    let url = "";
    vi.stubGlobal("fetch", async (u: string, init: RequestInit) => {
      url = String(u);
      expect((init.headers as Record<string, string>)["x-rapidapi-key"]).toBe("k");
      return new Response(JSON.stringify({ meta: { code: 200 }, data: community }), { headers: headers(43) });
    });
    const o = await rapidStats.fetch(parseSocialUrl("instagram.com/brand"), { rapidapiKey: "k" });
    expect(url).toContain("/community?url=https%3A%2F%2Fwww.instagram.com%2Fbrand&force=true");
    expect(o.status).toBe("ok");
    expect(o.quota?.remaining).toBe(43);
    expect(o.result!.metrics.followers).toEqual({ value: 12000 });
    const a = o.result!.audience!;
    expect([a.qualityScore, a.fakeFollowersPct, a.avgEngagementRate]).toEqual([0.71, 0.08, 0.031]);
    expect(a.countries[0]).toEqual({ name: "United States", percent: 0.4 });
    expect(a.countries[1].name).toBe("UK");
    expect(a.genderAge).toEqual([{ age: "24_27", m: 0.1, f: 0.2 }]);
  });

  it("uses Post by URL for Instagram posts (live likes, comments, views)", async () => {
    vi.stubGlobal("fetch", async (u: string) => {
      expect(String(u)).toContain("/posts/one?postUrl=");
      return new Response(JSON.stringify({ meta: { code: 200 }, data: { likes: 21153, comments: 313, views: 2744628 } }), { headers: headers(42) });
    });
    const o = await rapidStats.fetch(parseSocialUrl("https://www.instagram.com/reel/DeIXf9SNQVO/"), { rapidapiKey: "k" });
    expect(o.result!.metrics).toEqual({ views: { value: 2744628 }, likes: { value: 21153 }, comments: { value: 313 } });
  });

  it("surfaces API-level errors with the quota", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ meta: { code: 400, message: "Bad request. Use for Instagram only." } }), { headers: headers(41) }));
    const o = await rapidStats.fetch(parseSocialUrl("https://www.instagram.com/p/C1ySEcgOvIC/"), { rapidapiKey: "k" });
    expect(o.status).toBe("error");
    expect(o.quota?.remaining).toBe(41);
  });

  it("prettifies location slugs", () => {
    expect(audienceFrom({ membersCountries: [{ category: "new-zealand", value: 0.5 }] }).countries[0].name).toBe("New Zealand");
  });
});
