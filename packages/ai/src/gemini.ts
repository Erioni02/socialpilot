import { providerFetch } from "@socialpilot/core";
import type { CompleteOptions, TextProvider } from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
/** Thinking budget (tokens) per reasoning level. */
const THINKING: Record<string, number> = { off: 0, low: 1024, medium: 8192, high: 24576 };

/** Gemini text + vision (no tool-use session here; agents use Claude or OpenAI). */
export function geminiProvider(apiKey: string): TextProvider {
  const headers = { "x-goog-api-key": apiKey, "content-type": "application/json" };
  return {
    id: "gemini",
    async complete(opts: CompleteOptions) {
      const parts: Record<string, unknown>[] = (opts.images ?? []).map((i) => ({ inline_data: { mime_type: i.mimeType, data: i.base64 } }));
      parts.push({ text: opts.prompt });
      const r = await providerFetch<any>("gemini", `${BASE}/models/${encodeURIComponent(opts.model)}:generateContent`, {
        method: "POST",
        headers,
        timeoutMs: 180000,
        body: JSON.stringify({
          ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
          contents: [{ role: "user", parts }],
          generationConfig: {
            maxOutputTokens: opts.maxTokens ?? 8000,
            ...(opts.reasoning && THINKING[opts.reasoning] !== undefined ? { thinkingConfig: { thinkingBudget: THINKING[opts.reasoning] } } : {}),
          },
        }),
      });
      const text = (r.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("").trim();
      return {
        text,
        usage: { inputTokens: r.usageMetadata?.promptTokenCount ?? 0, outputTokens: r.usageMetadata?.candidatesTokenCount ?? 0 },
        model: opts.model,
      };
    },
    async test() {
      const r = await providerFetch<any>("gemini", `${BASE}/models?pageSize=5`, { headers });
      return `Connected — ${r.models?.length ?? 0}+ models available`;
    },
  };
}
