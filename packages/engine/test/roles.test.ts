import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@socialpilot/db";
import { createProject, resolveImageAI, resolveTextAI, resolveVideoAI, saveCredential } from "../src";

afterAll(async () => prisma.$disconnect());

async function user() {
  return prisma.user.create({ data: { email: `roles-${Date.now()}-${Math.random()}@example.test`, name: "Roles", passwordHash: "x" } });
}

describe("model roles", () => {
  it("uses NVIDIA per-role defaults and honours project overrides", async () => {
    const u = await user();
    await saveCredential(u.id, "nvidia", { apiKey: "nvapi-test" });
    const project = await createProject(u.id, { name: "Roles" });
    expect((await resolveTextAI(u.id, project, { needsTools: true })).model).toBe("moonshotai/kimi-k2.6");
    expect((await resolveTextAI(u.id, project, { role: "reasoning" })).model).toBe("nvidia/nemotron-3-ultra-550b-a55b");
    expect((await resolveTextAI(u.id, project, { role: "vision" })).model).toBe("nvidia/nemotron-3.5-super-vl-120b-a12b");
    expect((await resolveTextAI(u.id, project, { role: "fast" })).model).toBe("z-ai/glm-5.3-flash");
    const p2 = await prisma.project.update({ where: { id: project.id }, data: { aiConfig: { textProvider: "nvidia", textModel: "z-ai/glm-5.3", visionProvider: "nvidia", visionModel: "nvidia/cosmos-reason2-8b" } } });
    expect((await resolveTextAI(u.id, p2)).model).toBe("z-ai/glm-5.3");
    expect((await resolveTextAI(u.id, p2, { role: "vision" })).model).toBe("nvidia/cosmos-reason2-8b");
    expect((await resolveTextAI(u.id, p2, { role: "reasoning" })).model).toBe("nvidia/nemotron-3-ultra-550b-a55b");
  });

  it("routes images (Seedream) and video (Seedance) to ByteDance with one BytePlus key", async () => {
    const u = await user();
    await saveCredential(u.id, "byteplus", { apiKey: "ark-key" });
    const img = await resolveImageAI(u.id, null);
    expect([img.providerId, img.model]).toEqual(["byteplus", "seedream-4-0-250828"]);
    const edit = await resolveImageAI(u.id, null, undefined, "edit");
    expect(edit.providerId).toBe("byteplus");
    await expect(resolveImageAI(u.id, null, undefined, "remove_background")).rejects.toThrow(/Replicate or Stability/);
    const vid = await resolveVideoAI(u.id, null);
    expect([vid.providerId, vid.model]).toEqual(["byteplus", "seedance-1-0-pro-fast-251015"]);
  });
});
