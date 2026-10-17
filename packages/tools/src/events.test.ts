import { afterAll, describe, expect, it } from "vitest";
import { closeEvents, publishEvent, subscribeProject } from "./events";
import { activeJobTaskIds, getBoss, retryAbandonedJobs, sendToolJob, stopBoss, TOOLS_QUEUE } from "./queue";

afterAll(async () => {
  await closeEvents();
  await stopBoss();
});

describe("project events over LISTEN/NOTIFY", () => {
  it("delivers a published event only to that project's subscribers", async () => {
    const received: unknown[] = [];
    const other: unknown[] = [];
    const off = await subscribeProject("p1", (e) => received.push(e));
    const offOther = await subscribeProject("p2", (e) => other.push(e));
    await publishEvent("p1", { type: "approval.created", approvalId: "a1", taskId: "t1" });
    await new Promise((r) => setTimeout(r, 300));
    off();
    offOther();
    expect(received).toEqual([{ type: "approval.created", approvalId: "a1", taskId: "t1" }]);
    expect(other).toEqual([]);
  });
});

describe("pg-boss queue", () => {
  it("stores one job per task id", async () => {
    await sendToolJob("task-abc");
    await sendToolJob("task-abc");
    expect((await activeJobTaskIds()).has("task-abc")).toBe(true);
  }, 30_000);

  it("sends jobs left active by a dead worker back for retry", async () => {
    const boss = await getBoss();
    await boss.getDb().executeSql("DELETE FROM pgboss.job WHERE name = $1", [TOOLS_QUEUE]);
    await sendToolJob("task-abandoned");
    const [job] = await boss.fetch<{ taskId: string }>(TOOLS_QUEUE); // now 'active', and nobody will finish it
    expect(job).toBeTruthy();
    const retried = await retryAbandonedJobs();
    expect(retried).toBeGreaterThanOrEqual(1);
    const state = await boss.getJobById(TOOLS_QUEUE, job!.id);
    expect(state?.state).toBe("retry");
  }, 30_000);
});
