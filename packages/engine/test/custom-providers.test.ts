import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@socialpilot/db";
import { createProject, listCustomProviders, resolveImageAI, resolveTextAI, saveCustomProvider, textCost } from "../src";

// Routing must not depend on keys in the developer's .env.
const AI_ENV = ["NVIDIA_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "OLLAMA_API_KEY", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "BYTEPLUS_API_KEY", "REPLICATE_API_TOKEN", "STABILITY_API_KEY"];
const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of AI_ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterAll(async () => {
  for (const k of AI_ENV) if (saved[k] !== undefined) process.env[k] = saved[k];
  await prisma.$disconnect();
});

const user = () => prisma.user.create({ data: { email: `custom-${Date.now()}-${Math.random()}@example.test`, name: "C", passwordHash: "x" } });

describe("custom AI providers", () => {
  it("stores, lists without the key, and routes to a custom provider", async () => {
    const u = await user();
    const id = await saveCustomProvider(u.id, {
      name: "Groq",
      baseUrl: "https://api.groq.com/openai/v1/",
      apiKey: "gsk_secret_value_1234",
      capabilities: ["text", "tools"],
      models: [{ id: "llama-3.3-70b-versatile" }, { id: "qwen/qwen3-32b" }],
      defaultModels: { text: "llama-3.3-70b-versatile", reasoning: "qwen/qwen3-32b" },
      pricing: { inputPer1M: 0.59, outputPer1M: 0.79 },
    });
    expect(id).toBe("custom:groq");
    const list = await listCustomProviders(u.id);
    expect(list[0]).toMatchObject({ id: "custom:groq", baseUrl: "https://api.groq.com/openai/v1", hasKey: true, hint: "…1234" });
    expect(JSON.stringify(list)).not.toContain("gsk_secret");
    const row = await prisma.providerCredential.findFirstOrThrow({ where: { userId: u.id, provider: id } });
    expect(row.secretEnc).not.toContain("gsk_secret");

    const project = await createProject(u.id, { name: "Custom" });
    const main = await resolveTextAI(u.id, project, { needsTools: true });
    expect([main.providerId, main.model]).toEqual(["custom:groq", "llama-3.3-70b-versatile"]);
    expect((await resolveTextAI(u.id, project, { role: "reasoning" })).model).toBe("qwen/qwen3-32b");
    expect(textCost(main, main.model, 1_000_000, 1_000_000)).toBeCloseTo(1.38);
    // no vision capability → no vision provider available
    await expect(resolveTextAI(u.id, project, { role: "vision" })).rejects.toThrow();

    // a second save with the same name gets a unique id; editing without a key keeps the old key
    const id2 = await saveCustomProvider(u.id, { name: "Groq", baseUrl: "https://api.groq.com/openai/v1", capabilities: ["text"] });
    expect(id2).toBe("custom:groq-2");
    await saveCustomProvider(u.id, { name: "Groq", baseUrl: "https://api.groq.com/openai/v1", capabilities: ["text", "tools"], defaultModels: { text: "x" } }, id);
    expect((await listCustomProviders(u.id)).find((c) => c.id === id)?.hasKey).toBe(true);
  });

  it("skips providers lacking tool calling for agents and uses image-capable ones for images", async () => {
    const u = await user();
    await saveCustomProvider(u.id, { name: "Local", baseUrl: "http://localhost:11434/v1", capabilities: ["text"], defaultModels: { text: "llama3.2" } });
    await expect(resolveTextAI(u.id, null, { needsTools: true })).rejects.toThrow(/Agents need/);
    expect((await resolveTextAI(u.id, null)).providerId).toBe("custom:local");
    await saveCustomProvider(u.id, { name: "Together", baseUrl: "https://api.together.xyz/v1", apiKey: "tgp_v1_key_abc", capabilities: ["image"], models: [{ id: "black-forest-labs/FLUX.1-schnell", kind: "image" }], pricing: { perImage: 0.003 } });
    const img = await resolveImageAI(u.id, null);
    expect([img.providerId, img.model, img.unitPrice]).toEqual(["custom:together", "black-forest-labs/FLUX.1-schnell", 0.003]);
  });

  it("blocks cloud metadata and credential-in-URL endpoints", async () => {
    const u = await user();
    await expect(saveCustomProvider(u.id, { name: "Bad", baseUrl: "http://169.254.169.254/latest", capabilities: ["text"] })).rejects.toThrow(/metadata|Blocked/);
    await expect(saveCustomProvider(u.id, { name: "Bad2", baseUrl: "https://user:pass@api.example.com/v1", capabilities: ["text"] })).rejects.toThrow(/key field/);
    await expect(saveCustomProvider(u.id, { name: "Bad3", baseUrl: "http://api.groq.com/openai/v1", capabilities: ["text"] })).rejects.toThrow(/https/);
  });
});
