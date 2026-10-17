/**
 * Multi-provider, multi-model LLM failover, ported from VibeJudge (lib/ai/llm.ts).
 *
 * Order: provider → model → key. What a failure means decides what happens next:
 *   - key problems (401/403 bad key, 429 rate limit) → same model, next key
 *   - model problems (timeout, 5xx, invalid output)   → next model (its other keys are skipped)
 *   - every model of a provider failed                → next provider
 *
 * Health persists across calls of one client:
 *   bad key 30 min · retired model (404/410) 30 min · timeout 5 min · 2 strikes of 5xx/invalid → 2 min · 429 → that key+model 2 min.
 * Time: 25 s per attempt, 57 s per call, a non-final provider gets at most 32 s.
 * Parked attempts are still tried as a last resort so the chain can never lock itself out.
 */
import { callProvider, HttpError, type ChatMessage, type ProviderName, type ProviderSpec, type Usage } from "./providers";

export class AiNotConfiguredError extends Error {
  override name = "AiNotConfiguredError";
}
export class AiUnavailableError extends Error {
  override name = "AiUnavailableError";
}
/** Thrown by a validator to stop the whole chain immediately (not just this attempt). */
export class StopFailover extends Error {
  constructor(public cause: Error) {
    super(cause.message);
  }
}

const ATTEMPT_TIMEOUT_MS = 25_000;
const TOTAL_BUDGET_MS = 57_000;
const PROVIDER_BUDGET_MS = 32_000;
const STRIKES_BEFORE_COOLDOWN = 2;
const COOLDOWN_MS = 2 * 60_000;
const LONG_COOLDOWN_MS = 30 * 60_000;
const TIMEOUT_COOLDOWN_MS = 5 * 60_000;

export type CompleteOptions<T> = { json: boolean; validate: (content: string) => T; label: string; signal?: AbortSignal };
export type CompleteResult<T> = { value: T; provider: ProviderName; model: string; ms: number; usage?: Usage };

export type Failover = {
  complete<T>(providers: ProviderSpec[], messages: ChatMessage[], options: CompleteOptions<T>): Promise<CompleteResult<T>>;
};

/** Reasoning models sometimes prepend their thinking; strip it so validators see only the answer. */
export const cleanContent = (content: string) => content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

export function createFailover(deps: { fetch?: typeof fetch; now?: () => number } = {}): Failover {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? Date.now;
  const health = new Map<string, { strikes: number; until: number }>();

  const keyId = (p: string, key: string) => `key:${p}:${key.slice(-8)}`;
  const modelId = (p: string, model: string) => `model:${p}:${model}`;
  const attemptId = (p: string, model: string, key: string) => `attempt:${p}:${model}:${key.slice(-8)}`;
  const parked = (id: string) => (health.get(id)?.until ?? 0) > now();
  const park = (id: string, ms: number) => health.set(id, { strikes: 0, until: now() + ms });
  const strike = (id: string, immediate: boolean) => {
    const entry = health.get(id) ?? { strikes: 0, until: 0 };
    entry.strikes += 1;
    if (immediate || entry.strikes >= STRIKES_BEFORE_COOLDOWN) {
      entry.until = now() + COOLDOWN_MS;
      entry.strikes = 0;
    }
    health.set(id, entry);
  };

  return {
    async complete(chain, messages, options) {
      if (chain.length === 0) throw new AiNotConfiguredError("No AI provider is configured");

      type Attempt = { provider: ProviderSpec; model: string; key: string };
      const attempts: Attempt[] = chain.flatMap((provider) => provider.models.flatMap((model) => provider.keys.map((key) => ({ provider, model, key }))));
      const isParked = ({ provider, model, key }: Attempt) =>
        parked(keyId(provider.name, key)) || parked(modelId(provider.name, model)) || parked(attemptId(provider.name, model, key));

      const healthy = attempts.filter((a) => !isParked(a));
      const ordered = [...healthy, ...attempts.filter(isParked)];
      const deadline = now() + TOTAL_BUDGET_MS;
      const skipModels = new Set<string>();
      const providerStarted = new Map<string, number>();
      const lastProvider = chain[chain.length - 1]!.name;
      let lastReason = "no attempt made";

      for (const [index, { provider, model, key }] of ordered.entries()) {
        if (options.signal?.aborted) throw new AiUnavailableError("Cancelled");
        const remaining = deadline - now();
        if (remaining < 3_000) break;
        if (index < healthy.length && (parked(keyId(provider.name, key)) || parked(modelId(provider.name, model)))) continue;
        if (skipModels.has(modelId(provider.name, model))) continue;

        let limit = Math.min(ATTEMPT_TIMEOUT_MS, remaining);
        if (index < healthy.length && provider.name !== lastProvider) {
          const startedAt = providerStarted.get(provider.name) ?? now();
          providerStarted.set(provider.name, startedAt);
          const providerLeft = startedAt + PROVIDER_BUDGET_MS - now();
          if (providerLeft < 3_000) continue;
          limit = Math.min(limit, providerLeft);
        }

        const controller = new AbortController();
        const onOuterAbort = () => controller.abort();
        options.signal?.addEventListener("abort", onOuterAbort);
        const timer = setTimeout(() => controller.abort(), limit);
        const started = now();

        try {
          const reply = await callProvider(provider, key, model, messages, { json: options.json, signal: controller.signal, fetch: fetchImpl });
          const value = options.validate(cleanContent(reply.content));
          health.delete(attemptId(provider.name, model, key));
          return { value, provider: provider.name, model, ms: now() - started, usage: reply.usage };
        } catch (cause) {
          if (cause instanceof StopFailover) throw cause.cause;
          const status = cause instanceof HttpError ? cause.status : null;
          const model$ = modelId(provider.name, model);
          lastReason = controller.signal.aborted ? "timeout" : status ? `HTTP ${status}` : `invalid output (${(cause as Error).message})`;

          if (status === 401 || status === 403) park(keyId(provider.name, key), LONG_COOLDOWN_MS);
          else if (status === 429) strike(attemptId(provider.name, model, key), true);
          else if (status === 404 || status === 410) {
            park(model$, LONG_COOLDOWN_MS);
            skipModels.add(model$);
          } else if (controller.signal.aborted) {
            park(model$, TIMEOUT_COOLDOWN_MS);
            skipModels.add(model$);
          } else {
            strike(model$, false);
            skipModels.add(model$);
          }
        } finally {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", onOuterAbort);
        }
      }

      throw new AiUnavailableError(`All AI providers failed (last: ${lastReason})`);
    }
  };
}

/** Process-wide client so health is shared between tasks in one worker. */
export const defaultFailover = createFailover();
