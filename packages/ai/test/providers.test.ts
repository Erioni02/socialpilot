import { afterEach, describe, expect, it, vi } from "vitest";
import { cloudflareProvider, listOllamaModels, nvidiaProvider, ollamaProvider, ollamaRoot, seedanceProvider, stripThinking } from "../src";

afterEach(() => vi.unstubAllGlobals());

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  });
  return calls;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("NVIDIA API Catalog", () => {
  it("uses the OpenAI-compatible endpoint with max_tokens and parses tool calls", async () => {
    const calls = mockFetch(() =>
      json({
        model: "moonshotai/kimi-k2.6",
        choices: [{ finish_reason: "tool_calls", message: { content: "<think>plan</think>On it", tool_calls: [{ id: "c1", function: { name: "update_plan", arguments: '{"steps":[]}' } }] } }],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      }),
    );
    const session = nvidiaProvider("nvapi-test").createSession!({ model: "moonshotai/kimi-k2.6", system: "s", tools: [{ name: "update_plan", description: "d", inputSchema: { type: "object" } }] });
    const turn = await session.sendUser("hi");
    expect(calls[0].url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.max_tokens).toBeDefined();
    expect(body.max_completion_tokens).toBeUndefined();
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer nvapi-test");
    expect(turn.text).toBe("On it");
    expect(turn.toolCalls).toEqual([{ id: "c1", name: "update_plan", input: { steps: [] } }]);
  });
  it("strips reasoning traces", () => {
    expect(stripThinking("<think>a\nb</think>\nAnswer")).toBe("Answer");
    expect(stripThinking("reasoning without opening tag</think>Answer")).toBe("Answer");
  });
});

describe("Cloudflare Workers AI", () => {
  it("decodes FLUX base64 output and posts to the account-scoped run URL", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const calls = mockFetch(() => json({ success: true, result: { image: png.toString("base64") } }));
    const out = await cloudflareProvider("cf-token", "acc123").generate({ model: "@cf/black-forest-labs/flux-1-schnell", prompt: "a cat" });
    expect(calls[0].url).toBe("https://api.cloudflare.com/client/v4/accounts/acc123/ai/run/@cf/black-forest-labs/flux-1-schnell");
    expect(out[0].data.equals(png)).toBe(true);
    expect(out[0].mimeType).toBe("image/png");
  });
  it("accepts binary image responses (Stable Diffusion models)", async () => {
    mockFetch(() => new Response(new Uint8Array([0xff, 0xd8, 0xff, 1]), { headers: { "content-type": "image/jpeg" } }));
    const out = await cloudflareProvider("t", "a").generate({ model: "@cf/bytedance/stable-diffusion-xl-lightning", prompt: "x", size: "1024x1536" });
    expect(out[0].mimeType).toBe("image/jpeg");
  });
  it("surfaces Cloudflare error messages", async () => {
    mockFetch(() => json({ success: false, errors: [{ message: "Authentication error" }] }, 401));
    await expect(cloudflareProvider("t", "a").generate({ model: "@cf/black-forest-labs/flux-1-schnell", prompt: "x" })).rejects.toThrow(/Authentication error/);
  });
  it("requires an account id", () => {
    expect(() => cloudflareProvider("t", "")).toThrow(/account ID/);
  });
});

describe("ByteDance Seedance (BytePlus ModelArk)", () => {
  it("creates a task, polls until succeeded and downloads the video", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });
    let polls = 0;
    const calls = mockFetch((url, init) => {
      if (url.endsWith("/contents/generations/tasks") && init.method === "POST") return json({ id: "cgt-1" });
      if (url.includes("/contents/generations/tasks/cgt-1")) return json(++polls < 2 ? { id: "cgt-1", status: "running" } : { id: "cgt-1", status: "succeeded", content: { video_url: "https://cdn.example/v.mp4" } });
      if (url === "https://cdn.example/v.mp4") return new Response(new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]));
      return json({}, 404);
    });
    const p = seedanceProvider("ark-key").generate({ model: "dreamina-seedance-2-0-fast-260128", prompt: "launch teaser", aspect: "9:16", durationSec: 5, imageDataUri: "data:image/png;base64,AAAA" });
    await vi.advanceTimersByTimeAsync(20000);
    const out = await p;
    vi.useRealTimers();
    const create = JSON.parse(String(calls[0].init.body));
    expect(calls[0].url).toBe("https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks");
    expect(create).toMatchObject({ model: "dreamina-seedance-2-0-fast-260128", ratio: "9:16", duration: 5 });
    expect(create.content[0]).toEqual({ type: "text", text: "launch teaser" });
    expect(create.content[1]).toMatchObject({ type: "image_url", role: "first_frame" });
    expect(out.mimeType).toBe("video/mp4");
    expect(out.data.length).toBe(8);
  });
  it("reports failed tasks", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });
    mockFetch((url, init) => (init.method === "POST" ? json({ id: "x" }) : json({ status: "failed", error: { message: "content policy" } })));
    const p = seedanceProvider("k", "https://ark.cn-beijing.volces.com/api/v3").generate({ model: "m", prompt: "p", aspect: "16:9", durationSec: 5 });
    const assertion = expect(p).rejects.toThrow(/content policy/);
    await vi.advanceTimersByTimeAsync(10000);
    await assertion;
    vi.useRealTimers();
  });
});

describe("reasoning levels", () => {
  it("maps levels to OpenAI-style and compatible request fields", async () => {
    const { reasoningFields } = await import("../src/openai");
    expect(reasoningFields("default", "openai")).toEqual({});
    expect(reasoningFields("minimal", "openai")).toEqual({ reasoning_effort: "minimal" });
    expect(reasoningFields("off", "openai")).toEqual({});
    expect(reasoningFields("high", "compatible")).toEqual({ reasoning_effort: "high" });
    expect(reasoningFields("off", "compatible")).toEqual({ chat_template_kwargs: { thinking: false, enable_thinking: false } });
  });
  it("sends the thinking switch to NVIDIA and a thinking budget to Gemini", async () => {
    const calls = mockFetch(() => json({ model: "m", choices: [{ finish_reason: "stop", message: { content: "ok" } }], candidates: [{ content: { parts: [{ text: "ok" }] } }], usage: {} }));
    await nvidiaProvider("k").complete({ model: "qwen/qwen3", prompt: "hi", reasoning: "on" });
    expect(JSON.parse(String(calls[0].init.body)).chat_template_kwargs).toEqual({ thinking: true, enable_thinking: true });
    const { geminiProvider } = await import("../src");
    await geminiProvider("g").complete({ model: "gemini-2.5-flash", prompt: "hi", reasoning: "off" });
    expect(JSON.parse(String(calls[1].init.body)).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });
});

describe("Ollama", () => {
  it("normalizes the server URL", () => {
    expect(ollamaRoot()).toBe("https://ollama.com");
    expect(ollamaRoot("http://box:11434/v1/")).toBe("http://box:11434");
    expect(ollamaRoot("https://ollama.com/api")).toBe("https://ollama.com");
  });

  it("lists installed models and flags vision models", async () => {
    const calls = mockFetch(() => json({ models: [{ name: "llama3.2:latest", size: 2e9, details: { family: "llama" } }, { name: "gemma3:4b", details: { family: "gemma3" } }] }));
    const models = await listOllamaModels(undefined, "ok-key");
    expect(calls[0].url).toBe("https://ollama.com/api/tags");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer ok-key");
    expect(models.map((m) => [m.name, m.vision])).toEqual([
      ["llama3.2:latest", false],
      ["gemma3:4b", true],
    ]);
  });

  it("explains an unreachable server", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(listOllamaModels()).rejects.toThrow(/Could not reach Ollama Cloud/);
  });

  it("chats through Ollama Cloud /v1 with the key and maps reasoning off to none", async () => {
    const calls = mockFetch(() => json({ model: "qwen3", choices: [{ finish_reason: "stop", message: { content: "<think>x</think>Hello" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }));
    const r = await ollamaProvider(undefined, "ok-key").complete({ model: "qwen3", prompt: "hi", reasoning: "off" });
    expect(calls[0].url).toBe("https://ollama.com/v1/chat/completions");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer ok-key");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.reasoning_effort).toBe("none");
    expect(body.max_tokens).toBeDefined();
    expect(r.text).toBe("Hello");
  });
});

describe("Ollama Cloud key", () => {
  it("requires an API key", () => {
    expect(() => ollamaProvider()).toThrow(/API key/);
  });
});
