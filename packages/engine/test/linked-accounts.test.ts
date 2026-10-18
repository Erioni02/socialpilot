import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@socialpilot/db";
import { createPost, createProject, dispatchDueTargets, linkSocialAccount, linkedAccountsAnalytics, readyToPost, saveCredential, saveRapidSettings, schedulePost, syncLinkedAccount } from "../src";

afterAll(async () => prisma.$disconnect());
afterEach(() => vi.unstubAllGlobals());

const user = () => prisma.user.create({ data: { email: `linked-${Date.now()}-${Math.random()}@example.test`, name: "L", passwordHash: "x" } });
const headers = (remaining: number) => ({ "content-type": "application/json", "x-ratelimit-requests-limit": "50", "x-ratelimit-requests-remaining": String(remaining), "x-ratelimit-requests-reset": "86400", "x-ratelimit-rapid-free-plans-hard-limit-limit": "500000" });

describe("social accounts linked by URL", () => {
  it("accepts profile URLs only and dedupes by handle", async () => {
    const u = await user();
    const project = await createProject(u.id, { name: "Linked" });
    await expect(linkSocialAccount(u.id, project, "https://www.instagram.com/p/C1ySEcgOvIC/")).rejects.toThrow(/profile link/);
    const a = await linkSocialAccount(u.id, project, "https://www.instagram.com/MyBrand/");
    const b = await linkSocialAccount(u.id, project, "instagram.com/mybrand");
    expect(a.id).toBe(b.id);
    expect([a.status, a.accountHandle, a.credentialsEnc]).toEqual(["linked", "mybrand", null]);
  });

  it("syncs stats, audience and the graded post feed within the budget", async () => {
    const u = await user();
    const project = await createProject(u.id, { name: "Linked sync" });
    await saveCredential(u.id, "rapidapi", { apiKey: "rapid-k" });
    await saveRapidSettings(u.id, { monthlyBudget: 40, autoTracking: true, accountRefreshDays: 7 });
    const acct = await linkSocialAccount(u.id, project, "https://www.tiktok.com/@mybrand");
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      if (String(url).includes("/community"))
        return new Response(JSON.stringify({ meta: { code: 200 }, data: { cid: "TT:9", socialType: "TT", name: "My Brand", usersCount: 5400, avgER: 0.05, qualityScore: 0.66, pctFakeFollowers: 0.04, membersCountries: [{ category: "germany", value: 0.5 }], genders: [{ name: "f", percent: 0.55 }] } }), { headers: headers(30) });
      return new Response(
        JSON.stringify({
          meta: { code: 200 },
          data: {
            posts: [
              { postID: "1", postUrl: "https://www.tiktok.com/@mybrand/video/1", date: "2026-10-10T10:00:00Z", type: "video", views: 12000, likes: 900, comments: 40, rePosts: 30, er: 0.18, mainGrade: "a_plus", indexGrade: 2.4, hashTags: ["coffee"] },
              { postID: "2", postUrl: "https://www.tiktok.com/@mybrand/video/2", date: "2026-10-12T10:00:00Z", type: "video", views: 800, likes: 20, comments: 1, rePosts: 0, er: 0.004, mainGrade: "d", indexGrade: -2.1, hashTags: ["promo"] },
            ],
            summary: { types: [{ name: "video", count: 2, grade: 0.2, er: 0.09 }], hashTags: [{ name: "coffee", count: 3, grade: 1.5, er: 0.12 }], textLength: [{ name: "short", count: 2, grade: 0.4, er: 0.1 }] },
          },
        }),
        { headers: headers(29) },
      );
    });
    const r = await syncLinkedAccount(acct.id, { automatic: true });
    expect(r).toMatchObject({ ok: true, posts: 2 });
    expect(calls.some((c) => c.includes("/posts?cid=TT%3A9"))).toBe(true);
    const { accounts } = await linkedAccountsAnalytics(project);
    const a = accounts[0];
    expect(a.stats?.followers).toBe(5400);
    expect(a.audience?.countries[0].name).toBe("Germany");
    expect(a.feed?.top[0].grade).toBe("a_plus");
    expect(a.feed?.bottom[0].grade).toBe("d");
    expect(a.feed?.hashtags[0].name).toBe("coffee");
    expect(a.followersSeries.at(-1)?.value).toBe(5400);
  });

  it("never posts: scheduling always goes to Ready to post, and legacy scheduled targets become manual", async () => {
    const u = await user();
    const project = await createProject(u.id, { name: "No posting" });
    const post = await createPost(project, { title: "T", type: "text", body: "Hello there, this is a post.", platforms: ["x"], hashtags: [], mediaAssetIds: [], variants: {}, cta: "", notes: "" } as any, "user");
    const r = await schedulePost(project, post.id, { scheduledAt: new Date(Date.now() + 60_000) }, { kind: "user", userId: u.id });
    expect(r.targets.map((t) => t.status)).toEqual(["manual"]);

    const legacy = await createPost(project, { title: "L", type: "text", body: "Legacy scheduled post.", platforms: ["x"], hashtags: [], mediaAssetIds: [], variants: {}, cta: "", notes: "" } as any, "user");
    await prisma.postTarget.create({ data: { postId: legacy.id, platform: "x", status: "scheduled", scheduledAt: new Date(Date.now() - 1000), idempotencyKey: `legacy-${legacy.id}` } });
    await dispatchDueTargets();
    const t = await prisma.postTarget.findFirstOrThrow({ where: { postId: legacy.id } });
    expect(t.status).toBe("manual");
    expect((await prisma.job.count({ where: { name: "publish.target", payload: { path: ["targetId"], equals: t.id } } }))).toBe(0);
    expect((await readyToPost(project)).items.some((i) => i.postId === legacy.id)).toBe(true);
  });
});
