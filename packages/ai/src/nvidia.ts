import { providerFetch } from "@socialpilot/core";
import { openaiProvider } from "./openai";
import type { TextProvider } from "./types";

/**
 * NVIDIA API Catalog (build.nvidia.com): OpenAI-compatible chat completions at integrate.api.nvidia.com/v1,
 * with tool calling and vision on supported models. Keys look like `nvapi-...`.
 */
export const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";

export function nvidiaProvider(apiKey: string): TextProvider {
  const base = openaiProvider(apiKey, { id: "nvidia", baseUrl: NVIDIA_BASE, tokenParam: "max_tokens" });
  return {
    id: "nvidia",
    complete: base.complete,
    createSession: base.createSession,
    async test() {
      // The model list is public, so verify the key with a 1-token completion instead.
      const r = await providerFetch<any>("nvidia", `${NVIDIA_BASE}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "z-ai/glm-5.3-flash", messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
        timeoutMs: 60000,
      });
      return `Connected — key accepted (${r.model ?? "model responded"})`;
    },
  };
}

export async function listNvidiaModels(): Promise<string[]> {
  const r = await providerFetch<any>("nvidia", `${NVIDIA_BASE}/models`, { timeoutMs: 20000 });
  return (r.data ?? []).map((m: any) => m.id as string).sort();
}
