import { sealJson } from "@sp/crypto";
import { prisma } from "@sp/db";
import { resetDatabase } from "@sp/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { executeTool, runTask, setEnqueuer } from "../execute";
import { clearRegistry } from "../registry";
import { loadProviders, registerCycle1Tools, setToolDeps } from "./index";

const chat = vi.fn();
let ws: { id: string };
let project: { id: string };
const user = { type: "user" as const, id: "u" };
const scope = () => ({ workspaceId: ws.id, projectId: project.id, actor: user });

beforeAll(() => {
  setEnqueuer(async () => {});
  clearRegistry();
  registerCycle1Tools();
});
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase();
  chat.mockReset();
  setToolDeps({ chat, loadProviders: async () => [{ name: "nvidia", baseUrl: "https://nv.test", keys: ["k"], models: ["m"] }] });
  const owner = await prisma.user.create({ data: { email: "o@test.dev", passwordHash: "x" } });
  ws = await prisma.workspace.create({ data: { name: "w", ownerId: owner.id } });
  project = await prisma.project.create({ data: { workspaceId: ws.id, name: "VibeJudge", slug: "vibejudge", websiteUrl: "https://vibejudge.app" } });
});

describe("brand.updateProfile", () => {
  it("creates a new version on every save and leaves old versions untouched", async () => {
    await executeTool(scope(), "brand.updateProfile", { description: "First", productsServices: ["CV roast"] });
    await executeTool(scope(), "brand.updateProfile", { description: "Second", confirm: true });
    const versions = await prisma.brandProfile.findMany({ where: { projectId: project.id }, orderBy: { version: "asc" } });
    expect(versions.map((v) => [v.version, v.description, v.source])).toEqual([
      [1, "First", "user_edit"],
      [2, "Second", "user_edit"]
    ]);
    expect(versions[0]!.confirmedAt).toBeNull();
    expect(versions[1]!.confirmedAt).not.toBeNull();
  });

  it("rejects oversized fields", async () => {
    await expect(executeTool(scope(), "brand.updateProfile", { industry: "x".repeat(500) })).rejects.toThrow(/industry/);
  });
});

describe("project.summary", () => {
  it("returns five bullets from the profile and website issues", async () => {
    await executeTool(scope(), "brand.updateProfile", { description: "AI roasts", industry: "Career tools" });
    await prisma.websiteSnapshot.create({
      data: { projectId: project.id, rootUrl: "https://vibejudge.app/", httpStatus: 200, responseMs: 100, pages: [], issues: [{ code: "missing_og", severity: "low", url: "/", evidence: "", recommendation: "" }] }
    });
    chat.mockResolvedValue({ text: "", data: { bullets: ["a", "b", "c", "d", "e"] }, provider: "nvidia", model: "m", costUsd: 0, ms: 3 });
    const { taskId } = await executeTool(scope(), "project.summary", {});
    await runTask(taskId);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.output).toEqual({ bullets: ["a", "b", "c", "d", "e"] });
    expect(JSON.stringify(chat.mock.calls[0])).toContain("missing_og");
  });
});

describe("loadProviders", () => {
  it("decrypts enabled DB providers in order and ignores other workspaces", async () => {
    const other = await prisma.workspace.create({ data: { name: "other", ownerId: (await prisma.user.findFirstOrThrow()).id } });
    await prisma.aiProviderConfig.createMany({
      data: [
        { workspaceId: ws.id, provider: "ollama", baseUrl: "https://ollama.com", encryptedKeys: sealJson(["o-key"]), models: ["gemma"], order: 2 },
        { workspaceId: ws.id, provider: "nvidia", baseUrl: "https://nv", encryptedKeys: sealJson(["n-key"]), models: ["nemo"], order: 1 },
        { workspaceId: ws.id, provider: "nvidia", baseUrl: "https://nv", encryptedKeys: sealJson(["off"]), models: ["x"], order: 0, enabled: false },
        { workspaceId: other.id, provider: "nvidia", baseUrl: "https://nv", encryptedKeys: sealJson(["theirs"]), models: ["y"], order: 0 }
      ]
    });
    const providers = await loadProviders(ws.id, {});
    expect(providers.map((p) => [p.name, p.keys, p.models])).toEqual([
      ["nvidia", ["n-key"], ["nemo"]],
      ["ollama", ["o-key"], ["gemma"]]
    ]);
  });

  it("falls back to env providers when none are configured", async () => {
    const providers = await loadProviders(ws.id, { AI_PROVIDER_ORDER: "nvidia", NVIDIA_API_KEYS: "env-key" });
    expect(providers).toHaveLength(1);
    expect(providers[0]!.keys).toEqual(["env-key"]);
  });
});

describe("ai.testProvider", () => {
  it("is user-only", async () => {
    const config = await prisma.aiProviderConfig.create({ data: { workspaceId: ws.id, provider: "nvidia", baseUrl: "https://nv", encryptedKeys: sealJson(["k"]), models: ["m"] } });
    await expect(executeTool({ ...scope(), actor: { type: "agent", id: "a" } }, "ai.testProvider", { providerConfigId: config.id })).rejects.toMatchObject({ reason: "user_only" });
  });

  it("records the test result on the config", async () => {
    const config = await prisma.aiProviderConfig.create({ data: { workspaceId: ws.id, provider: "nvidia", baseUrl: "https://nv", encryptedKeys: sealJson(["k"]), models: ["m"] } });
    chat.mockResolvedValue({ text: "pong", provider: "nvidia", model: "m", costUsd: 0, ms: 42 });
    const result = await executeTool(scope(), "ai.testProvider", { providerConfigId: config.id });
    expect(result).toMatchObject({ status: "succeeded", output: { ok: true, model: "m", ms: 42 } });
    const updated = await prisma.aiProviderConfig.findUniqueOrThrow({ where: { id: config.id } });
    expect(updated.lastTestResult).toMatchObject({ ok: true });
  });

  it("reports a failing key without throwing", async () => {
    const config = await prisma.aiProviderConfig.create({ data: { workspaceId: ws.id, provider: "nvidia", baseUrl: "https://nv", encryptedKeys: sealJson(["k"]), models: ["m"] } });
    chat.mockRejectedValue(new Error("All AI providers failed (last: HTTP 401)"));
    const result = await executeTool(scope(), "ai.testProvider", { providerConfigId: config.id });
    expect(result).toMatchObject({ output: { ok: false, error: "All AI providers failed (last: HTTP 401)" } });
  });
});
