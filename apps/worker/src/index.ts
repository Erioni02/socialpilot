import { createLogger, requireSecrets } from "@socialpilot/core";
import { prisma, seedDiscoverSources } from "@socialpilot/db";
import { JOB_HANDLERS, schedulerTick, startWorker } from "@socialpilot/engine";

/**
 * Background worker: executes durable jobs (publishing, syncs, agents, media, audits, automations) and runs the
 * scheduler loop. Run it on an always-on server so autopilot continues while you are offline.
 */
const log = createLogger("worker");
requireSecrets();
await seedDiscoverSources(prisma);

const worker = startWorker(JOB_HANDLERS);
await schedulerTick();
const timer = setInterval(() => void schedulerTick(), 30_000);
log.info("scheduler running every 30s");

const shutdown = async () => {
  log.info("shutting down — finishing active jobs");
  clearInterval(timer);
  await worker.stop();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
