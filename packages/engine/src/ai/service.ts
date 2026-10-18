import { prisma, type Project } from "@socialpilot/db";
import { AppError, SetupRequiredError } from "@socialpilot/core";
import {
  completeJson,
  imageProvider,
  textProvider,
  transcriptionProvider,
  videoProvider,
  type CompleteOptions,
  type TextProvider,
  type Usage,
} from "@socialpilot/ai";
import { AI_PROVIDER_CATALOG, estimateTextCost, estimateUnitCost, normalizePolicy, type AiConfig } from "@socialpilot/shared";
import type { z } from "zod";
import { getApiKey } from "../infra/credentials";

export interface AiCallContext {
  userId: string;
  projectId?: string | null;
  taskId?: string | null;
}

export class BudgetExceededError extends AppError {
  constructor(message: string) {
    super(402, message, "budget_exceeded");
  }
}

const TEXT_ORDER = ["anthropic", "openai", "gemini"];
const IMAGE_ORDER = ["openai", "replicate", "stability"];

function aiConfigOf(project?: Pick<Project, "aiConfig"> | null): AiConfig {
  return ((project?.aiConfig as AiConfig | null) ?? {}) as AiConfig;
}

async function firstConfigured(userId: string, order: string[]): Promise<{ provider: string; key: string } | null> {
  for (const p of order) {
    const key = await getApiKey(userId, p);
    if (key) return { provider: p, key };
  }
  return null;
}

export async function resolveTextAI(userId: string, project?: Pick<Project, "aiConfig"> | null, opts: { needsTools?: boolean } = {}) {
  const cfg = aiConfigOf(project);
  const order = cfg.textProvider ? [cfg.textProvider, ...TEXT_ORDER.filter((p) => p !== cfg.textProvider)] : TEXT_ORDER;
  const usable = opts.needsTools ? order.filter((p) => p !== "gemini") : order;
  const found = await firstConfigured(userId, usable);
  if (!found) {
    throw new SetupRequiredError(
      opts.needsTools
        ? "Agents need an Anthropic or OpenAI API key. Add one in Settings → AI providers."
        : "No AI text provider is configured. Add an Anthropic, OpenAI or Gemini API key in Settings → AI providers.",
      { kind: "ai_provider", link: "/settings/providers" },
    );
  }
  const model =
    found.provider === cfg.textProvider && cfg.textModel ? cfg.textModel : AI_PROVIDER_CATALOG[found.provider as keyof typeof AI_PROVIDER_CATALOG].defaultModels.text!;
  return { providerId: found.provider, model, provider: textProvider(found.provider, found.key) };
}

export async function hasTextAI(userId: string, project?: Pick<Project, "aiConfig"> | null): Promise<boolean> {
  try {
    await resolveTextAI(userId, project);
    return true;
  } catch {
    return false;
  }
}

/** Sums recorded AI spend for a project over a window. */
export async function spend(projectId: string, since: Date): Promise<number> {
  const r = await prisma.aiUsage.aggregate({ where: { projectId, createdAt: { gte: since } }, _sum: { costUsd: true } });
  return r._sum.costUsd ?? 0;
}

function startOfDayUtc() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function startOfMonthUtc() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export async function budgetStatus(project: Project) {
  const limits = normalizePolicy(project.policy).limits;
  const [today, month] = await Promise.all([spend(project.id, startOfDayUtc()), spend(project.id, startOfMonthUtc())]);
  return { today, month, dailyLimit: limits.dailyAiSpendUsd, monthlyLimit: limits.monthlyAiSpendUsd, taskLimit: limits.taskBudgetUsd };
}

/** Throws before a paid call would push the project over its daily/monthly budget or the task over its budget. */
export async function checkBudget(ctx: AiCallContext, estimateUsd: number): Promise<void> {
  if (!ctx.projectId) return;
  const project = await prisma.project.findUnique({ where: { id: ctx.projectId } });
  if (!project) return;
  const b = await budgetStatus(project);
  if (b.today + estimateUsd > b.dailyLimit) throw new BudgetExceededError(`Daily AI budget reached ($${b.today.toFixed(2)} of $${b.dailyLimit}). Raise it in Project settings → Limits.`);
  if (b.month + estimateUsd > b.monthlyLimit) throw new BudgetExceededError(`Monthly AI budget reached ($${b.month.toFixed(2)} of $${b.monthlyLimit}).`);
  if (ctx.taskId) {
    const task = await prisma.task.findUnique({ where: { id: ctx.taskId }, select: { costUsd: true } });
    if (task && task.costUsd + estimateUsd > b.taskLimit) throw new BudgetExceededError(`Task budget reached ($${task.costUsd.toFixed(2)} of $${b.taskLimit}).`);
  }
}

export async function recordUsage(
  ctx: AiCallContext,
  u: { provider: string; model: string; kind: string; usage?: Usage; units?: number; costUsd: number },
) {
  await prisma.aiUsage.create({
    data: {
      userId: ctx.userId,
      projectId: ctx.projectId ?? null,
      taskId: ctx.taskId ?? null,
      provider: u.provider,
      model: u.model,
      kind: u.kind,
      inputTokens: u.usage?.inputTokens ?? 0,
      outputTokens: u.usage?.outputTokens ?? 0,
      units: u.units ?? 0,
      costUsd: u.costUsd,
    },
  });
  if (ctx.taskId) await prisma.task.update({ where: { id: ctx.taskId }, data: { costUsd: { increment: u.costUsd } } });
}

export async function aiComplete(ctx: AiCallContext, opts: Omit<CompleteOptions, "model"> & { model?: string }, project?: Project | null) {
  const ai = await resolveTextAI(ctx.userId, project);
  const model = opts.model ?? ai.model;
  await checkBudget(ctx, estimateTextCost(model, 4000, 2000));
  const r = await ai.provider.complete({ ...opts, model });
  await recordUsage(ctx, { provider: ai.providerId, model, kind: opts.images?.length ? "vision" : "text", usage: r.usage, costUsd: estimateTextCost(model, r.usage.inputTokens, r.usage.outputTokens) });
  return { ...r, provider: ai.providerId };
}

export async function aiJson<S extends z.ZodTypeAny>(
  ctx: AiCallContext,
  opts: Omit<CompleteOptions, "model"> & { model?: string; schema: S; schemaHint: string },
  project?: Project | null,
): Promise<{ data: z.infer<S>; provider: string; model: string }> {
  const ai = await resolveTextAI(ctx.userId, project);
  const model = opts.model ?? ai.model;
  await checkBudget(ctx, estimateTextCost(model, 6000, 3000));
  const r = await completeJson(ai.provider as TextProvider, { ...opts, model });
  await recordUsage(ctx, { provider: ai.providerId, model, kind: "text", usage: r.usage, costUsd: estimateTextCost(model, r.usage.inputTokens, r.usage.outputTokens) });
  return { data: r.data, provider: ai.providerId, model };
}

export async function resolveImageAI(userId: string, project?: Pick<Project, "aiConfig"> | null, wanted?: string, capability: "generate" | "edit" | "remove_background" = "generate") {
  const cfg = aiConfigOf(project);
  const preferred = wanted ?? cfg.imageProvider ?? undefined;
  let order = preferred ? [preferred, ...IMAGE_ORDER.filter((p) => p !== preferred)] : IMAGE_ORDER;
  if (capability === "edit") order = order.filter((p) => p === "openai" || p === "replicate");
  if (capability === "remove_background") order = order.filter((p) => p === "replicate" || p === "stability");
  const found = await firstConfigured(userId, order);
  if (!found) {
    const needs = capability === "edit" ? "OpenAI or Replicate" : capability === "remove_background" ? "Replicate or Stability AI" : "OpenAI, Replicate or Stability AI";
    throw new SetupRequiredError(`Image ${capability.replace("_", " ")} needs an ${needs} API key. Add one in Settings → AI providers.`, { kind: "ai_provider", link: "/settings/providers" });
  }
  const model =
    found.provider === cfg.imageProvider && cfg.imageModel ? cfg.imageModel : AI_PROVIDER_CATALOG[found.provider as keyof typeof AI_PROVIDER_CATALOG].defaultModels.image!;
  return { providerId: found.provider, model, provider: imageProvider(found.provider, found.key) };
}

export async function resolveVideoAI(userId: string, project?: Pick<Project, "aiConfig"> | null) {
  const cfg = aiConfigOf(project);
  const key = await getApiKey(userId, "replicate");
  if (!key) throw new SetupRequiredError("Video generation needs a Replicate API token. Add one in Settings → AI providers.", { kind: "ai_provider", provider: "replicate", link: "/settings/providers" });
  return { providerId: "replicate", model: cfg.videoModel ?? AI_PROVIDER_CATALOG.replicate.defaultModels.video!, provider: videoProvider("replicate", key) };
}

export async function resolveTranscriptionAI(userId: string) {
  const key = await getApiKey(userId, "openai");
  if (!key) throw new SetupRequiredError("Automatic subtitles need an OpenAI API key (Whisper). You can also paste an SRT file.", { kind: "ai_provider", provider: "openai", link: "/settings/providers" });
  return { providerId: "openai", model: "whisper-1", provider: transcriptionProvider("openai", key) };
}

export { estimateUnitCost };
