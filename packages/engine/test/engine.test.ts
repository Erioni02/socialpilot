import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@socialpilot/db";
import { normalizePolicy } from "@socialpilot/shared";
import {
  createPost,
  createProject,
  decideApproval,
  enqueue,
  guard,
  publishTargetJob,
  qualityCheck,
  requestApproval,
  schedulePost,
  startWorker,
  waitForJob,
  renderPlatformText,
  createAsset,
  applyImageOp,
  restoreVersion,
} from "../src";
import sharp from "sharp";

let userId: string;

beforeAll(async () => {
  const u = await prisma.user.create({ data: { email: `engine-${Date.now()}@example.test`, name: "Engine Test", passwordHash: "x" } });
  userId = u.id;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("durable job queue (Postgres driver)", () => {
  it("runs jobs, retries retryable failures and records the result", async () => {
    let calls = 0;
    const worker = startWorker(
      {
        "test.flaky": async () => {
          calls++;
          if (calls < 2) throw new Error("transient");
          return { ok: true };
        },
      },
      { concurrency: 1 },
    );
    const job = await enqueue("test.flaky", {}, { maxAttempts: 3 });
    // First failure schedules a retry with backoff; pull it forward to keep the test fast.
    for (let i = 0; i < 40; i++) {
      const j = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      if (j.status === "waiting" && j.attempts === 1) await prisma.job.update({ where: { id: job.id }, data: { runAt: new Date() } });
      if (j.status === "completed") break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const done = await waitForJob(job.id, 15000);
    await worker.stop();
    expect(done.status).toBe("completed");
    expect(done.attempts).toBe(2);
    expect(done.result).toEqual({ ok: true });
  });

  it("deduplicates jobs by key", async () => {
    const dedupe = `same-key-${Date.now()}`;
    const a = await enqueue("test.noop", {}, { dedupeKey: dedupe, runAt: new Date(Date.now() + 3600_000) });
    const b = await enqueue("test.noop", {}, { dedupeKey: dedupe });
    expect(a.id).toBe(b.id);
  });

  it("recovers jobs from a dead worker", async () => {
    const j = await prisma.job.create({ data: { name: "test.stale", status: "active", lockedAt: new Date(Date.now() - 60 * 60_000), lockedBy: "dead" } });
    const worker = startWorker({ "test.stale": async () => "recovered" }, { concurrency: 1 });
    const done = await waitForJob(j.id, 15000);
    await worker.stop();
    expect(done.status).toBe("completed");
  });
});

describe("project isolation, permissions and approvals", () => {
  it("agents are blocked by autonomy level and granular permissions", async () => {
    const project = await createProject(userId, { name: "Perm Test" });
    const agent = { kind: "agent" as const, agentType: "general", taskId: "t1" };
    await expect(guard(project, "publish", agent)).rejects.toThrow(/does not allow/);
    const p3 = await prisma.project.update({ where: { id: project.id }, data: { policy: { ...normalizePolicy(project.policy), autonomyLevel: 3, permissions: { ...normalizePolicy(project.policy).permissions, publish: true } } } });
    expect(await guard(p3, "publish", agent)).toEqual({ requiresApproval: true });
    const denied = await prisma.auditLog.count({ where: { projectId: project.id, action: "permission.denied" } });
    expect(denied).toBe(1);
  });

  it("emergency stop blocks agent actions", async () => {
    const project = await createProject(userId, { name: "Stop Test" });
    await prisma.user.update({ where: { id: userId }, data: { emergencyStop: true } });
    await expect(guard(project, "createContent", { kind: "agent", agentType: "general", taskId: "t" })).rejects.toThrow(/Emergency stop/);
    await prisma.user.update({ where: { id: userId }, data: { emergencyStop: false } });
  });

  it("rejecting a publish approval returns the post to draft", async () => {
    const project = await createProject(userId, { name: "Approval Test" });
    const post = await createPost(project, { title: "t", type: "text", body: "Hello world, try it now", campaignId: null, platforms: ["x"], variants: {}, hashtags: [], cta: "", link: null, mediaAssetIds: [], notes: "" }, "agent:content_creation");
    await prisma.post.update({ where: { id: post.id }, data: { status: "in_review" } });
    const a = await requestApproval(project, { type: "publish", title: "Publish", payload: { postId: post.id, version: 1 }, requestedBy: "agent:social_publishing" });
    await decideApproval(userId, project, a.id, "reject");
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("draft");
    expect((await prisma.approval.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("rejected");
  });
});

describe("content and publishing", () => {
  it("quality checks enforce platform limits", async () => {
    const project = await createProject(userId, { name: "Quality Test" });
    const post = await createPost(project, { title: "long", type: "text", body: "x".repeat(300), campaignId: null, platforms: ["x", "instagram"], variants: {}, hashtags: [], cta: "", link: null, mediaAssetIds: [], notes: "" }, "user");
    const r = await qualityCheck(userId, project, post.id);
    expect(r.ok).toBe(false);
    expect(r.checks.some((c) => c.id.startsWith("length-x"))).toBe(true);
    expect(r.checks.some((c) => c.id === "media-instagram")).toBe(true);
  });

  it("renders tracked links for X", async () => {
    const project = await createProject(userId, { name: "Render Test" });
    const post = await createPost(project, { title: "", type: "text", body: "Launch day", campaignId: null, platforms: ["x"], variants: {}, hashtags: ["ai"], cta: "", link: "https://vibejudge.app", mediaAssetIds: [], notes: "" }, "user");
    const r = renderPlatformText(post, "x", "launch");
    expect(r.text).toContain("utm_source=x");
    expect(r.text).toContain("#ai");
  });

  it("a target can only be claimed once (no duplicate publishing)", async () => {
    const project = await createProject(userId, { name: "Dup Test" });
    const post = await createPost(project, { title: "", type: "text", body: "Hello there, try it", campaignId: null, platforms: ["x"], variants: {}, hashtags: [], cta: "Try it", link: null, mediaAssetIds: [], notes: "" }, "user");
    const s = await schedulePost(project, post.id, { scheduledAt: new Date(Date.now() + 60_000) }, { kind: "user", userId });
    // X is not connected → manual handoff, never an API call.
    expect(s.targets[0].status).toBe("manual");
    const target = await prisma.postTarget.findFirstOrThrow({ where: { postId: post.id } });
    await prisma.postTarget.update({ where: { id: target.id }, data: { status: "scheduled" } });
    const ctx = { jobId: "j", attempt: 1, maxAttempts: 1 };
    const [a, b] = await Promise.all([publishTargetJob({ targetId: target.id }, ctx), publishTargetJob({ targetId: target.id }, ctx)]);
    const skipped = [a, b].filter((r: any) => r.skipped).length;
    expect(skipped).toBe(1);
    const after = await prisma.postTarget.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.attempts).toBe(1);
    expect(after.status).toBe("failed"); // no integration → permanent failure, recorded
  });
});

describe("media versions", () => {
  it("applies real Sharp edits as new versions and restores old ones", async () => {
    const project = await createProject(userId, { name: "Media Test" });
    const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const { asset } = await createAsset(project.id, { name: "red.png", kind: "image", source: "upload" }, png, "image/png", { operation: "upload" });
    const ctx = { userId, projectId: project.id, project, createdBy: "user" };
    await applyImageOp(ctx, asset.id, { op: "preset", preset: "instagram_square" });
    await applyImageOp(ctx, asset.id, { op: "brand", overlayText: "Hello", textPosition: "bottom", border: 10 });
    const versions = await prisma.assetVersion.findMany({ where: { assetId: asset.id }, orderBy: { version: "asc" } });
    expect(versions.map((v) => [v.operation, v.width, v.height])).toEqual([
      ["upload", 800, 600],
      ["preset", 1080, 1080],
      ["brand", 1100, 1100],
    ]);
    const restored = await restoreVersion(asset.id, versions[0].id);
    expect(restored.version).toBe(4);
    expect(restored.width).toBe(800);
  });
});
