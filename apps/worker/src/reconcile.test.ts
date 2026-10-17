import { prisma } from "@sp/db";
import { resetDatabase } from "@sp/db/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { reconcile } from "./reconcile";

let projectId = "";
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await resetDatabase();
  const owner = await prisma.user.create({ data: { email: "o@test.dev", passwordHash: "x" } });
  const ws = await prisma.workspace.create({ data: { name: "w", ownerId: owner.id } });
  projectId = (await prisma.project.create({ data: { workspaceId: ws.id, name: "P", slug: "p" } })).id;
});

const task = (status: "running" | "queued" | "awaiting_approval" | "succeeded", attempts: number) =>
  prisma.task.create({ data: { projectId, type: "website.read", toolName: "website.analyze", status, attempts, input: {}, requestedBy: "user", actorId: "u" } });

describe("reconcile", () => {
  it("requeues orphaned tasks and fails ones that used up their attempts", async () => {
    const a = await task("running", 1);
    const b = await task("running", 3);
    const c = await task("queued", 0);
    const d = await task("awaiting_approval", 0);
    const e = await task("succeeded", 1);
    const withJob = await task("queued", 0);
    const enqueued: string[] = [];

    const order: string[] = [];
    const result = await reconcile({
      retryAbandoned: async () => {
        order.push("retryAbandoned");
        return 0;
      },
      activeJobs: async () => {
        order.push("activeJobs");
        return new Set([withJob.id]);
      },
      enqueue: async (id) => void enqueued.push(id)
    });

    expect(order).toEqual(["retryAbandoned", "activeJobs"]);
    expect(result).toEqual({ retriedJobs: 0, requeued: 2, failed: 1 });
    expect(enqueued.sort()).toEqual([a.id, c.id].sort());
    const byId = async (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
    expect((await byId(a.id)).status).toBe("queued");
    expect(await byId(b.id)).toMatchObject({ status: "failed", error: "Worker restarted during execution" });
    expect((await byId(d.id)).status).toBe("awaiting_approval");
    expect((await byId(e.id)).status).toBe("succeeded");
    expect((await byId(withJob.id)).status).toBe("queued");
  });
});
