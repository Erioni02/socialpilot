import { prisma, type Project } from "@socialpilot/db";
import { AppError, SetupRequiredError } from "@socialpilot/core";
import {
  completeJson,
  listOllamaModels,
  ollamaRoot,
  openaiProvider,
  imageProvider,
  textProvider,
  transcriptionProvider,
  videoProvider,
  type CompleteOptions,
  type TextProvider,
  type Usage,
} from "@socialpilot/ai";
import { AI_PROVIDER_CATALOG, estimateTextCost, estimateUnitCost, isCustomProvider, normalizePolicy, type AiConfig, type CustomCapability } from "@socialpilot/shared";
import type { z } from "zod";
import { getApiKey, getProviderCreds } from "../infra/credentials";
import { getCustomProvider, listCustomProviders, validateBaseUrl } from "../infra/custom-providers";
import { getProviderSettings } from "../infra/provider-settings";
import type { ReasoningLevel } from "@socialpilot/shared";

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

const TEXT_ORDER = ["nvidia", "anthropic", "openai", "gemini", "ollama"];
const VISION_CAPABLE = ["nvidia", "anthropic", "openai", "gemini", "ollama"];
const IMAGE_ORDER = ["cloudflare", "openai", "replicate", "stability"];
const VIDEO_ORDER = ["byteplus", "replicate"];

/** text = main agent model (tool use); reasoning = planning & analysis; vision = images/video frames; fast = cheap classification. */
export type TextRole = "text" | "reasoning" | "vision" | "fast";

function aiConfigOf(project?: Pick<Project, "aiConfig"> | null): AiConfig {
  return ((project?.aiConfig as AiConfig | null) ?? {}) as AiConfig;
}

type Found = { provider: string; creds: { apiKey: string; accountId?: string; baseUrl?: string }; custom?: NonNullable<Awaited<ReturnType<typeof getCustomProvider>>> };

async function firstConfigured(userId: string, order: string[]): Promise<Found | null> {
  for (const p of order) {
    if (isCustomProvider(p)) {
      const c = await getCustomProvider(userId, p);
      if (c) return { provider: p, creds: { apiKey: c.apiKey ?? "", baseUrl: c.baseUrl }, custom: c };
      continue;
    }
    const creds = await getProviderCreds(userId, p);
    if (creds) return { provider: p, creds };
  }
  return null;
}

const ollamaCache = new Map<string, { at: number; models: Awaited<ReturnType<typeof listOllamaModels>> }>();
/** Installed Ollama models (cached 60s). Used to pick a sensible default when none is configured. */
async function ollamaDefault(baseUrl: string | undefined, apiKey: string | undefined, role: string): Promise<string> {
  const key = `${ollamaRoot(baseUrl)}|${apiKey ? "k" : ""}`;
  let hit = ollamaCache.get(key);
  if (!hit || Date.now() - hit.at > 60_000) {
    hit = { at: Date.now(), models: await listOllamaModels(baseUrl, apiKey) };
    ollamaCache.set(key, hit);
  }
  const chat = hit.models.filter((m) => !/embed|bge|nomic|minilm/i.test(m.name));
  const pick = role === "vision" ? chat.find((m) => m.vision) : chat[0];
  if (!pick) {
    throw new SetupRequiredError(
      role === "vision"
        ? 'No vision model is installed in Ollama. Run e.g. "ollama pull gemma3" or "ollama pull qwen2.5vl", or choose a model in Settings → AI providers → Ollama → Model & reasoning.'
        : 'No models are installed in Ollama. Run e.g. "ollama pull llama3.2" (or "ollama pull qwen3" for tool calling).',
      { kind: "ai_provider", provider: "ollama", link: "/settings?tab=ai" },
    );
  }
  return pick.name;
}

/** Custom (user-added) providers that declare a capability, in the order they were added. */
async function customIds(userId: string, cap: CustomCapability) {
  return (await listCustomProviders(userId)).filter((c) => c.capabilities.includes(cap)).map((c) => c.id);
}

function customDefault(c: NonNullable<Found["custom"]>, role: string, kind: "text" | "image" = "text"): string {
  const d = c.defaultModels as Record<string, string | undefined>;
  const m = d[role] ?? (kind === "text" ? d.text : undefined) ?? c.models.find((x) => x.kind === kind && (!x.roles || x.roles.includes(role as any)))?.id ?? c.models.find((x) => x.kind === kind)?.id;
  if (!m) throw new SetupRequiredError(`Custom provider "${c.name}" has no ${kind} model set. Edit it in Settings → AI providers and add a model id.`, { kind: "ai_provider", link: "/settings?tab=ai" });
  return m;
}

/** Per-call text cost: custom providers use their configured prices (0 when unknown), built-ins use the price table. */
export function textCost(ai: { price?: { input?: number; output?: number } | null }, model: string, inTok: number, outTok: number) {
  if (ai.price) return (inTok * (ai.price.input ?? 0) + outTok * (ai.price.output ?? 0)) / 1_000_000;
  return estimateTextCost(model, inTok, outTok);
}

function roleConfig(cfg: AiConfig, role: TextRole): { provider?: string | null; model?: string | null } {
  if (role === "reasoning") return { provider: cfg.reasoningProvider, model: cfg.reasoningModel };
  if (role === "vision") return { provider: cfg.visionProvider, model: cfg.visionModel };
  if (role === "fast") return { provider: cfg.fastProvider, model: cfg.fastModel };
  return { provider: cfg.textProvider, model: cfg.textModel };
}

/**
 * Picks the provider + model for a job. Order: the role's configured provider, then the main provider,
 * then the first configured one (NVIDIA first). Models default to the provider catalog's per-role default.
 */
export async function resolveTextAI(userId: string, project?: Pick<Project, "aiConfig"> | null, opts: { needsTools?: boolean; role?: TextRole } = {}) {
  const cfg = aiConfigOf(project);
  const role = opts.role ?? "text";
  const rc = roleConfig(cfg, role);
  const preferred = [rc.provider, cfg.textProvider].filter((p): p is string => !!p);
  const customs = await listCustomProviders(userId);
  const customOk = (id: string) => {
    const c = customs.find((x) => x.id === id);
    if (!c) return false;
    if (opts.needsTools && !c.capabilities.includes("tools")) return false;
    if (role === "vision" && !c.capabilities.includes("vision")) return false;
    return c.capabilities.includes("text") || c.capabilities.includes("vision");
  };
  let order = [...new Set([...preferred, ...TEXT_ORDER, ...customs.map((c) => c.id)])];
  if (opts.needsTools) order = order.filter((p) => p !== "gemini");
  if (role === "vision") order = order.filter((p) => VISION_CAPABLE.includes(p) || isCustomProvider(p));
  order = order.filter((p) => !isCustomProvider(p) || customOk(p));
  const found = await firstConfigured(userId, order);
  if (!found) {
    throw new SetupRequiredError(
      opts.needsTools
        ? "Agents need an NVIDIA, Anthropic or OpenAI API key. Add one in Settings → AI providers."
        : "No AI text provider is configured. Add an NVIDIA, Anthropic, OpenAI or Gemini API key in Settings → AI providers.",
      { kind: "ai_provider", link: "/settings?tab=ai" },
    );
  }
  // Precedence: project role override → provider settings (Settings → AI providers) → provider default.
  const ps = await getProviderSettings(userId, found.provider);
  const reasoning: ReasoningLevel = ps.reasoning[role] ?? "default";
  const pick = (fallback: () => string) =>
    found.provider === rc.provider && rc.model
      ? rc.model
      : found.provider === cfg.textProvider && cfg.textModel && role === "text"
        ? cfg.textModel
        : (ps.models[role] ?? fallback());
  if (found.custom) {
    const c = found.custom;
    await validateBaseUrl(c.baseUrl); // re-checked at call time (DNS can change)
    const model = pick(() => customDefault(c, role));
    const price = c.pricing.inputPer1M != null || c.pricing.outputPer1M != null ? { input: c.pricing.inputPer1M, output: c.pricing.outputPer1M } : { input: 0, output: 0 };
    return { providerId: found.provider, model, role, reasoning, price, provider: openaiProvider(c.apiKey ?? "", { id: c.name, baseUrl: c.baseUrl, tokenParam: c.tokenParam }) as ReturnType<typeof textProvider> };
  }
  if (found.provider === "ollama") {
    await validateBaseUrl(ollamaRoot(found.creds.baseUrl));
    const settled = found.provider === rc.provider && rc.model ? rc.model : found.provider === cfg.textProvider && cfg.textModel && role === "text" ? cfg.textModel : ps.models[role];
    const model = settled ?? (role !== "vision" ? ps.models.text : undefined) ?? (await ollamaDefault(found.creds.baseUrl, found.creds.apiKey || undefined, role));
    return { providerId: found.provider, model, role, reasoning, price: { input: 0, output: 0 } as { input?: number; output?: number } | null, provider: textProvider("ollama", found.creds) };
  }
  const defaults = AI_PROVIDER_CATALOG[found.provider as keyof typeof AI_PROVIDER_CATALOG].defaultModels;
  const model = pick(() => defaults[role] ?? ps.models.text ?? defaults.text!);
  return { providerId: found.provider, model, role, reasoning, price: null as { input?: number; output?: number } | null, provider: textProvider(found.provider, found.creds) };
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

export async function aiComplete(ctx: AiCallContext, opts: Omit<CompleteOptions, "model"> & { model?: string; role?: TextRole }, project?: Project | null) {
  const ai = await resolveTextAI(ctx.userId, project, { role: opts.role ?? (opts.images?.length ? "vision" : "text") });
  const model = opts.model ?? ai.model;
  await checkBudget(ctx, textCost(ai, model, 4000, 2000));
  const r = await ai.provider.complete({ ...opts, model, reasoning: ai.reasoning });
  await recordUsage(ctx, { provider: ai.providerId, model, kind: opts.images?.length ? "vision" : "text", usage: r.usage, costUsd: textCost(ai, model, r.usage.inputTokens, r.usage.outputTokens) });
  return { ...r, provider: ai.providerId };
}

export async function aiJson<S extends z.ZodTypeAny>(
  ctx: AiCallContext,
  opts: Omit<CompleteOptions, "model"> & { model?: string; schema: S; schemaHint: string; role?: TextRole },
  project?: Project | null,
): Promise<{ data: z.infer<S>; provider: string; model: string }> {
  const ai = await resolveTextAI(ctx.userId, project, { role: opts.role ?? (opts.images?.length ? "vision" : "text") });
  const model = opts.model ?? ai.model;
  await checkBudget(ctx, textCost(ai, model, 6000, 3000));
  const r = await completeJson(ai.provider as TextProvider, { ...opts, model, reasoning: ai.reasoning });
  await recordUsage(ctx, { provider: ai.providerId, model, kind: "text", usage: r.usage, costUsd: textCost(ai, model, r.usage.inputTokens, r.usage.outputTokens) });
  return { data: r.data, provider: ai.providerId, model };
}

export async function resolveImageAI(userId: string, project?: Pick<Project, "aiConfig"> | null, wanted?: string, capability: "generate" | "edit" | "remove_background" = "generate") {
  const cfg = aiConfigOf(project);
  const preferred = wanted ?? cfg.imageProvider ?? undefined;
  const customImg = capability === "generate" ? await customIds(userId, "image") : [];
  let order = [...new Set([...(preferred ? [preferred] : []), ...IMAGE_ORDER, ...customImg])];
  if (capability !== "generate") order = order.filter((p) => !isCustomProvider(p));
  if (capability === "edit") order = order.filter((p) => ["cloudflare", "openai", "replicate"].includes(p));
  if (capability === "remove_background") order = order.filter((p) => p === "replicate" || p === "stability");
  const found = await firstConfigured(userId, order);
  if (!found) {
    const needs = capability === "edit" ? "Cloudflare, OpenAI or Replicate" : capability === "remove_background" ? "Replicate or Stability AI" : "Cloudflare Workers AI, OpenAI, Replicate or Stability AI";
    throw new SetupRequiredError(`Image ${capability.replace("_", " ")} needs a ${needs} key. Add one in Settings → AI providers.`, { kind: "ai_provider", link: "/settings?tab=ai" });
  }
  if (found.custom) {
    const c = found.custom;
    await validateBaseUrl(c.baseUrl);
    const cps = await getProviderSettings(userId, found.provider);
    const model = found.provider === cfg.imageProvider && cfg.imageModel ? cfg.imageModel : (cps.models.image ?? customDefault(c, "image", "image"));
    return { providerId: found.provider, model, unitPrice: c.pricing.perImage ?? 0, provider: openaiProvider(c.apiKey ?? "", { id: c.name, baseUrl: c.baseUrl, tokenParam: c.tokenParam }) as ReturnType<typeof imageProvider> };
  }
  const ps = await getProviderSettings(userId, found.provider);
  const model =
    found.provider === cfg.imageProvider && cfg.imageModel ? cfg.imageModel : (ps.models.image ?? AI_PROVIDER_CATALOG[found.provider as keyof typeof AI_PROVIDER_CATALOG].defaultModels.image!);
  return { providerId: found.provider, model, unitPrice: null as number | null, provider: imageProvider(found.provider, found.creds) };
}

export async function resolveVideoAI(userId: string, project?: Pick<Project, "aiConfig"> | null) {
  const cfg = aiConfigOf(project);
  const order = cfg.videoProvider ? [cfg.videoProvider, ...VIDEO_ORDER.filter((p) => p !== cfg.videoProvider)] : VIDEO_ORDER;
  const found = await firstConfigured(userId, order);
  if (!found) throw new SetupRequiredError("Video generation needs a BytePlus (Seedance) or Replicate key. Add one in Settings → AI providers.", { kind: "ai_provider", link: "/settings?tab=ai" });
  const ps = await getProviderSettings(userId, found.provider);
  const model = found.provider === cfg.videoProvider && cfg.videoModel ? cfg.videoModel : (ps.models.video ?? AI_PROVIDER_CATALOG[found.provider as keyof typeof AI_PROVIDER_CATALOG].defaultModels.video!);
  return { providerId: found.provider, model, provider: videoProvider(found.provider, found.creds) };
}

export async function resolveTranscriptionAI(userId: string) {
  const key = await getApiKey(userId, "openai");
  if (!key) throw new SetupRequiredError("Automatic subtitles need an OpenAI API key (Whisper). You can also paste an SRT file.", { kind: "ai_provider", provider: "openai", link: "/settings/providers" });
  return { providerId: "openai", model: "whisper-1", provider: transcriptionProvider("openai", key) };
}

export { estimateUnitCost };
