import { providerFetch, ProviderError } from "@socialpilot/core";
import { openaiProvider } from "./openai";
import type { TextProvider } from "./types";

/**
 * Ollama Cloud (https://ollama.com) — hosted open models, authenticated with an API key. No local install.
 * Chat goes through Ollama's OpenAI-compatible /v1 endpoint (tools, base64 images, reasoning_effort);
 * installed models come from the native /api/tags endpoint.
 */
export const OLLAMA_DEFAULT_URL = "https://ollama.com";

/** Accepts "http://host:11434", ".../v1" or ".../api" and returns the server root. */
export function ollamaRoot(baseUrl?: string) {
  return (baseUrl || OLLAMA_DEFAULT_URL).trim().replace(/\/+$/, "").replace(/\/(v1|api)$/, "");
}

const authHeaders = (apiKey?: string): Record<string, string> => (apiKey ? { authorization: `Bearer ${apiKey}` } : {});

export interface OllamaModel {
  name: string;
  sizeBytes?: number;
  family?: string;
  parameterSize?: string;
  vision: boolean;
}

const VISION_HINT = /(llava|vision|-vl|vl:|qwen2\.5vl|qwen3-vl|gemma3|minicpm-v|moondream|bakllava|llama4|mistral-small3)/i;

export async function listOllamaModels(baseUrl?: string, apiKey?: string): Promise<OllamaModel[]> {
  let r: any;
  try {
    r = await providerFetch<any>("ollama", `${ollamaRoot(baseUrl)}/api/tags`, { headers: authHeaders(apiKey), timeoutMs: 10000 });
  } catch (e) {
    const status = (e as ProviderError).status;
    if (!status) throw new ProviderError("ollama", `Could not reach Ollama Cloud at ${ollamaRoot(baseUrl)}.`);
    if (status === 401 || status === 403) throw new ProviderError("ollama", "Ollama Cloud rejected the API key. Create one at ollama.com/settings/keys.", status);
    throw e;
  }
  return (r.models ?? []).map((m: any) => ({
    name: String(m.name ?? m.model),
    sizeBytes: m.size,
    family: m.details?.family,
    parameterSize: m.details?.parameter_size,
    vision: VISION_HINT.test(String(m.name ?? "")) || (m.details?.families ?? []).some((f: string) => /clip|mllama/i.test(f)),
  }));
}

export function ollamaProvider(baseUrl?: string, apiKey?: string): TextProvider {
  if (!apiKey) throw new ProviderError("ollama", "Add your Ollama Cloud API key in Settings → AI providers.");
  const base = openaiProvider(apiKey, { id: "ollama", baseUrl: `${ollamaRoot(baseUrl)}/v1`, tokenParam: "max_tokens", reasoningStyle: "ollama" });
  return {
    id: "ollama",
    complete: base.complete,
    createSession: base.createSession,
    async test() {
      const models = await listOllamaModels(baseUrl, apiKey);
      if (!models.length) return "Connected to Ollama Cloud.";
      return `Connected — ${models.length} model(s): ${models
        .slice(0, 4)
        .map((m) => m.name)
        .join(", ")}${models.length > 4 ? "…" : ""}`;
    },
  };
}
