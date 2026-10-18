import type { z } from "zod";
import { anthropicProvider } from "./anthropic";
import { openaiProvider } from "./openai";
import { geminiProvider } from "./gemini";
import { replicateProvider, replicateVideoProvider } from "./replicate";
import { stabilityProvider } from "./stability";
import { nvidiaProvider, listNvidiaModels } from "./nvidia";
import { cloudflareProvider } from "./cloudflare";
import { seedanceProvider } from "./seedance";
import type { CompleteOptions, ImageProvider, TextProvider, TranscriptionProvider, Usage, VideoProvider } from "./types";

export * from "./types";
export { anthropicProvider, openaiProvider, geminiProvider, replicateProvider, replicateVideoProvider, stabilityProvider, nvidiaProvider, listNvidiaModels, cloudflareProvider, seedanceProvider };
export { stripThinking } from "./openai";

/** Credential bundle: most providers need only apiKey; Cloudflare also needs accountId, BytePlus may set a regional baseUrl. */
export interface ProviderCredentials {
  apiKey: string;
  accountId?: string;
  baseUrl?: string;
}
const cred = (c: string | ProviderCredentials): ProviderCredentials => (typeof c === "string" ? { apiKey: c } : c);

export function textProvider(provider: string, c: string | ProviderCredentials): TextProvider {
  const { apiKey } = cred(c);
  switch (provider) {
    case "nvidia":
      return nvidiaProvider(apiKey);
    case "anthropic":
      return anthropicProvider(apiKey);
    case "openai":
      return openaiProvider(apiKey);
    case "gemini":
      return geminiProvider(apiKey);
    default:
      throw new Error(`Unsupported text provider: ${provider}`);
  }
}

export function imageProvider(provider: string, c: string | ProviderCredentials): ImageProvider {
  const { apiKey, accountId } = cred(c);
  switch (provider) {
    case "cloudflare":
      return cloudflareProvider(apiKey, accountId ?? "");
    case "openai":
      return openaiProvider(apiKey);
    case "replicate":
      return replicateProvider(apiKey);
    case "stability":
      return stabilityProvider(apiKey);
    default:
      throw new Error(`Unsupported image provider: ${provider}`);
  }
}

export function videoProvider(provider: string, c: string | ProviderCredentials): VideoProvider {
  const { apiKey, baseUrl } = cred(c);
  if (provider === "replicate") return replicateVideoProvider(apiKey);
  if (provider === "byteplus") return seedanceProvider(apiKey, baseUrl || undefined);
  throw new Error(`Unsupported video provider: ${provider}`);
}

export function transcriptionProvider(provider: string, apiKey: string): TranscriptionProvider {
  if (provider === "openai") return openaiProvider(apiKey);
  throw new Error(`Unsupported transcription provider: ${provider}`);
}

export async function testProvider(provider: string, c: string | ProviderCredentials): Promise<string> {
  const { apiKey, accountId, baseUrl } = cred(c);
  switch (provider) {
    case "cloudflare":
      return cloudflareProvider(apiKey, accountId ?? "").test();
    case "byteplus":
      return seedanceProvider(apiKey, baseUrl || undefined).test();
    case "nvidia":
    case "anthropic":
    case "openai":
    case "gemini":
      return textProvider(provider, apiKey).test();
    case "replicate":
      return replicateProvider(apiKey).test();
    case "stability":
      return stabilityProvider(apiKey).test();
    default:
      throw new Error(`No connection test for ${provider}`);
  }
}

/** Extracts the first JSON object/array from a model response (handles ```json fences). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error("No JSON found in model output");
  const open = candidate[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(candidate.slice(start, i + 1));
  }
  throw new Error("Unterminated JSON in model output");
}

/**
 * Asks a text model for JSON matching a zod schema; validates, and retries once with the validation error.
 * Returns parsed data plus the accumulated token usage.
 */
export async function completeJson<S extends z.ZodTypeAny>(
  provider: TextProvider,
  opts: CompleteOptions & { schema: S; schemaHint: string },
): Promise<{ data: z.infer<S>; usage: Usage; model: string }> {
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let prompt = `${opts.prompt}\n\nRespond with only valid JSON matching this shape:\n${opts.schemaHint}`;
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await provider.complete({ ...opts, prompt });
    usage.inputTokens += r.usage.inputTokens;
    usage.outputTokens += r.usage.outputTokens;
    try {
      const parsed = opts.schema.safeParse(extractJson(r.text));
      if (parsed.success) return { data: parsed.data, usage, model: r.model };
      lastErr = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    } catch (e) {
      lastErr = (e as Error).message;
    }
    prompt = `${opts.prompt}\n\nYour previous answer was not valid (${lastErr}). Respond with only valid JSON matching this shape:\n${opts.schemaHint}`;
  }
  throw new Error(`Model did not return valid JSON: ${lastErr}`);
}
