/**
 * Approximate list prices used for budget enforcement (USD). These are estimates; the provider's invoice is authoritative.
 * Text prices are per 1M tokens. Unit prices are per generated image, per generated video, or per minute of audio.
 */
export const TEXT_PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-fable-5-1": { input: 10, output: 50 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1": { input: 2, output: 8 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
};
// NVIDIA API Catalog trial usage is credit-based (no per-token billing); counted as 0 for budgets.
const NVIDIA_FREE = { input: 0, output: 0 };
for (const m of ["moonshotai/", "nvidia/", "meta/", "z-ai/", "openai/gpt-oss", "qwen/", "deepseek-ai/", "mistralai/", "google/", "microsoft/"]) TEXT_PRICES[m] = NVIDIA_FREE;

export const DEFAULT_TEXT_PRICE = { input: 5, output: 20 };

export const UNIT_PRICES: Record<string, number> = {
  "gpt-image-1": 0.07,
  "black-forest-labs/flux-schnell": 0.003,
  "black-forest-labs/flux-1.1-pro": 0.04,
  "black-forest-labs/flux-kontext-pro": 0.04,
  "stable-image-core": 0.03,
  "stable-image-ultra": 0.08,
  "stability-remove-background": 0.02,
  "replicate-remove-background": 0.01,
  "minimax/video-01": 0.5,
  "kwaivgi/kling-v2.1": 0.3,
  "whisper-1": 0.006,
  "@cf/black-forest-labs/flux-1-schnell": 0.0015,
  "@cf/bytedance/stable-diffusion-xl-lightning": 0,
  "@cf/stabilityai/stable-diffusion-xl-base-1.0": 0,
  "@cf/runwayml/stable-diffusion-v1-5-img2img": 0,
  "dreamina-seedance-2-0-fast-260128": 0.4, // estimate per 5s 720p clip
  "dreamina-seedance-2-0-260128": 0.8,
};

export function estimateTextCost(model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(TEXT_PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => model.startsWith(k));
  const p = key ? TEXT_PRICES[key] : DEFAULT_TEXT_PRICE;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export function estimateUnitCost(model: string, units = 1): number {
  return (UNIT_PRICES[model] ?? 0.05) * units;
}
