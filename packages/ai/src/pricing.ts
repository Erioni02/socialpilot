import type { Usage } from "./providers";

/** USD per 1M tokens. Models not listed are treated as free (NVIDIA/Ollama free tiers). */
const PRICES: Record<string, { input: number; output: number }> = {};

export function estimateCostUsd(model: string, usage: Usage | undefined): number {
  const price = PRICES[model];
  if (!price || !usage) return 0;
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}
