import { describe, expect, it } from "vitest";
import { AiNotConfiguredError, AiUnavailableError, createFailover } from "./failover";
import type { ProviderSpec } from "./providers";

type Call = { host: string; model: string; key: string };

/** Fake HTTP layer: `plan` maps "model|key" to an HTTP status (200 answers "ok"). */
function fakeFetch(plan: Record<string, number>) {
  const calls: Call[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const key = String((init?.headers as Record<string, string>).Authorization).replace("Bearer ", "");
    calls.push({ host: new URL(String(url)).host, model: body.model, key });
    const status = plan[`${body.model}|${key}`] ?? 200;
    const payload = new URL(String(url)).pathname.endsWith("/api/chat")
      ? { message: { content: `ok from ${body.model}` } }
      : { choices: [{ message: { content: `ok from ${body.model}` } }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
    return new Response(JSON.stringify(payload), { status });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const nvidia: ProviderSpec = { name: "nvidia", baseUrl: "https://nv.test/v1", keys: ["k1", "k2"], models: ["m1", "m2"] };
const ollama: ProviderSpec = { name: "ollama", baseUrl: "https://ol.test", keys: ["o1"], models: ["om1"] };
const messages = [{ role: "user" as const, content: "hi" }];
const accept = (content: string) => content;

describe("failover", () => {
  it("retries the same model with the next key after a 401", async () => {
    const { fetch, calls } = fakeFetch({ "m1|k1": 401 });
    const result = await createFailover({ fetch }).complete([nvidia], messages, { json: false, validate: accept, label: "t" });
    expect(calls.map((c) => `${c.model}|${c.key}`)).toEqual(["m1|k1", "m1|k2"]);
    expect(result).toMatchObject({ value: "ok from m1", provider: "nvidia", model: "m1" });
  });

  it("moves to the next model after a 5xx, skipping that model's other keys", async () => {
    const { fetch, calls } = fakeFetch({ "m1|k1": 500 });
    const result = await createFailover({ fetch }).complete([nvidia], messages, { json: false, validate: accept, label: "t" });
    expect(calls.map((c) => `${c.model}|${c.key}`)).toEqual(["m1|k1", "m2|k1"]);
    expect(result.model).toBe("m2");
  });

  it("falls through to the next provider when every model fails", async () => {
    const { fetch, calls } = fakeFetch({ "m1|k1": 500, "m2|k1": 503 });
    const result = await createFailover({ fetch }).complete([nvidia, ollama], messages, { json: false, validate: accept, label: "t" });
    expect(result.provider).toBe("ollama");
    expect(calls.at(-1)).toEqual({ host: "ol.test", model: "om1", key: "o1" });
  });

  it("throws AiNotConfiguredError with no providers", async () => {
    await expect(createFailover().complete([], messages, { json: false, validate: accept, label: "t" })).rejects.toBeInstanceOf(AiNotConfiguredError);
  });

  it("throws AiUnavailableError when everything fails", async () => {
    const { fetch } = fakeFetch({ "om1|o1": 500 });
    await expect(createFailover({ fetch }).complete([ollama], messages, { json: false, validate: accept, label: "t" })).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it("remembers a bad key across calls", async () => {
    const { fetch, calls } = fakeFetch({ "m1|k1": 401 });
    const client = createFailover({ fetch });
    await client.complete([nvidia], messages, { json: false, validate: accept, label: "t" });
    calls.length = 0;
    await client.complete([nvidia], messages, { json: false, validate: accept, label: "t" });
    expect(calls.map((c) => `${c.model}|${c.key}`)).toEqual(["m1|k2"]);
  });

  it("treats a validator rejection as a model failure", async () => {
    const { fetch, calls } = fakeFetch({});
    const validate = (content: string) => {
      if (content.includes("m1")) throw new Error("bad");
      return content;
    };
    const result = await createFailover({ fetch }).complete([nvidia], messages, { json: false, validate, label: "t" });
    expect(result.model).toBe("m2");
    expect(calls).toHaveLength(2);
  });

  it("reports token usage from OpenAI-compatible providers", async () => {
    const { fetch } = fakeFetch({});
    const result = await createFailover({ fetch }).complete([nvidia], messages, { json: false, validate: accept, label: "t" });
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });
});
