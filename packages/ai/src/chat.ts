import type { ZodType } from "zod";
import { defaultFailover, StopFailover, type Failover } from "./failover";
import { estimateCostUsd } from "./pricing";
import type { ChatMessage, ProviderSpec, Usage } from "./providers";

export class AiInvalidOutputError extends Error {
  override name = "AiInvalidOutputError";
}

export type ChatOptions<T> = {
  providers: ProviderSpec[];
  messages: ChatMessage[];
  json?: boolean;
  schema?: ZodType<T>;
  signal?: AbortSignal;
  label?: string;
  client?: Failover;
};

export type ChatResult<T> = { text: string; data?: T; provider: string; model: string; costUsd: number; ms: number; usage?: Usage };

const MAX_INVALID_OUTPUTS = 2;

function parseJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced ? fenced[1]! : text).trim();
  const start = candidate.search(/[[{]/);
  return JSON.parse(start > 0 ? candidate.slice(start) : candidate);
}

/**
 * One chat completion through the failover chain. With a schema, output is parsed and validated;
 * an invalid answer is retried once on the next model, then the call fails with AiInvalidOutputError.
 */
export async function chat<T = never>(opts: ChatOptions<T>): Promise<ChatResult<T>> {
  const client = opts.client ?? defaultFailover;
  let invalid = 0;

  const validate = (content: string): { text: string; data?: T } => {
    if (!opts.schema) {
      if (!content) throw new Error("empty response");
      return { text: content };
    }
    try {
      return { text: content, data: opts.schema.parse(parseJson(content)) };
    } catch (error) {
      invalid += 1;
      const failure = new AiInvalidOutputError(`AI returned invalid output: ${(error as Error).message.slice(0, 300)}`);
      if (invalid >= MAX_INVALID_OUTPUTS) throw new StopFailover(failure);
      throw failure;
    }
  };

  const result = await client.complete(opts.providers, opts.messages, {
    json: Boolean(opts.json || opts.schema),
    validate,
    label: opts.label ?? "chat",
    signal: opts.signal
  });
  return {
    text: result.value.text,
    data: result.value.data,
    provider: result.provider,
    model: result.model,
    ms: result.ms,
    usage: result.usage,
    costUsd: estimateCostUsd(result.model, result.usage)
  };
}
