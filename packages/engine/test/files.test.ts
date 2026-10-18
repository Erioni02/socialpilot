import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@socialpilot/db";
import { createProject, executeTool, listFiles, readFile, trashFile, writeFile } from "../src";

afterAll(async () => prisma.$disconnect());

describe("AI workspace files", () => {
  it("writes, versions, appends, lists and trashes files; rejects traversal", async () => {
    const u = await prisma.user.create({ data: { email: `files-${Date.now()}@example.test`, name: "Files", passwordHash: "x" } });
    const project = await createProject(u.id, { name: "Files" });
    const a = await writeFile(project, "plan.md", "# Plan\n", "agent:general");
    expect(a.path).toBe("/workspace/plan.md");
    await writeFile(project, "/workspace/plan.md", "- step 1\n", "agent:general", "append");
    const r = await readFile(project.id, "plan.md");
    expect(r.content).toBe("# Plan\n- step 1\n");
    expect(r.version).toBe(2);
    await writeFile(project, "drafts/x.html", "<script>alert(1)</script>", "user");
    const html = await prisma.assetVersion.findFirstOrThrow({ where: { asset: { projectId: project.id, name: "x.html" } } });
    expect(html.mimeType).toBe("text/plain"); // never served as executable HTML
    expect((await listFiles(project.id)).map((f) => f.path).sort()).toEqual(["/workspace/drafts/x.html", "/workspace/plan.md"]);
    await trashFile(project.id, "drafts/x.html");
    expect((await listFiles(project.id)).map((f) => f.path)).toEqual(["/workspace/plan.md"]);
    await expect(writeFile(project, "../../etc/passwd", "x", "user")).rejects.toThrow(/Invalid/);
  });

  it("lets an agent schedule a delayed follow-up task within limits", async () => {
    const u = await prisma.user.create({ data: { email: `follow-${Date.now()}@example.test`, name: "Follow", passwordHash: "x" } });
    const project = await createProject(u.id, { name: "Follow" });
    const task = await prisma.task.create({ data: { projectId: project.id, title: "t", instruction: "x" } });
    const ctx = { project, task, actor: { kind: "agent" as const, agentType: "general", taskId: task.id }, userId: u.id };
    const r = await executeTool("schedule_followup_task", { instruction: "Check post performance and adjust the plan", runInHours: 24 }, ctx);
    expect(r.ok).toBe(true);
    const followup = await prisma.task.findUniqueOrThrow({ where: { id: (r.output as any).taskId } });
    expect((followup.input as any).autonomous).toBe(true);
    const job = await prisma.job.findFirstOrThrow({ where: { name: "agent.run", payload: { path: ["taskId"], equals: followup.id } } });
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
  });
});
