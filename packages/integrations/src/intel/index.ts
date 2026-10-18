import { ProviderError, SsrfError } from "@socialpilot/core";
import { FREE_PROVIDERS, PAID_PROVIDERS } from "./providers";
import type { IntelOutcome } from "./types";
import { resolveAndParse, SocialUrlError, type ParsedSocialUrl } from "./urls";

export * from "./urls";
export * from "./types";
export * from "./providers";

const cache = new Map<string, { at: number; outcome: IntelOutcome }>();
const CACHE_MS = 10 * 60_000;

/**
 * Analyzes one public social URL with free sources. Paid sources run only when `paidProvider` is set — the caller is
 * responsible for having obtained the user's explicit approval for that specific request.
 */
export async function analyzeSocialUrl(
  raw: string,
  opts: { paidProvider?: string; apifyToken?: string; maxChargeUsd?: number; bypassCache?: boolean } = {},
): Promise<{ parsed?: ParsedSocialUrl; outcome: IntelOutcome }> {
  let parsed: ParsedSocialUrl;
  try {
    parsed = await resolveAndParse(raw);
  } catch (e) {
    if (e instanceof SocialUrlError || e instanceof SsrfError) return { outcome: { status: "error", message: e.message } };
    return { outcome: { status: "error", message: `Could not resolve that link: ${(e as Error).message}` } };
  }
  const key = `${parsed.platform}:${parsed.kind}:${parsed.externalId}:${opts.paidProvider ?? "free"}`;
  const hit = cache.get(key);
  if (!opts.paidProvider && !opts.bypassCache && hit && Date.now() - hit.at < CACHE_MS) return { parsed, outcome: hit.outcome };

  const provider = opts.paidProvider ? PAID_PROVIDERS.find((p) => p.id === opts.paidProvider && p.supports(parsed)) : FREE_PROVIDERS.find((p) => p.supports(parsed));
  if (!provider) return { parsed, outcome: { status: "error", message: opts.paidProvider ? `${opts.paidProvider} does not support this URL.` : "No data source supports this URL." } };
  let outcome: IntelOutcome;
  try {
    outcome = await provider.fetch(parsed, { apifyToken: opts.apifyToken, maxChargeUsd: opts.maxChargeUsd });
  } catch (e) {
    const msg = e instanceof ProviderError ? e.message : (e as Error).message;
    outcome = { status: (e as ProviderError).status === 429 ? "rate_limited" : "error", message: `${provider.label} failed: ${msg}` };
  }
  if (!opts.paidProvider && (outcome.status === "ok" || outcome.status === "partial")) cache.set(key, { at: Date.now(), outcome });
  return { parsed, outcome };
}
