import { z } from "zod";

/**
 * How much a model should think before answering. "default" sends nothing (the provider's own default).
 * Each provider maps the level to its own API: Anthropic `effort`, OpenAI `reasoning_effort`,
 * Gemini `thinkingBudget`, OpenAI-compatible APIs `reasoning_effort` / `chat_template_kwargs.thinking`.
 */
export const REASONING_LEVELS = ["default", "off", "on", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export const PROVIDER_ROLES = ["text", "reasoning", "vision", "fast", "image", "video"] as const;
export type ProviderRole = (typeof PROVIDER_ROLES)[number];
export const TEXT_ROLES = ["text", "reasoning", "vision", "fast"] as const;

export const providerSettingsSchema = z.object({
  /** Model id per role (overrides the provider's built-in default; a project can still override per role). */
  models: z.record(z.enum(PROVIDER_ROLES), z.string().trim().max(200)).default({}),
  /** Reasoning level per text role. */
  reasoning: z.record(z.enum(TEXT_ROLES), z.enum(REASONING_LEVELS)).default({}),
});
export type ProviderSettings = z.infer<typeof providerSettingsSchema>;

export const REASONING_LABELS: Record<ReasoningLevel, string> = {
  default: "Provider default",
  off: "Off (no thinking)",
  on: "On (thinking enabled)",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

/** Levels each provider family actually supports. */
export function reasoningOptions(provider: string): ReasoningLevel[] {
  if (provider === "anthropic") return ["default", "low", "medium", "high", "xhigh", "max"];
  if (provider === "openai") return ["default", "minimal", "low", "medium", "high"];
  if (provider === "gemini") return ["default", "off", "low", "medium", "high"];
  if (provider === "nvidia" || provider.startsWith("custom:")) return ["default", "off", "on", "low", "medium", "high"];
  if (provider === "ollama") return ["default", "off", "on", "low", "medium", "high", "max"];
  return ["default"];
}

export const REASONING_HELP: Record<string, string> = {
  anthropic: "Sets Claude's effort (adaptive thinking). Higher = deeper reasoning, more tokens.",
  openai: "Sets reasoning_effort. Only reasoning models (o-series, GPT-5) accept it — non-reasoning models will reject anything but “Provider default”.",
  gemini: "Sets the thinking budget (Off = 0 tokens; Low ≈ 1k, Medium ≈ 8k, High ≈ 24k).",
  nvidia: "Low/Medium/High send reasoning_effort (e.g. gpt-oss). On/Off toggle thinking for models with a thinking switch (e.g. Qwen3, Kimi, DeepSeek, GLM). Use only what the chosen model supports.",
  ollama: "Sends Ollama's reasoning_effort: Off = \"none\" (no thinking), On = default thinking, Low/Medium/High/Max for models with effort levels (e.g. gpt-oss). Models without thinking ignore it.",
  custom: "Low/Medium/High send reasoning_effort. On/Off send chat_template_kwargs {thinking, enable_thinking}. Use only what the chosen model supports.",
};
