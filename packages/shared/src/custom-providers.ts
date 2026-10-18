import { z } from "zod";

/**
 * User-defined AI providers. Any service with an OpenAI-compatible API works:
 *  - text / vision / tools via POST {baseUrl}/chat/completions
 *  - images via POST {baseUrl}/images/generations
 * Ids are "custom:<slug>".
 */
export const CUSTOM_CAPABILITIES = ["text", "vision", "tools", "image"] as const;
export type CustomCapability = (typeof CUSTOM_CAPABILITIES)[number];

export const customModelSchema = z.object({
  id: z.string().trim().min(1).max(200),
  kind: z.enum(["text", "image"]).default("text"),
  roles: z.array(z.enum(["text", "reasoning", "vision", "fast"])).optional(),
});

export const customProviderSchema = z.object({
  name: z.string().trim().min(2).max(60),
  baseUrl: z
    .string()
    .trim()
    .url()
    .max(300)
    .transform((u) => u.replace(/\/+$/, "")),
  apiKey: z.string().trim().max(4000).optional(),
  capabilities: z.array(z.enum(CUSTOM_CAPABILITIES)).min(1),
  models: z.array(customModelSchema).max(100).default([]),
  /** Default model per role / image. */
  defaultModels: z.record(z.enum(["text", "reasoning", "vision", "fast", "image"]), z.string().max(200)).default({}),
  /** Optional prices for budget tracking (USD). Unknown prices are counted as 0 and labelled. */
  pricing: z
    .object({
      inputPer1M: z.number().min(0).max(1000).optional(),
      outputPer1M: z.number().min(0).max(1000).optional(),
      perImage: z.number().min(0).max(100).optional(),
    })
    .default({}),
  /** "max_tokens" works for nearly every compatible API; OpenAI's newest models want max_completion_tokens. */
  tokenParam: z.enum(["max_tokens", "max_completion_tokens"]).default("max_tokens"),
});
export type CustomProviderInput = z.infer<typeof customProviderSchema>;

export interface CustomProviderInfo extends Omit<CustomProviderInput, "apiKey"> {
  id: string;
  hasKey: boolean;
  hint: string | null;
  status: string | null;
  lastTestedAt: string | null;
  lastError: string | null;
}

export const isCustomProvider = (id?: string | null) => !!id && id.startsWith("custom:");

export function customProviderId(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `custom:${slug || "provider"}`;
}

/** Starting points for popular OpenAI-compatible services. Every field stays editable. */
export const CUSTOM_PROVIDER_PRESETS: { label: string; name: string; baseUrl: string; capabilities: CustomCapability[]; keyUrl?: string; models: string[] }[] = [
  { label: "OpenRouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", capabilities: ["text", "vision", "tools"], keyUrl: "https://openrouter.ai/keys", models: [] },
  { label: "Groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", capabilities: ["text", "tools"], keyUrl: "https://console.groq.com/keys", models: [] },
  { label: "Together AI", name: "Together", baseUrl: "https://api.together.xyz/v1", capabilities: ["text", "vision", "tools", "image"], keyUrl: "https://api.together.ai/settings/api-keys", models: [] },
  { label: "DeepSeek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", capabilities: ["text", "tools"], keyUrl: "https://platform.deepseek.com/api_keys", models: [] },
  { label: "Mistral", name: "Mistral", baseUrl: "https://api.mistral.ai/v1", capabilities: ["text", "vision", "tools"], keyUrl: "https://console.mistral.ai/api-keys", models: [] },
  { label: "xAI (Grok)", name: "xAI", baseUrl: "https://api.x.ai/v1", capabilities: ["text", "vision", "tools", "image"], keyUrl: "https://console.x.ai", models: [] },
  { label: "Fireworks", name: "Fireworks", baseUrl: "https://api.fireworks.ai/inference/v1", capabilities: ["text", "vision", "tools"], keyUrl: "https://fireworks.ai/account/api-keys", models: [] },
  { label: "Ollama (local)", name: "Ollama", baseUrl: "http://localhost:11434/v1", capabilities: ["text", "tools"], models: [] },
  { label: "LM Studio (local)", name: "LM Studio", baseUrl: "http://localhost:1234/v1", capabilities: ["text", "tools"], models: [] },
];
