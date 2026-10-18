import sharp from "sharp";
import { unzipSync, strFromU8 } from "fflate";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@socialpilot/db";
import {
  createAsset,
  createPost,
  createProject,
  deskBundle,
  markPosted,
  platformReadyImage,
  postedPerformance,
  readyToPost,
  saveOwnerMetrics,
  sendToDesk,
  trackPostedTarget,
  trackingIntervalMs,
  unmarkPosted,
} from "../src";

afterAll(async () => prisma.$disconnect());
afterEach(() => vi.unstubAllGlobals());

const user = () => prisma.user.create({ data: { email: `manual-${Date.now()}-${Math.random()}@example.test`, name: "M", passwordHash: "x" } });
const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 90, b: 160 } } }).png().toBuffer();

describe("platform-ready media", () => {
  it("fits tall images to Instagram 4:5 without cropping and converts to JPEG", async () => {
    const r = await platformReadyImage("instagram", await png(900, 1800));
    const m = await sharp(r.data).metadata();
    expect([r.mimeType, m.format, m.width, m.height]).toEqual(["image/jpeg", "jpeg", 1080, 1350]);
  });
  it("makes TikTok photos 1080×1920", async () => {
    const m = await sharp((await platformReadyImage("tiktok", await png(1200, 1200))).data).metadata();
    expect([m.width, m.height]).toEqual([1080, 1920]);
  });
  it("keeps X aspect ratio", async () => {
    const m = await sharp((await platformReadyImage("x", await png(1600, 900))).data).metadata();
    expect([m.width, m.height]).toEqual([1600, 900]);
  });
});

describe("tracking cadence", () => {
  it("decays from 20 minutes to daily and stops after 90 days", () => {
    const now = Date.now();
    expect(trackingIntervalMs(new Date(now - 3600_000), now)).toBe(20 * 60_000);
    expect(trackingIntervalMs(new Date(now - 3 * 86400_000), now)).toBe(2 * 3600_000);
    expect(trackingIntervalMs(new Date(now - 10 * 86400_000), now)).toBe(12 * 3600_000);
    expect(trackingIntervalMs(new Date(now - 60 * 86400_000), now)).toBe(86400_000);
    expect(trackingIntervalMs(new Date(now - 100 * 86400_000), now)).toBe(Infinity);
  });
});

describe("manual publishing desk", () => {
  it("runs the full flow: desk → bundle → posted (validated) → tracked → owner metrics → report → undo", async () => {
    const u = await user();
    const project = await createProject(u.id, { name: "Manual flow" });
    const { asset } = await createAsset(project.id, { name: "hero", kind: "image", source: "upload" }, await png(1000, 1000), "image/png", { operation: "upload", params: {} });
    const post = await createPost(project, { title: "Launch", type: "image", body: "We just launched. Here's what's new.", platforms: ["x", "instagram"], hashtags: ["launch"], mediaAssetIds: [asset.id], variants: {}, cta: "", notes: "" } as any, "user");

    await sendToDesk(project, post.id, {}, { kind: "user", userId: u.id });
    const desk = await readyToPost(project);
    expect(desk.items.map((i) => i.platform).sort()).toEqual(["instagram", "x"]);
    const x = desk.items.find((i) => i.platform === "x")!;
    expect(x.caption).toContain("#launch");
    expect(x.state).toBe("due");

    const zip = unzipSync(new Uint8Array((await deskBundle(project, x.targetId)).data));
    expect(strFromU8(zip["caption.txt"])).toContain("We just launched");
    expect(Object.keys(zip).some((k) => k.endsWith(".jpg"))).toBe(true);
    expect(Object.keys(zip)).toContain("POSTING-CHECKLIST.txt");

    await expect(markPosted(project, x.targetId, { url: "https://www.instagram.com/p/C1ySEcgOvIC/" }, u.id)).rejects.toThrow(/Instagram link/);
    await expect(markPosted(project, x.targetId, { url: "https://x.com/somebrand" }, u.id)).rejects.toThrow(/post itself/);

    const tweetId = String(1800000000000000000n + BigInt(Math.floor(Math.random() * 1e9)));
    await markPosted(project, x.targetId, { url: `https://x.com/somebrand/status/${tweetId}?s=20` }, u.id);
    expect((await readyToPost(project)).items.map((i) => i.platform)).toEqual(["instagram"]);

    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ id_str: tweetId, text: "We just launched", favorite_count: 42, conversation_count: 7, created_at: new Date().toISOString(), user: { screen_name: "somebrand", name: "Some Brand" } }), { headers: { "content-type": "application/json" } }),
    );
    await trackPostedTarget({ targetId: x.targetId });
    let t = await prisma.postTarget.findUniqueOrThrow({ where: { id: x.targetId } });
    expect((t.metrics as any).likes.value).toBe(42);
    expect((t.providerState as any).tracking).toBe("auto");

    // Views aren't public on X: the owner adds them; the next automatic refresh must keep them.
    await saveOwnerMetrics(project, x.targetId, { views: 5000, shares: 3 }, "screenshot", u.id);
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ id_str: tweetId, text: "We just launched", favorite_count: 50, conversation_count: 8, created_at: new Date().toISOString(), user: { screen_name: "somebrand" } }), { headers: { "content-type": "application/json" } }),
    );
    await trackPostedTarget({ targetId: x.targetId });
    t = await prisma.postTarget.findUniqueOrThrow({ where: { id: x.targetId } });
    expect((t.metrics as any).likes.value).toBe(50);
    expect((t.metrics as any).views.value).toBe(5000);

    const report = await postedPerformance(project, 30);
    const row = report.posts.find((p) => p.targetId === x.targetId)!;
    expect(row.metrics.views).toBe(5000);
    expect(row.engagementRate).toBeCloseTo((50 + 8 + 3) / 5000, 6);
    expect(row.series.length).toBeGreaterThanOrEqual(3);

    await unmarkPosted(project, x.targetId, u.id);
    expect((await readyToPost(project)).items.map((i) => i.platform).sort()).toEqual(["instagram", "x"]);
  });
});
