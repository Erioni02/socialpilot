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

const BASE = "https://api.openai.com/v1";

type OAMessage = Record<string, unknown>;

function userContent(text: string, images: ImageInput[] = []) {
  if (!images.length) return text;
  return [
    ...images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mimeType};base64,${i.base64}` } })),
    { type: "text", text },
  ];
}

export function openaiProvider(apiKey: string): TextProvider & ImageProvider & TranscriptionProvider {
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };

  async function chat(model: string, messages: OAMessage[], tools?: ChatSessionOptions["tools"], maxTokens?: number) {
    const body: Record<string, unknown> = { model, messages, max_completion_tokens: maxTokens ?? 8000 };
    if (tools?.length) {
      body.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
      body.tool_choice = "auto";
    }
    const r = await providerFetch<any>("openai", `${BASE}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), timeoutMs: 180000 });
    const choice = r.choices?.[0];
    const msg = choice?.message ?? {};
    const turn: TurnResult = {
      text: (msg.content ?? "").trim(),
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
    id: "openai",
    async complete(opts: CompleteOptions) {
      const messages: OAMessage[] = [];
      if (opts.system) messages.push({ role: "system", content: opts.system });
      messages.push({ role: "user", content: userContent(opts.prompt, opts.images) });
      const { turn } = await chat(opts.model, messages, undefined, opts.maxTokens);
      return { text: turn.text, usage: turn.usage, model: turn.model };
    },
    createSession(opts: ChatSessionOptions): ChatSession {
      const history: OAMessage[] = [{ role: "system", content: opts.system }];
      const run = async () => {
        const { turn, message } = await chat(opts.model, history, opts.tools, opts.maxTokens);
        history.push({ role: "assistant", content: message.content ?? null, ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}) });
        return turn;
      };
      return {
        provider: "openai",
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
      const r = await providerFetch<any>("openai", `${BASE}/models`, { headers });
      return `Connected — ${r.data?.length ?? 0} models available`;
    },
    async generate(opts: ImageGenOptions) {
      const r = await providerFetch<any>("openai", `${BASE}/images/generations`, {
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
      const r = await providerFetch<any>("openai", `${BASE}/images/edits`, {
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
