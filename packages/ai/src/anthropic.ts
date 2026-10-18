import Anthropic from "@anthropic-ai/sdk";
import { ProviderError } from "@socialpilot/core";
import type {
  ChatSession,
  ChatSessionOptions,
  CompleteOptions,
  CompleteResult,
  ImageInput,
  TextProvider,
  ToolResult,
  TurnResult,
} from "./types";

/** Models that accept the server-side refusal fallback ("default" form). */
const FALLBACK_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-opus-5"];
const supportsFallback = (model: string) => FALLBACK_MODELS.includes(model);

type ImageMime = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function imageBlocks(images: ImageInput[] = []): Anthropic.Beta.BetaImageBlockParam[] {
  return images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.mimeType as ImageMime, data: img.base64 },
  }));
}

function wrapError(err: unknown): never {
  if (err instanceof Anthropic.RateLimitError) throw new ProviderError("anthropic", err.message, 429, undefined, true);
  if (err instanceof Anthropic.AuthenticationError) throw new ProviderError("anthropic", "Invalid Anthropic API key", 401);
  if (err instanceof Anthropic.BadRequestError) throw new ProviderError("anthropic", err.message, 400);
  if (err instanceof Anthropic.APIError) throw new ProviderError("anthropic", err.message, err.status, undefined, (err.status ?? 500) >= 500);
  if (err instanceof Anthropic.APIConnectionError) throw new ProviderError("anthropic", err.message, undefined, undefined, true);
  throw err;
}

function toTurn(resp: Anthropic.Beta.BetaMessage): TurnResult {
  const text = resp.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  const toolCalls = resp.content
    .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }));
  if (resp.stop_reason === "refusal") {
    const category = resp.stop_details?.category ?? "unspecified";
    return { text: text || `The model declined this request (category: ${category}).`, toolCalls: [], usage: usageOf(resp), stopReason: "refusal", model: resp.model };
  }
  return { text, toolCalls, usage: usageOf(resp), stopReason: resp.stop_reason ?? "other", model: resp.model };
}

function usageOf(resp: Anthropic.Beta.BetaMessage) {
  const u = resp.usage;
  return {
    inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    outputTokens: u.output_tokens ?? 0,
  };
}

export function anthropicProvider(apiKey: string): TextProvider {
  const client = new Anthropic({ apiKey, maxRetries: 2 });

  async function create(params: {
    model: string;
    system?: string;
    messages: Anthropic.Beta.BetaMessageParam[];
    tools?: Anthropic.Beta.BetaTool[];
    maxTokens?: number;
    effort?: CompleteOptions["effort"];
  }): Promise<Anthropic.Beta.BetaMessage> {
    const fallback = supportsFallback(params.model);
    try {
      const stream = client.beta.messages.stream({
        model: params.model,
        max_tokens: params.maxTokens ?? 32000,
        ...(params.system
          ? { system: [{ type: "text", text: params.system, cache_control: { type: "ephemeral" } }] as Anthropic.Beta.BetaTextBlockParam[] }
          : {}),
        messages: params.messages,
        ...(params.tools?.length ? { tools: params.tools, tool_choice: { type: "auto" } } : {}),
        output_config: { effort: params.effort ?? "medium" },
        ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
      return await stream.finalMessage();
    } catch (err) {
      wrapError(err);
    }
  }

  return {
    id: "anthropic",
    async complete(opts: CompleteOptions): Promise<CompleteResult> {
      const resp = await create({
        model: opts.model,
        system: opts.system,
        maxTokens: opts.maxTokens,
        effort: opts.effort ?? "low",
        messages: [{ role: "user", content: [...imageBlocks(opts.images), { type: "text", text: opts.prompt }] }],
      });
      const turn = toTurn(resp);
      return { text: turn.text, usage: turn.usage, model: resp.model };
    },
    createSession(opts: ChatSessionOptions): ChatSession {
      const history: Anthropic.Beta.BetaMessageParam[] = [];
      const tools: Anthropic.Beta.BetaTool[] = opts.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
      }));
      const run = async () => {
        const resp = await create({ model: opts.model, system: opts.system, messages: history, tools, maxTokens: opts.maxTokens, effort: opts.effort });
        // Append the full content (including thinking blocks) unchanged: the history is append-only.
        history.push({ role: "assistant", content: resp.content as Anthropic.Beta.BetaContentBlockParam[] });
        return toTurn(resp);
      };
      return {
        provider: "anthropic",
        model: opts.model,
        async sendUser(text, images) {
          history.push({ role: "user", content: [...imageBlocks(images), { type: "text", text }] });
          return run();
        },
        async sendToolResults(results: ToolResult[], followUpText?: string) {
          // All tool results for one assistant turn go back in a single user message.
          const content: Anthropic.Beta.BetaContentBlockParam[] = results.map((r) => ({
            type: "tool_result",
            tool_use_id: r.id,
            content: r.content,
            ...(r.isError ? { is_error: true } : {}),
          }));
          if (followUpText) content.push({ type: "text", text: followUpText });
          history.push({ role: "user", content });
          return run();
        },
      };
    },
    async test() {
      const page = await client.models.list({ limit: 5 }).catch(wrapError);
      return `Connected — ${page.data.length ? `models available (e.g. ${page.data[0].id})` : "key accepted"}`;
    },
  };
}
