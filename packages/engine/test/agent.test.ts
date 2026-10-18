import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ChatSession, TurnResult } from "@socialpilot/ai";

/**
 * Scripted model: exercises the real runner, tool registry, permission gates and persistence
 * without calling a paid provider.
 */
const script: ((lastResults: string[]) => TurnResult)[] = [];
vi.mock("../src/ai/service", async (orig) => {
  const actual = await orig<typeof import("../src/ai/service")>();
  return {
    ...actual,
    resolveTextAI: async () => ({
      providerId: "fake",
      model: "fake-model",
      provider: {
        id: "fake",
        complete: async () => ({ text: "", usage: { inputTokens: 0, outputTokens: 0 }, model: "fake-model" }),
        test: async () => "ok",
        createSession: (): ChatSession => {
          let turn = 0;
          let last: string[] = [];
          const next = async () => script[turn++](last);
          return {
            provider: "fake",
            model: "fake-model",
            sendUser: async () => next(),
            sendToolResults: async (results) => {
              last = results.map((r) => r.content);
              return next();
            },
          };
        },
      },
    }),
  };
});

const { prisma } = await import("@socialpilot/db");
const { createProject, runAgentTask } = await import("../src");

const call = (id: string, name: string, input: Record<string, unknown>) => ({ id, name, input });
const turn = (toolCalls: ReturnType<typeof call>[], text = ""): TurnResult => ({ text, toolCalls, usage: { inputTokens: 100, outputTokens: 50 }, stopReason: toolCalls.length ? "tool_use" : "end_turn", model: "fake-model" });

let userId: string;
beforeAll(async () => {
  userId = (await prisma.user.create({ data: { email: `agent-${Date.now()}@example.test`, name: "Agent Test", passwordHash: "x" } })).id;
});
afterAll(async () => prisma.$disconnect());

describe("agent runner", () => {
  it("plans, creates real drafts, is blocked from publishing at level 2, and finishes", async () => {
    const project = await createProject(userId, { name: "VibeJudge Agent", websiteUrl: "https://vibejudge.app" });
    script.length = 0;
    script.push(
      () => turn([call("1", "update_plan", { steps: [{ title: "Draft post", status: "in_progress" }, { title: "Schedule", status: "pending" }] })]),
      () => turn([call("2", "create_post_draft", { body: "Your CV is lying to you. Get an honest roast.", platforms: ["x"], cta: "Try it free" })]),
      (last) => {
        const { postId } = JSON.parse(last[0]);
        return turn([call("3", "schedule_post", { postId, scheduledAt: new Date(Date.now() + 86400_000).toISOString() })]);
      },
      (last) => {
        expect(last[0]).toMatch(/does not allow/); // Level 2 cannot schedule
        return turn([call("4", "finish", { summary: "Drafted one post; scheduling needs a higher autonomy level.", outstanding: ["Raise autonomy or schedule manually"] })]);
      },
    );
    const task = await prisma.task.create({ data: { projectId: project.id, title: "t", instruction: "Draft and schedule a post", agentType: "content_creation" } });
    const r = await runAgentTask({ taskId: task.id });
    expect(r).toEqual({ status: "completed" });
    const done = await prisma.task.findUniqueOrThrow({ where: { id: task.id }, include: { steps: { orderBy: { seq: "asc" } } } });
    expect(done.plan).toHaveLength(2);
    expect(done.summary).toMatch(/Drafted one post/);
    expect(done.steps.filter((s) => s.type === "tool_call").map((s) => s.tool)).toEqual(["update_plan", "create_post_draft", "schedule_post", "finish"]);
    expect(done.steps.find((s) => s.tool === "schedule_post" && s.type === "tool_result")?.status).toBe("error");
    expect(done.costUsd).toBeGreaterThanOrEqual(0);
    const posts = await prisma.post.findMany({ where: { projectId: project.id } });
    expect(posts).toHaveLength(1);
    expect(posts[0].createdBy).toBe("agent:content_creation");
    expect(await prisma.auditLog.count({ where: { projectId: project.id, action: "permission.denied" } })).toBe(1);
  });

  it("wraps third-party content as untrusted and rejects invalid tool arguments", async () => {
    const project = await createProject(userId, { name: "Untrusted" });
    script.length = 0;
    script.push(
      () => turn([call("1", "create_post_draft", { platforms: "not-an-array" })]),
      (last) => {
        expect(last[0]).toMatch(/Invalid arguments/);
        return turn([call("2", "research_trends", { query: "zzzz-no-match-zzzz", hours: 1 })]);
      },
      (last) => {
        expect(last[0].startsWith("<untrusted_content>")).toBe(true);
        return turn([], "Done.");
      },
    );
    // Avoid live network in research_trends: mark sources as freshly fetched.
    const { seedDiscoverSources } = await import("@socialpilot/db");
    await seedDiscoverSources(prisma);
    await prisma.discoverSource.updateMany({ data: { lastFetchAt: new Date() } });
    const task = await prisma.task.create({ data: { projectId: project.id, title: "t", instruction: "x", agentType: "trend_research" } });
    expect(await runAgentTask({ taskId: task.id })).toEqual({ status: "completed" });
  });

  it("stops immediately under emergency stop", async () => {
    const project = await createProject(userId, { name: "Stopped" });
    await prisma.user.update({ where: { id: userId }, data: { emergencyStop: true } });
    const task = await prisma.task.create({ data: { projectId: project.id, title: "t", instruction: "x" } });
    const r: any = await runAgentTask({ taskId: task.id });
    await prisma.user.update({ where: { id: userId }, data: { emergencyStop: false } });
    expect(r.failed).toMatch(/Emergency stop/);
  });
});
