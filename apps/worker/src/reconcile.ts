import { prisma } from "@sp/db";
import { activeJobTaskIds, enqueueTask, MAX_ATTEMPTS, publishEvent, retryAbandonedJobs, toTaskSummary } from "@sp/tools";

type Deps = { retryAbandoned?: () => Promise<number>; activeJobs?: () => Promise<Set<string>>; enqueue?: (taskId: string) => Promise<void> };

/**
 * On worker start: tasks marked queued/running that have no live job (the process died, or the job was lost)
 * are requeued; a running task that already used all attempts is failed instead of looping forever.
 * In single-worker mode (default) jobs a dead worker left "active" are first sent back for immediate retry.
 */
export async function reconcile(deps: Deps = {}): Promise<{ retriedJobs: number; requeued: number; failed: number }> {
  const singleWorker = (process.env.WORKER_MODE ?? "single") === "single";
  const retriedJobs = deps.retryAbandoned ? await deps.retryAbandoned() : singleWorker ? await retryAbandonedJobs() : 0;
  const activeJobs = await (deps.activeJobs ?? activeJobTaskIds)();
  const enqueue = deps.enqueue ?? enqueueTask;
  const orphans = await prisma.task.findMany({ where: { status: { in: ["queued", "running"] }, id: { notIn: [...activeJobs] } } });

  let requeued = 0;
  let failed = 0;
  for (const task of orphans) {
    if (task.status === "running" && task.attempts >= MAX_ATTEMPTS) {
      const updated = await prisma.task.update({ where: { id: task.id }, data: { status: "failed", error: "Worker restarted during execution", finishedAt: new Date() } });
      await publishEvent(task.projectId, { type: "task.updated", task: toTaskSummary(updated) });
      failed++;
      continue;
    }
    if (task.status === "running") await prisma.task.update({ where: { id: task.id }, data: { status: "queued" } });
    await enqueue(task.id);
    requeued++;
  }
  return { retriedJobs, requeued, failed };
}
