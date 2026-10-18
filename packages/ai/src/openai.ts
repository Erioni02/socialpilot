import { providerFetch, ProviderError } from "@socialpilot/core";
import type {
  ChatSession,
  ChatSessionOptions,
  CompleteOptions,
  GeneratedMedia,
  ImageEditOptions,
  ImageGenOptions,
  ImageInput,
  ImageProvider,
  TextProvider,
  TranscriptionProvider,
  TurnResult,
} from "./types";

const OPENAI_BASE = "https://api.openai.com/v1";

/** Removes <think>…</think> reasoning traces some open models put in the visible content. */
export function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?<\/think>/i, "")
    .trim();
}

export interface OpenAICompatibleOptions {
  id?: string;
  baseUrl?: string;
  /** OpenAI uses max_completion_tokens; most other OpenAI-compatible APIs use max_tokens. */
  tokenParam?: "max_completion_tokens" | "max_tokens";
  /** "openai": reasoning_effort only. "compatible": reasoning_effort + chat_template_kwargs thinking switch. */
  reasoningStyle?: "openai" | "compatible" | "ollama";
}

/** Extra request fields for the chosen reasoning level (nothing for "default"). */
export function reasoningFields(level: string | undefined, style: "openai" | "compatible" | "ollama"): Record<string, unknown> {
  if (!level || level === "default") return {};
  if (style === "ollama") {
    // Ollama maps efforts per model; "none" disables thinking, any recognized effort enables it on boolean models.
    if (level === "off") return { reasoning_effort: "none" };
    if (level === "on") return { reasoning_effort: "medium" };
    return ["low", "medium", "high", "max"].includes(level) ? { reasoning_effort: level } : {};
  }
  if (style === "openai") return ["minimal", "low", "medium", "high"].includes(level) ? { reasoning_effort: level } : {};
  if (["low", "medium", "high"].includes(level)) return { reasoning_effort: level };
  if (level === "off" || level === "on") {
    const on = level === "on";
    return { chat_template_kwargs: { thinking: on, enable_thinking: on } };
  }
  return {};
}

type OAMessage = Record<string, unknown>;

function userContent(text: string, images: ImageInput[] = []) {
  if (!images.length) return text;
  return [
    ...images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mimeType};base64,${i.base64}` } })),
    { type: "text", text },
  ];
}

export function openaiProvider(apiKey: string, opts: OpenAICompatibleOptions = {}): TextProvider & ImageProvider & TranscriptionProvider {
  const BASE = opts.baseUrl ?? OPENAI_BASE;
  const PID = opts.id ?? "openai";
  const tokenParam = opts.tokenParam ?? "max_completion_tokens";
  const reasoningStyle = opts.reasoningStyle ?? (PID === "openai" ? "openai" : "compatible");
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };

  async function chat(model: string, messages: OAMessage[], tools?: ChatSessionOptions["tools"], maxTokens?: number, reasoning?: string) {
    const body: Record<string, unknown> = { model, messages, [tokenParam]: maxTokens ?? 8000, ...reasoningFields(reasoning, reasoningStyle) };
    if (tools?.length) {
      body.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
      body.tool_choice = "auto";
    }
    const r = await providerFetch<any>(PID, `${BASE}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), timeoutMs: 180000 });
    const choice = r.choices?.[0];
    const msg = choice?.message ?? {};
    const turn: TurnResult = {
      text: stripThinking(msg.content ?? ""),
      toolCalls: (msg.tool_calls ?? []).map((c: any) => {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(c.function?.arguments || "{}");
        } catch {
          input = { __invalid_json: c.function?.arguments };
        }
        return { id: c.id, name: c.function?.name, input };
      }),
      usage: { inputTokens: r.usage?.prompt_tokens ?? 0, outputTokens: r.usage?.completion_tokens ?? 0 },
      stopReason: choice?.finish_reason === "tool_calls" ? "tool_use" : choice?.finish_reason === "length" ? "max_tokens" : "end_turn",
      model: r.model ?? model,
    };
    return { turn, message: msg };
  }

  async function imagesFromResponse(r: any): Promise<GeneratedMedia[]> {
    const out: GeneratedMedia[] = [];
    for (const d of r.data ?? []) {
      if (d.b64_json) out.push({ data: Buffer.from(d.b64_json, "base64"), mimeType: "image/png" });
      else if (d.url) {
        const res = await fetch(d.url);
        out.push({ data: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get("content-type") ?? "image/png" });
      }
    }
    if (!out.length) throw new ProviderError("openai", "The image API returned no image data");
    return out;
  }

  return {
    id: PID,
    async complete(opts: CompleteOptions) {
      const messages: OAMessage[] = [];
      if (opts.system) messages.push({ role: "system", content: opts.system });
      messages.push({ role: "user", content: userContent(opts.prompt, opts.images) });
      const { turn } = await chat(opts.model, messages, undefined, opts.maxTokens, opts.reasoning);
      return { text: turn.text, usage: turn.usage, model: turn.model };
    },
    createSession(opts: ChatSessionOptions): ChatSession {
      const history: OAMessage[] = [{ role: "system", content: opts.system }];
      const run = async () => {
        const { turn, message } = await chat(opts.model, history, opts.tools, opts.maxTokens, opts.reasoning);
        history.push({ role: "assistant", content: message.content ?? null, ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}) });
        return turn;
      };
      return {
        provider: PID,
        model: opts.model,
        async sendUser(text, images) {
          history.push({ role: "user", content: userContent(text, images) });
          return run();
        },
        async sendToolResults(results, followUpText) {
          for (const r of results) history.push({ role: "tool", tool_call_id: r.id, content: r.isError ? `ERROR: ${r.content}` : r.content });
          if (followUpText) history.push({ role: "user", content: followUpText });
          return run();
        },
      };
    },
    async test() {
      const r = await providerFetch<any>(PID, `${BASE}/models`, { headers });
      return `Connected — ${r.data?.length ?? 0} models available`;
    },
    async generate(opts: ImageGenOptions) {
      const r = await providerFetch<any>(PID, `${BASE}/images/generations`, {
        method: "POST",
        headers,
        timeoutMs: 240000,
        body: JSON.stringify({ model: opts.model, prompt: opts.prompt, size: opts.size ?? "1024x1024", n: opts.n ?? 1 }),
      });
      return imagesFromResponse(r);
    },
    async edit(opts: ImageEditOptions) {
      const form = new FormData();
      form.append("model", opts.model);
      form.append("prompt", opts.prompt);
      if (opts.size) form.append("size", opts.size);
      const ext = opts.image.mimeType.split("/")[1] ?? "png";
      form.append("image", new Blob([new Uint8Array(opts.image.data)], { type: opts.image.mimeType }), `image.${ext}`);
      const r = await providerFetch<any>(PID, `${BASE}/images/edits`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
        timeoutMs: 240000,
      });
      return imagesFromResponse(r);
    },
    async transcribeToSrt(audio: Buffer, filename: string, model: string) {
      const form = new FormData();
      form.append("model", model || "whisper-1");
      form.append("response_format", "srt");
      form.append("file", new Blob([new Uint8Array(audio)]), filename);
      const res = await fetch(`${BASE}/audio/transcriptions`, { method: "POST", headers: { authorization: `Bearer ${apiKey}` }, body: form });
      const text = await res.text();
      if (!res.ok) throw new ProviderError("openai", `transcription failed: ${text.slice(0, 300)}`, res.status);
      return text;
    },
  };
}
