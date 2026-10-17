import { prisma } from "@sp/db";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { enqueued, loginAs, resetDatabase, seedOwner, testServer, type Session } from "./helpers";

let app: FastifyInstance;
let s: Session;

beforeEach(async () => {
  await resetDatabase();
  enqueued.length = 0;
  await seedOwner();
  app = await testServer();
  s = await loginAs(app);
});
afterEach(() => app.close());
afterAll(() => prisma.$disconnect());

const createProject = async (payload: object = { name: "VibeJudge", websiteUrl: "vibejudge.app" }) => {
  const res = await app.inject({ method: "POST", url: "/api/projects", headers: s.headers, payload });
  return { res, project: res.json() };
};

describe("projects", () => {
  it("creates a project with default policy and 9 not-connected integrations", async () => {
    const { res, project } = await createProject();
    expect(res.statusCode).toBe(201);
    expect(project).toMatchObject({ name: "VibeJudge", slug: "vibejudge", websiteUrl: "https://vibejudge.app/", status: "draft", wizardStep: 1 });
    const integrations = await app.inject({ method: "GET", url: `/api/projects/${project.id}/integrations`, headers: s.headers });
    expect(integrations.json()).toHaveLength(9);
    expect(integrations.json().every((i: { status: string }) => i.status === "not_connected")).toBe(true);
    const policy = await app.inject({ method: "GET", url: `/api/projects/${project.id}/policy`, headers: s.headers });
    expect(policy.json()).toMatchObject({ autonomyLevel: 1, permissions: { "social.publish": "approve" } });
  });

  it("makes slugs unique", async () => {
    await createProject();
    const { project } = await createProject();
    expect(project.slug).toBe("vibejudge-2");
  });

  it("rejects a private website URL with a clear message", async () => {
    const { res } = await createProject({ name: "X", websiteUrl: "http://192.168.1.10" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/private or local/i);
  });

  it("lists, updates the wizard step, and archives", async () => {
    const { project } = await createProject();
    await app.inject({ method: "PATCH", url: `/api/projects/${project.id}`, headers: s.headers, payload: { wizardStep: 4 } });
    const list = await app.inject({ method: "GET", url: "/api/projects", headers: s.headers });
    expect(list.json()).toMatchObject([{ id: project.id, wizardStep: 4, latestSnapshot: null }]);
    expect((await app.inject({ method: "DELETE", url: `/api/projects/${project.id}`, headers: s.headers })).statusCode).toBe(204);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).status).toBe("archived");
  });

  it("saves brand profile versions through the tool registry", async () => {
    const { project } = await createProject();
    const put = await app.inject({ method: "PUT", url: `/api/projects/${project.id}/brand-profile`, headers: s.headers, payload: { description: "Roasts", confirm: true } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ version: 1, source: "user_edit", description: "Roasts" });
    expect(put.json().confirmedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "brand.updateProfile" } })).toBe(1);
  });
});

describe("analyze", () => {
  it("returns the existing task when analysis is already running", async () => {
    const { project } = await createProject();
    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: `/api/projects/${project.id}/analyze`, headers: s.headers }),
      app.inject({ method: "POST", url: `/api/projects/${project.id}/analyze`, headers: s.headers })
    ]);
    expect(a.statusCode).toBe(200);
    expect(a.json().taskId).toBe(b.json().taskId);
    expect(await prisma.task.count({ where: { toolName: "website.analyze" } })).toBe(1);
    expect(enqueued).toHaveLength(1);
  });

  it("accepts a body-less POST that still declares a JSON content type", async () => {
    const { project } = await createProject();
    const res = await app.inject({ method: "POST", url: `/api/projects/${project.id}/analyze`, headers: { ...s.headers, "content-type": "application/json" } });
    expect(res.statusCode).toBe(200);
  });

  it("exposes the task and its events", async () => {
    const { project } = await createProject();
    const { taskId } = (await app.inject({ method: "POST", url: `/api/projects/${project.id}/analyze`, headers: s.headers })).json();
    await prisma.taskEvent.create({ data: { taskId, message: "Fetched /" } });
    const res = await app.inject({ method: "GET", url: `/api/tasks/${taskId}`, headers: s.headers });
    expect(res.json()).toMatchObject({ task: { id: taskId, status: "queued" }, events: [{ message: "Fetched /" }] });
  });

  it("cancels a queued task", async () => {
    const { project } = await createProject();
    const { taskId } = (await app.inject({ method: "POST", url: `/api/projects/${project.id}/analyze`, headers: s.headers })).json();
    expect((await app.inject({ method: "POST", url: `/api/tasks/${taskId}/cancel`, headers: s.headers })).statusCode).toBe(200);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("cancelled");
  });

  it("only allows allow-listed tools through the generic tools route", async () => {
    const { project } = await createProject();
    const ok = await app.inject({ method: "POST", url: `/api/projects/${project.id}/tools/project.summary`, headers: s.headers, payload: {} });
    expect(ok.json()).toMatchObject({ status: "queued" });
    const blocked = await app.inject({ method: "POST", url: `/api/projects/${project.id}/tools/ai.testProvider`, headers: s.headers, payload: {} });
    expect(blocked.statusCode).toBe(404);
  });
});

describe("policy", () => {
  const put = (id: string, payload: object) => app.inject({ method: "PUT", url: `/api/projects/${id}/policy`, headers: s.headers, payload });

  it("requires typing the project name to raise autonomy", async () => {
    const { project } = await createProject();
    const denied = await put(project.id, { autonomyLevel: 3 });
    expect(denied.statusCode).toBe(400);
    expect(denied.json().error.code).toBe("confirm_name_mismatch");
    expect((await put(project.id, { autonomyLevel: 3, confirmName: "VibeJudge" })).statusCode).toBe(200);
    expect((await put(project.id, { autonomyLevel: 1 })).statusCode).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "policy.update" } })).toBe(2);
  });

  it("updates permissions and budgets", async () => {
    const { project } = await createProject();
    const res = await put(project.id, { permissions: { "brand.write": "approve" }, budget: { dailyAiUsd: 2, monthlyAiUsd: 30, dailyMediaUsd: 0 } });
    expect(res.json()).toMatchObject({ permissions: { "brand.write": "approve", "website.read": "allow" }, budget: { dailyAiUsd: 2 } });
  });
});

describe("approvals", () => {
  it("approving queues the task; rejecting cancels it", async () => {
    const { project } = await createProject();
    const mk = async () => {
      const task = await prisma.task.create({ data: { projectId: project.id, type: "social.publish", toolName: "project.summary", status: "awaiting_approval", input: {}, requestedBy: "agent", actorId: "a" } });
      return prisma.approval.create({ data: { projectId: project.id, taskId: task.id, toolName: "project.summary", payload: {}, reason: "test" } });
    };
    const a = await mk();
    const b = await mk();
    const list = await app.inject({ method: "GET", url: `/api/projects/${project.id}/approvals`, headers: s.headers });
    expect(list.json()).toHaveLength(2);
    await app.inject({ method: "POST", url: `/api/approvals/${a.id}/approve`, headers: s.headers });
    await app.inject({ method: "POST", url: `/api/approvals/${b.id}/reject`, headers: s.headers });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: a.taskId } })).status).toBe("queued");
    expect(enqueued).toContain(a.taskId);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: b.taskId } })).status).toBe("cancelled");
    const again = await app.inject({ method: "POST", url: `/api/approvals/${a.id}/approve`, headers: s.headers });
    expect(again.statusCode).toBe(409);
  });
});

describe("AI providers", () => {
  it("never returns stored keys, only their last four characters", async () => {
    const created = await app.inject({ method: "POST", url: "/api/ai-providers", headers: s.headers, payload: { provider: "nvidia", keys: ["nvapi-abcdef1234"] } });
    expect(created.statusCode).toBe(201);
    const list = await app.inject({ method: "GET", url: "/api/ai-providers", headers: s.headers });
    expect(list.body).not.toContain("nvapi-abcdef1234");
    expect(list.json()[0]).toMatchObject({ provider: "nvidia", keysPreview: ["••••1234"], baseUrl: "https://integrate.api.nvidia.com/v1" });
    expect(list.json()[0].models.length).toBeGreaterThan(0);
  });

  it("keeps existing keys when an edit sends none", async () => {
    const { id } = (await app.inject({ method: "POST", url: "/api/ai-providers", headers: s.headers, payload: { provider: "ollama", keys: ["k-1111"] } })).json();
    await app.inject({ method: "PATCH", url: `/api/ai-providers/${id}`, headers: s.headers, payload: { enabled: false } });
    const row = await prisma.aiProviderConfig.findUniqueOrThrow({ where: { id } });
    expect(row.enabled).toBe(false);
    expect(row.keysPreview).toEqual(["••••1111"]);
  });

  it("reports which .env fallback providers exist, without their keys", async () => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, { AI_PROVIDER_ORDER: "nvidia,ollama", NVIDIA_API_KEYS: "nvapi-secret-9999", OLLAMA_API_KEYS: "" });
      const res = await app.inject({ method: "GET", url: "/api/ai-providers/fallback", headers: s.headers });
      expect(res.json()).toEqual({ providers: [{ provider: "nvidia", keyCount: 1 }] });
      expect(res.body).not.toContain("nvapi-secret-9999");
      process.env.NVIDIA_API_KEYS = "";
      expect((await app.inject({ method: "GET", url: "/api/ai-providers/fallback", headers: s.headers })).json()).toEqual({ providers: [] });
    } finally {
      process.env = saved;
    }
  });

  it("rejects a non-https or internal base URL", async () => {
    const res = await app.inject({ method: "POST", url: "/api/ai-providers", headers: s.headers, payload: { provider: "ollama", keys: ["k"], baseUrl: "http://169.254.169.254" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("spend", () => {
  it("reports today's and this month's spend against the budget", async () => {
    const { project } = await createProject();
    await prisma.spendLedger.create({ data: { projectId: project.id, category: "ai", amountUsd: 0.25 } });
    await prisma.spendLedger.create({ data: { projectId: project.id, category: "ai", amountUsd: 1, at: new Date(Date.now() - 40 * 86_400_000) } });
    const res = await app.inject({ method: "GET", url: `/api/projects/${project.id}/spend`, headers: s.headers });
    expect(res.json()).toEqual({ todayAiUsd: 0.25, monthAiUsd: 0.25, todayMediaUsd: 0, budget: { dailyAiUsd: 1, monthlyAiUsd: 20, dailyMediaUsd: 0 } });
  });
});

describe("emergency stop", () => {
  it("blocks write tools while on and is audited", async () => {
    const { project } = await createProject();
    await app.inject({ method: "PUT", url: "/api/workspace/emergency-stop", headers: s.headers, payload: { enabled: true } });
    const res = await app.inject({ method: "PUT", url: `/api/projects/${project.id}/brand-profile`, headers: s.headers, payload: { description: "x" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("emergency_stop");
    expect(await prisma.auditLog.count({ where: { action: "workspace.emergencyStop" } })).toBe(1);
  });
});

describe("logo", () => {
  const upload = (projectId: string, buffer: Buffer, filename = "logo.png") => {
    const boundary = "----sp";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    return app.inject({ method: "POST", url: `/api/projects/${projectId}/logo`, headers: { ...s.headers, "content-type": `multipart/form-data; boundary=${boundary}` }, payload: body });
  };

  it("accepts a real image, re-encodes it and serves it back", async () => {
    const { project } = await createProject();
    const png = await sharp({ create: { width: 900, height: 300, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const res = await upload(project.id, png);
    expect(res.statusCode).toBe(200);
    const served = await app.inject({ method: "GET", url: `/api/projects/${project.id}/logo`, headers: s.headers });
    expect(served.headers["content-type"]).toBe("image/png");
    expect((await sharp(served.rawPayload).metadata()).width).toBe(512);
  });

  it("rejects a file that isn't an image", async () => {
    const { project } = await createProject();
    const res = await upload(project.id, Buffer.from("definitely not a png"));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_image");
  });

  it("rejects files over 5 MB", async () => {
    const { project } = await createProject();
    const res = await upload(project.id, Buffer.alloc(6 * 1024 * 1024, 1));
    expect(res.statusCode).toBe(413);
  });
});
