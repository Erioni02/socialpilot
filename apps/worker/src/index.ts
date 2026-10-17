import "./env";
import { prisma } from "@sp/db";
import { closeEvents, getBoss, registerCycle1Tools, runTask, stopBoss, TOOLS_QUEUE } from "@sp/tools";
import { reconcile } from "./reconcile";

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 4);

/**
 * Background worker: a plain Node process (no Docker/Redis). Pulls tool jobs from the Postgres-backed
 * pg-boss queue and runs them through runTask(), which re-checks the emergency stop and permissions.
 */
async function main() {
  registerCycle1Tools();
  const boss = await getBoss();

  const { requeued, failed } = await reconcile();
  if (requeued || failed) console.log(`[worker] reconciled: ${requeued} requeued, ${failed} failed`);

  for (let i = 0; i < CONCURRENCY; i++) {
    await boss.work<{ taskId: string }>(TOOLS_QUEUE, { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: 1 }, async ([job]) => {
      if (!job) return;
      await runTask(job.data.taskId, { attempt: job.retryCount + 1 });
    });
  }
  console.log(`[worker] ready (queue=${TOOLS_QUEUE}, concurrency=${CONCURRENCY})`);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal}: finishing running jobs…`);
    await stopBoss();
    await closeEvents();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: Error) => {
  console.error(`[worker] failed to start: ${error.message}`);
  process.exit(1);
});
