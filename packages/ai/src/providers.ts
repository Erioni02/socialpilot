export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ProviderName = "nvidia" | "ollama";
export const PROVIDER_NAMES: readonly ProviderName[] = ["nvidia", "ollama"];

export type ProviderSpec = { name: ProviderName; baseUrl: string; keys: string[]; models: string[] };

export type Usage = { inputTokens: number; outputTokens: number };
export type ProviderReply = { content: string; usage?: Usage };

export class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

export const DEFAULT_BASE_URLS: Record<ProviderName, string> = {
  nvidia: "https://integrate.api.nvidia.com/v1",
  ollama: "https://ollama.com"
};

// Ordered by measured reliability on free tiers (carried over from VibeJudge).
export const DEFAULT_MODELS: Record<ProviderName, string[]> = {
  nvidia: ["nvidia/nemotron-3-super-120b-a12b", "deepseek-ai/deepseek-v4.1-flash", "z-ai/glm-5.3-flash"],
  ollama: ["gemma4:31b", "gpt-oss:20b", "nemotron-3-nano:30b"]
};

type CallOptions = { json: boolean; signal: AbortSignal; fetch: typeof fetch };

export async function callProvider(spec: ProviderSpec, key: string, model: string, messages: ChatMessage[], opts: CallOptions): Promise<ProviderReply> {
  const base = spec.baseUrl.replace(/\/$/, "");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };

  if (spec.name === "ollama") {
    const response = await opts.fetch(`${base}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, stream: false, ...(opts.json ? { format: "json" } : {}), messages }),
      signal: opts.signal
    });
    if (!response.ok) throw new HttpError(response.status);
    const payload = (await response.json()) as { message?: { content?: string }; response?: string; prompt_eval_count?: number; eval_count?: number };
    const usage = payload.prompt_eval_count !== undefined ? { inputTokens: payload.prompt_eval_count, outputTokens: payload.eval_count ?? 0 } : undefined;
    return { content: String(payload.message?.content ?? payload.response ?? ""), usage };
  }

  const response = await opts.fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages, stream: false, temperature: 0.4 }),
    signal: opts.signal
  });
  if (!response.ok) throw new HttpError(response.status);
  const payload = (await response.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const usage = payload.usage ? { inputTokens: payload.usage.prompt_tokens ?? 0, outputTokens: payload.usage.completion_tokens ?? 0 } : undefined;
  return { content: String(payload.choices?.[0]?.message?.content ?? ""), usage };
}

const list = (value: string | undefined) =>
  Array.from(new Set((value ?? "").split(",").map((v) => v.trim()).filter(Boolean)));

/** Bootstrap providers from env (same variables VibeJudge uses). Used only when none are configured in the DB. */
export function providersFromEnv(env: Record<string, string | undefined> = process.env): ProviderSpec[] {
  const order = list(env.AI_PROVIDER_ORDER ?? "nvidia,ollama").filter((n): n is ProviderName => (PROVIDER_NAMES as string[]).includes(n));
  return order
    .map((name) => {
      const prefix = name.toUpperCase();
      const models = list(env[`${prefix}_MODELS`] ?? env[`${prefix}_MODEL`]);
      return {
        name,
        baseUrl: env[`${prefix}_BASE_URL`] || DEFAULT_BASE_URLS[name],
        keys: list([env[`${prefix}_API_KEYS`], env[`${prefix}_API_KEY`]].filter(Boolean).join(",")),
        models: models.length ? models : DEFAULT_MODELS[name]
      };
    })
    .filter((p) => p.keys.length > 0 && p.models.length > 0);
}
