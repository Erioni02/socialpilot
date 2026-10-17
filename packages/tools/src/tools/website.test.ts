import type { ChatResult } from "@sp/ai";
import { prisma } from "@sp/db";
import { resetDatabase } from "@sp/db/testing";
import type { CrawlResult, SafeFetchResult } from "@sp/integrations";
import { extractPage } from "@sp/integrations";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { executeTool, runTask, setEnqueuer, ValidationError } from "../execute";
import { clearRegistry } from "../registry";
import { registerCycle1Tools, setToolDeps } from "./index";

const body = (words: number) => `<html lang="en"><head><title>VibeJudge</title></head><body><h1>Roast</h1><p>${"honest feedback ".repeat(words)}</p></body></html>`;

function crawlOf(status: number, pages: number, words = 80): CrawlResult {
  const list = Array.from({ length: pages }, (_, i) => extractPage(`https://vibejudge.app/${i ? `p${i}` : ""}`, status >= 400 ? "Forbidden" : body(words), status));
  return { rootUrl: "https://vibejudge.app/", httpStatus: status, responseMs: 120, pages: list, robotsTxt: null, sitemapFound: false, brokenLinks: [], issues: [] };
}

const draft = {
  description: "AI roasts of CVs and websites",
  targetAudience: "Job seekers",
  industry: "Career tools",
  productsServices: ["CV roast"],
  objectives: ["Grow signups"],
  voiceTone: "Witty",
  keyMessages: ["Honest feedback"],
  competitors: [],
  messagingSummary: "Funny but useful"
};

const chat = vi.fn(async (): Promise<ChatResult<typeof draft>> => ({ text: "{}", data: draft, provider: "nvidia", model: "m", costUsd: 0, ms: 5 }));
const crawl = vi.fn(async () => crawlOf(200, 3));
const fetchPage = vi.fn(async (url: string): Promise<SafeFetchResult> => ({ url, status: 200, headers: {}, body: body(60), responseMs: 10, redirects: [] }));
let providers = [{ name: "nvidia" as const, baseUrl: "https://nv.test", keys: ["k"], models: ["m"] }];

let ws: { id: string };
let project: { id: string };
const user = { type: "user" as const, id: "u" };
const scope = () => ({ workspaceId: ws.id, projectId: project.id, actor: user });

async function analyze() {
  const queued = await executeTool(scope(), "website.analyze", {});
  await runTask(queued.taskId);
  return prisma.task.findUniqueOrThrow({ where: { id: queued.taskId } });
}

beforeAll(() => {
  setEnqueuer(async () => {});
  clearRegistry();
  registerCycle1Tools();
  setToolDeps({ crawl, fetchPage, chat: chat as never, loadProviders: async () => providers });
});
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  providers = [{ name: "nvidia", baseUrl: "https://nv.test", keys: ["k"], models: ["m"] }];
  crawl.mockImplementation(async () => crawlOf(200, 3));
  const owner = await prisma.user.create({ data: { email: "o@test.dev", passwordHash: "x" } });
  ws = await prisma.workspace.create({ data: { name: "w", ownerId: owner.id } });
  project = await prisma.project.create({ data: { workspaceId: ws.id, name: "VibeJudge", slug: "vibejudge", websiteUrl: "https://vibejudge.app" } });
});

describe("website.analyze", () => {
  it("saves a snapshot and an AI-drafted profile", async () => {
    const task = await analyze();
    expect(task.status).toBe("succeeded");
    expect(task.output).toMatchObject({ pagesCrawled: 3, profileVersion: 1 });
    const snapshot = await prisma.websiteSnapshot.findFirstOrThrow({ where: { projectId: project.id } });
    expect((snapshot.pages as unknown[]).length).toBe(3);
    const profile = await prisma.brandProfile.findFirstOrThrow({ where: { projectId: project.id } });
    expect(profile).toMatchObject({ version: 1, source: "ai_draft", industry: "Career tools" });
  });

  it("wraps site content as untrusted data for the model", async () => {
    await analyze();
    const call = chat.mock.calls[0] as unknown as [{ messages: { role: string; content: string }[] }];
    const [system, prompt] = call[0].messages;
    expect(system!.content).toContain("<<<UNTRUSTED");
    expect(prompt!.content).toContain("<<<UNTRUSTED");
    expect(prompt!.content).toContain("honest feedback");
  });

  it("keeps the snapshot and skips the draft when no AI provider is configured", async () => {
    providers = [];
    const task = await analyze();
    expect(task.status).toBe("succeeded");
    expect(task.output).toMatchObject({ profileSkipped: "no_ai_provider" });
    expect(await prisma.websiteSnapshot.count()).toBe(1);
    expect(await prisma.brandProfile.count()).toBe(0);
  });

  it("does not call the AI when the site refuses the crawler", async () => {
    crawl.mockImplementation(async () => crawlOf(403, 1));
    const task = await analyze();
    expect(task.output).toMatchObject({ profileSkipped: "fetch_blocked", httpStatus: 403 });
    expect(chat).not.toHaveBeenCalled();
  });

  it("skips the draft for a near-empty client-rendered site", async () => {
    crawl.mockImplementation(async () => crawlOf(200, 1, 3));
    const task = await analyze();
    expect(task.output).toMatchObject({ profileSkipped: "thin_content" });
    expect(chat).not.toHaveBeenCalled();
  });

  it("records the AI failure reason instead of failing the analysis", async () => {
    chat.mockImplementationOnce(async () => {
      throw new Error("All AI providers failed (last: HTTP 503)");
    });
    const task = await analyze();
    expect(task.status).toBe("succeeded");
    expect(task.output).toMatchObject({ profileSkipped: "ai_failed", aiError: "All AI providers failed (last: HTTP 503)" });
  });

  it("crawls but does not draft (no AI spend, no profile write) while the emergency stop is on", async () => {
    await prisma.workspace.update({ where: { id: ws.id }, data: { emergencyStop: true } });
    const task = await analyze();
    expect(task.status).toBe("succeeded");
    expect(task.output).toMatchObject({ pagesCrawled: 3, profileSkipped: "emergency_stop" });
    expect(chat).not.toHaveBeenCalled();
    expect(await prisma.brandProfile.count()).toBe(0);
  });

  it("does not draft when brand edits or AI spending are denied by policy", async () => {
    for (const capability of ["brand.write", "spend.ai"]) {
      await prisma.projectPolicy.upsert({
        where: { projectId: project.id },
        create: { projectId: project.id, permissions: { [capability]: "deny" }, budget: {}, limits: {} },
        update: { permissions: { [capability]: "deny" } }
      });
      const task = await analyze();
      expect(task.output, capability).toMatchObject({ profileSkipped: "not_permitted" });
    }
    expect(chat).not.toHaveBeenCalled();
  });

  it("fails clearly when the project has no website", async () => {
    await prisma.project.update({ where: { id: project.id }, data: { websiteUrl: null } });
    const task = await analyze();
    expect(task.status).toBe("failed");
    expect(task.error).toMatch(/no website/i);
  });
});

describe("website.fetch", () => {
  it("fetches a page on the project's own site", async () => {
    const result = await executeTool(scope(), "website.fetch", { url: "https://vibejudge.app/pricing" });
    expect(result).toMatchObject({ status: "succeeded", output: { url: "https://vibejudge.app/pricing", title: "VibeJudge" } });
  });

  it("refuses another origin", async () => {
    const result = executeTool(scope(), "website.fetch", { url: "https://evil.test/" });
    await expect(result).rejects.toThrow(/project's website/);
  });

  it("validates the URL shape", async () => {
    await expect(executeTool(scope(), "website.fetch", { url: "nope" })).rejects.toBeInstanceOf(ValidationError);
  });
});
