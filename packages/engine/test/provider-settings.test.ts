import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@socialpilot/db";
import { createProject, resolveTextAI, saveCredential, saveCustomProvider, saveProviderSettings } from "../src";

afterAll(async () => prisma.$disconnect());

describe("per-provider model & reasoning", () => {
  it("applies provider settings, keeps project overrides on top, and validates levels", async () => {
    const u = await prisma.user.create({ data: { email: `ps-${Date.now()}@example.test`, name: "PS", passwordHash: "x" } });
    await saveCredential(u.id, "nvidia", { apiKey: "nvapi-test" });
    await saveProviderSettings(u.id, "nvidia", { models: { text: "z-ai/glm-5.3", reasoning: "" }, reasoning: { text: "off", reasoning: "high" } });
    const project = await createProject(u.id, { name: "PS" });

    const main = await resolveTextAI(u.id, project);
    expect([main.model, main.reasoning]).toEqual(["z-ai/glm-5.3", "off"]);
    const think = await resolveTextAI(u.id, project, { role: "reasoning" });
    expect([think.model, think.reasoning]).toEqual(["nvidia/nemotron-3-ultra-550b-a55b", "high"]); // empty model = catalog default
    expect((await resolveTextAI(u.id, project, { role: "fast" })).reasoning).toBe("default");

    const p2 = await prisma.project.update({ where: { id: project.id }, data: { aiConfig: { textProvider: "nvidia", textModel: "moonshotai/kimi-k2.6" } } });
    const overridden = await resolveTextAI(u.id, p2);
    expect([overridden.model, overridden.reasoning]).toEqual(["moonshotai/kimi-k2.6", "off"]);

    await expect(saveProviderSettings(u.id, "anthropic", { reasoning: { text: "off" } })).rejects.toThrow(/isn't supported/);
    await expect(saveProviderSettings(u.id, "openai", { reasoning: { text: "minimal" } })).resolves.toBeTruthy();
  });

  it("works for custom providers too", async () => {
    const u = await prisma.user.create({ data: { email: `ps2-${Date.now()}@example.test`, name: "PS2", passwordHash: "x" } });
    const id = await saveCustomProvider(u.id, { name: "Local", baseUrl: "http://localhost:1234/v1", capabilities: ["text", "tools"], defaultModels: { text: "qwen3-8b" } });
    await saveProviderSettings(u.id, id, { models: { text: "qwen3-32b" }, reasoning: { text: "on" } });
    const r = await resolveTextAI(u.id, null, { needsTools: true });
    expect([r.providerId, r.model, r.reasoning]).toEqual([id, "qwen3-32b", "on"]);
  });
});
