import { prisma } from "@sp/db";
import { resetDatabase } from "@sp/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { executeTool, runTask, setEnqueuer, ToolDeniedError, ValidationError } from "./execute";
import { clearRegistry, registerTool } from "./registry";
import { RetryableError } from "./types";

let ws: { id: string };
let project: { id: string };
let enqueued: string[] = [];

const user = { type: "user" as const, id: "u1" };
const agent = { type: "agent" as const, id: "planner" };
const scope = () => ({ workspaceId: ws.id, projectId: project.id });

beforeAll(() => setEnqueuer(async (taskId) => void enqueued.push(taskId)));
afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await resetDatabase();
  clearRegistry();
  enqueued = [];
  const owner = await prisma.user.create({ data: { email: "o@test.dev", passwordHash: "x" } });
  ws = await prisma.workspace.create({ data: { name: "w", ownerId: owner.id } });
  project = await prisma.project.create({ data: { workspaceId: ws.id, name: "VibeJudge", slug: "vibejudge" } });

  registerTool({
    name: "test.read",
    description: "read",
    input: z.object({}),
    output: z.object({ ok: z.boolean() }),
    capability: "website.read",
    minAutonomy: 1,
    approval: "never",
    runMode: "inline",
    run: async () => ({ ok: true })
  });
  registerTool({
    name: "test.write",
    description: "write",
    input: z.object({ apiKey: z.string().optional(), text: z.string() }),
    output: z.object({ echoed: z.string() }),
    capability: "brand.write",
    minAutonomy: 1,
    approval: "never",
    runMode: "inline",
    estimateCostUsd: () => 0.01,
    run: async (ctx, input) => {
      await ctx.emit("writing");
      await ctx.recordSpend("ai", 0.01);
      return { echoed: input.text };
    }
  });
  registerTool({
    name: "test.publish",
    description: "publish",
    input: z.object({ text: z.string() }),
    output: z.object({}),
    capability: "social.publish",
    minAutonomy: 1,
    approval: "policy",
    runMode: "queued",
    run: async () => ({})
  });
  registerTool({
    name: "test.queued",
    description: "queued",
    input: z.object({}),
    output: z.object({}),
    capability: "website.read",
    minAutonomy: 1,
    approval: "never",
    runMode: "queued",
    run: async () => ({})
  });
  registerTool({
    name: "test.broken",
    description: "fails",
    input: z.object({}),
    output: z.object({}),
    capability: "brand.write",
    minAutonomy: 1,
    approval: "never",
    runMode: "inline",
    run: async () => {
      throw new Error("upstream rejected key nvapi-SECRET123");
    }
  });
  registerTool({
    name: "test.flaky",
    description: "retryable",
    input: z.object({}),
    output: z.object({}),
    capability: "website.read",
    minAutonomy: 1,
    approval: "never",
    runMode: "queued",
    run: async () => {
      throw new RetryableError("503 from provider");
    }
  });
});

describe("executeTool", () => {
  it("runs an inline tool, persists output, events, spend and a redacted audit entry", async () => {
    const result = await executeTool({ ...scope(), actor: user }, "test.write", { text: "hi", apiKey: "sk-live" });
    expect(result).toMatchObject({ status: "succeeded", output: { echoed: "hi" } });
    const task = await prisma.task.findUniqueOrThrow({ where: { id: result.taskId }, include: { events: true } });
    expect(task.status).toBe("succeeded");
    expect(task.output).toEqual({ echoed: "hi" });
    expect(task.costUsd).toBeCloseTo(0.01);
    expect(task.events.map((e) => e.message)).toContain("writing");
    expect(await prisma.spendLedger.count({ where: { projectId: project.id } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "test.write" } });
    expect(audit.outcome).toBe("succeeded");
    expect(audit.argsRedacted).toEqual({ text: "hi", apiKey: "[REDACTED]" });
  });

  it("rejects invalid input without creating a task", async () => {
    await expect(executeTool({ ...scope(), actor: user }, "test.write", { text: 5 })).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma.task.count()).toBe(0);
  });

  it("rejects an unknown tool", async () => {
    await expect(executeTool({ ...scope(), actor: user }, "nope", {})).rejects.toBeInstanceOf(ValidationError);
  });

  it("blocks writes but allows reads during a workspace emergency stop", async () => {
    await prisma.workspace.update({ where: { id: ws.id }, data: { emergencyStop: true } });
    await expect(executeTool({ ...scope(), actor: user }, "test.write", { text: "x" })).rejects.toMatchObject({ reason: "emergency_stop" });
    await expect(executeTool({ ...scope(), actor: user }, "test.read", {})).resolves.toMatchObject({ status: "succeeded" });
    expect(await prisma.auditLog.count({ where: { outcome: "denied" } })).toBe(1);
  });

  it("parks an agent's approval-required call as awaiting_approval with a pending Approval", async () => {
    await prisma.projectPolicy.create({ data: { projectId: project.id, autonomyLevel: 4, permissions: {}, budget: {}, limits: {} } });
    const result = await executeTool({ ...scope(), actor: agent }, "test.publish", { text: "launch!" });
    expect(result.status).toBe("awaiting_approval");
    const approval = await prisma.approval.findFirstOrThrow({ where: { taskId: result.taskId } });
    expect(approval.status).toBe("pending");
    expect(approval.payload).toEqual({ text: "launch!" });
    expect(enqueued).toEqual([]);
  });

  it("enqueues queued tools", async () => {
    const result = await executeTool({ ...scope(), actor: user }, "test.queued", {});
    expect(result.status).toBe("queued");
    expect(enqueued).toEqual([result.taskId]);
  });

  it("refuses a call that would exceed today's AI budget", async () => {
    await prisma.spendLedger.create({ data: { projectId: project.id, category: "ai", amountUsd: 1 } });
    await expect(executeTool({ ...scope(), actor: user }, "test.write", { text: "x" })).rejects.toMatchObject({ reason: "budget" });
  });

  it("marks a failing inline tool failed with a redacted error", async () => {
    await expect(executeTool({ ...scope(), actor: user }, "test.broken", {})).rejects.toThrow(/upstream rejected key \[REDACTED\]/);
    const task = await prisma.task.findFirstOrThrow({ where: { toolName: "test.broken" } });
    expect(task.status).toBe("failed");
    expect(task.error).toBe("upstream rejected key [REDACTED]");
  });

  it("ToolDeniedError carries the reason", async () => {
    const policy = await prisma.projectPolicy.create({ data: { projectId: project.id, autonomyLevel: 1, permissions: { "brand.write": "deny" }, budget: {}, limits: {} } });
    expect(policy).toBeTruthy();
    const error = await executeTool({ ...scope(), actor: user }, "test.write", { text: "x" }).catch((e) => e);
    expect(error).toBeInstanceOf(ToolDeniedError);
    expect(error.reason).toBe("permission");
  });
});

describe("runTask", () => {
  it("requeues a retryable failure until the last attempt, then fails", async () => {
    const { taskId } = await executeTool({ ...scope(), actor: user }, "test.flaky", {});
    await expect(runTask(taskId, { attempt: 1, maxAttempts: 3 })).rejects.toBeInstanceOf(RetryableError);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("queued");
    await expect(runTask(taskId, { attempt: 3, maxAttempts: 3 })).resolves.toBeUndefined();
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe("failed");
    expect(task.attempts).toBe(2);
  });

  it("does nothing for a task that already finished", async () => {
    const { taskId } = await executeTool({ ...scope(), actor: user }, "test.read", {});
    await runTask(taskId);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).attempts).toBe(1);
  });

  it("refuses to run a queued write task once the emergency stop is on", async () => {
    registerTool({ name: "test.queuedWrite", description: "", input: z.object({}), output: z.object({}), capability: "brand.write", minAutonomy: 1, approval: "never", runMode: "queued", run: async () => ({}) });
    const { taskId } = await executeTool({ ...scope(), actor: user }, "test.queuedWrite", {});
    await prisma.workspace.update({ where: { id: ws.id }, data: { emergencyStop: true } });
    await runTask(taskId);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe("failed");
    expect(task.error).toMatch(/emergency stop/i);
  });
});
