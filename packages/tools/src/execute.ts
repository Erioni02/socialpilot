import { redact, redactText } from "@sp/crypto";
import { getProject, prisma, type Prisma } from "@sp/db";
import { READ_ONLY_CAPABILITIES } from "@sp/shared";
import { ZodError } from "zod";
import { checkBudget } from "./budget";
import { publishEvent, toTaskSummary } from "./events";
import { decide, loadPolicy } from "./policy";
import { MAX_ATTEMPTS, sendToolJob } from "./queue";
import { getTool } from "./registry";
import { RetryableError, type Actor, type AnyTool, type ToolContext } from "./types";

export class ValidationError extends Error {
  override name = "ValidationError";
}
export class ToolDeniedError extends Error {
  override name = "ToolDeniedError";
  constructor(public reason: string, message: string) {
    super(message);
  }
}
export class ToolFailedError extends Error {
  override name = "ToolFailedError";
}

export type ExecuteContext = { workspaceId: string; projectId: string; actor: Actor; parentTaskId?: string };
export type ExecuteResult =
  | { status: "succeeded"; taskId: string; output: unknown }
  | { status: "queued" | "awaiting_approval"; taskId: string };

type Enqueuer = (taskId: string) => Promise<void>;
let enqueue: Enqueuer = sendToolJob;
/** Swap the job queue (tests). */
export function setEnqueuer(fn: Enqueuer): void {
  enqueue = fn;
}
export function enqueueTask(taskId: string): Promise<void> {
  return enqueue(taskId);
}

const json = (value: unknown) => value as Prisma.InputJsonValue;

async function audit(ctx: ExecuteContext, action: string, args: unknown, outcome: string, error?: string) {
  await prisma.auditLog.create({
    data: {
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      action,
      argsRedacted: json(redact(args ?? null)),
      outcome,
      error: error ? redactText(error) : null
    }
  });
}

async function isStopped(workspaceId: string, projectId: string): Promise<boolean> {
  const [workspace, policy] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { emergencyStop: true } }),
    prisma.projectPolicy.findUnique({ where: { projectId }, select: { emergencyStop: true } })
  ]);
  return Boolean(workspace?.emergencyStop || policy?.emergencyStop);
}

/**
 * The single entry point for every action, from UI buttons and AI agents alike:
 * validate → emergency stop → permission/autonomy → budget → approval or run/enqueue → audit.
 */
export async function executeTool(ctx: ExecuteContext, name: string, rawInput: unknown): Promise<ExecuteResult> {
  const tool = getTool(name);
  if (!tool) throw new ValidationError(`Unknown tool "${name}"`);
  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(`Invalid input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`);
  const input = parsed.data;

  await getProject(ctx); // enforces workspace scoping; throws NotFoundError
  const policy = await loadPolicy(ctx.projectId);
  const deny = async (reason: string, message: string): Promise<never> => {
    await audit(ctx, name, input, "denied", `${reason}: ${message}`);
    throw new ToolDeniedError(reason, message);
  };

  if (!READ_ONLY_CAPABILITIES.has(tool.capability) && (await isStopped(ctx.workspaceId, ctx.projectId))) {
    await deny("emergency_stop", "The emergency stop is on. Turn it off to run actions that change anything.");
  }
  if (tool.userOnly && ctx.actor.type !== "user") await deny("user_only", `${name} can only be run by you.`);

  const { decision, reason } = decide(policy, tool, ctx.actor);
  if (decision === "deny") {
    await deny(reason, reason === "autonomy" ? `${name} needs autonomy level ${tool.minAutonomy}; the project is at level ${policy.autonomyLevel}.` : `${tool.capability} is not permitted for this project.`);
  }

  const estimate = tool.estimateCostUsd?.(input) ?? 0;
  const budget = await checkBudget(ctx.projectId, estimate, tool.capability === "spend.media" ? "media" : "ai", policy);
  if (!budget.ok) await deny("budget", budget.reason!);

  const task = await prisma.task.create({
    data: {
      projectId: ctx.projectId,
      type: tool.capability,
      toolName: name,
      status: decision === "approve" ? "awaiting_approval" : "queued",
      input: json(input),
      requestedBy: ctx.actor.type,
      actorId: ctx.actor.id,
      parentTaskId: ctx.parentTaskId
    }
  });
  await publishEvent(ctx.projectId, { type: "task.updated", task: toTaskSummary(task) });

  if (decision === "approve") {
    const approval = await prisma.approval.create({
      data: { projectId: ctx.projectId, taskId: task.id, toolName: name, payload: json(redact(input)), reason: `${tool.capability} requires approval` }
    });
    await audit(ctx, name, input, "approval_requested");
    await publishEvent(ctx.projectId, { type: "approval.created", approvalId: approval.id, taskId: task.id });
    return { status: "awaiting_approval", taskId: task.id };
  }

  if (tool.runMode === "inline") {
    const output = await runTask(task.id, { inline: true });
    return { status: "succeeded", taskId: task.id, output };
  }

  await enqueue(task.id);
  return { status: "queued", taskId: task.id };
}

export type RunOptions = { attempt?: number; maxAttempts?: number; inline?: boolean };

const isRetryable = (error: unknown) =>
  error instanceof RetryableError || (error instanceof Error && /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(error.message));

/**
 * Executes a stored task (worker entry point, also used for inline tools).
 * Retryable failures put the task back to `queued` and rethrow so the queue retries; the last attempt fails it.
 * Returns the output for inline runs; throws ToolFailedError when an inline run fails.
 */
export async function runTask(taskId: string, opts: RunOptions = {}): Promise<unknown> {
  const { attempt = 1, maxAttempts = MAX_ATTEMPTS, inline = false } = opts;
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { project: { select: { workspaceId: true } } } });
  if (!task || task.status === "succeeded" || task.status === "failed" || task.status === "cancelled" || task.status === "awaiting_approval") return undefined;

  const tool = getTool(task.toolName);
  const workspaceId = task.project.workspaceId;
  const actor: Actor = { type: task.requestedBy, id: task.actorId };
  const auditCtx: ExecuteContext = { workspaceId, projectId: task.projectId, actor };

  const finish = async (data: Prisma.TaskUpdateInput) => {
    const updated = await prisma.task.update({ where: { id: taskId }, data });
    await publishEvent(task.projectId, { type: "task.updated", task: toTaskSummary(updated) });
    return updated;
  };

  const fail = async (message: string) => {
    const safe = redactText(message);
    await finish({ status: "failed", error: safe, finishedAt: new Date() });
    await audit(auditCtx, task.toolName, task.input, "failed", safe);
    if (inline) throw new ToolFailedError(safe);
    return undefined;
  };

  if (!tool) return fail(`Tool "${task.toolName}" is not available in this version`);
  if (!READ_ONLY_CAPABILITIES.has(tool.capability) && (await isStopped(workspaceId, task.projectId))) {
    return fail("Blocked by the emergency stop");
  }

  await finish({ status: "running", attempts: { increment: 1 }, startedAt: task.startedAt ?? new Date(), error: null });

  const controller = new AbortController();
  let cost = 0;
  const ctx: ToolContext = {
    workspaceId,
    projectId: task.projectId,
    actor,
    taskId,
    signal: controller.signal,
    async emit(message, data, level = "info") {
      const event = await prisma.taskEvent.create({ data: { taskId, message: redactText(message), level, data: data === undefined ? undefined : json(redact(data)) } });
      await publishEvent(task.projectId, {
        type: "task.event",
        taskId,
        event: { id: event.id, at: event.at.toISOString(), level: event.level, message: event.message, data: event.data ?? null }
      });
      const current = await prisma.task.findUnique({ where: { id: taskId }, select: { status: true } });
      if (current?.status === "cancelled") controller.abort();
    },
    async recordSpend(category, amountUsd) {
      if (amountUsd <= 0) return;
      cost += amountUsd;
      await prisma.spendLedger.create({ data: { projectId: task.projectId, taskId, category, amountUsd } });
    }
  };

  try {
    const output = tool.output.parse(await tool.run(ctx, tool.input.parse(task.input)));
    const latest = await prisma.task.findUnique({ where: { id: taskId }, select: { status: true } });
    if (latest?.status === "cancelled") return undefined;
    await finish({ status: "succeeded", output: json(output), costUsd: { increment: cost }, finishedAt: new Date() });
    await audit(auditCtx, task.toolName, task.input, "succeeded");
    return output;
  } catch (error) {
    if (cost) await prisma.task.update({ where: { id: taskId }, data: { costUsd: { increment: cost } } });
    const message = error instanceof ZodError ? `Tool returned invalid output: ${error.issues[0]?.message}` : (error as Error).message;
    if (!inline && isRetryable(error) && attempt < maxAttempts) {
      await finish({ status: "queued", error: redactText(`Attempt ${attempt} failed: ${message}`) });
      throw error;
    }
    return fail(message);
  }
}

export type { AnyTool };
