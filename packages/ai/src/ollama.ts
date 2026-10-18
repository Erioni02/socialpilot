import { providerFetch, ProviderError } from "@socialpilot/core";
import { openaiProvider } from "./openai";
import type { TextProvider } from "./types";

/**
 * Ollama — local models (http://localhost:11434) or Ollama Cloud (https://ollama.com, needs a key).
 * Chat goes through Ollama's OpenAI-compatible /v1 endpoint (tools, base64 images, reasoning_effort);
 * installed models come from the native /api/tags endpoint.
 */
export const OLLAMA_DEFAULT_URL = "http://localhost:11434";

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
    if (!status) throw new ProviderError("ollama", `Could not reach Ollama at ${ollamaRoot(baseUrl)}. Is it running? Start it with "ollama serve" (or open the Ollama app).`);
    if (status === 401 || status === 403) throw new ProviderError("ollama", "Ollama rejected the API key (Ollama Cloud needs a valid key).", status);
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
  const base = openaiProvider(apiKey || "ollama", { id: "ollama", baseUrl: `${ollamaRoot(baseUrl)}/v1`, tokenParam: "max_tokens", reasoningStyle: "ollama" });
  return {
    id: "ollama",
    complete: base.complete,
    createSession: base.createSession,
    async test() {
      const models = await listOllamaModels(baseUrl, apiKey);
      if (!models.length) return 'Connected — but no models are installed yet. Run e.g. "ollama pull llama3.2".';
      return `Connected — ${models.length} model(s): ${models
        .slice(0, 4)
        .map((m) => m.name)
        .join(", ")}${models.length > 4 ? "…" : ""}`;
    },
  };
}
