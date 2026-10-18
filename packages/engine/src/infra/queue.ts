import { hostname } from "node:os";
import { prisma, Prisma, type Job } from "@socialpilot/db";
import { AppError, config, createLogger, ProviderError, redactString } from "@socialpilot/core";
import { emit } from "./events";

const log = createLogger("queue");
const BULL_QUEUE = "socialpilot-jobs";

export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentError";
  }
}

export interface EnqueueOptions {
  runAt?: Date;
  dedupeKey?: string;
  maxAttempts?: number;
  projectId?: string | null;
}

export interface JobContext {
  jobId: string;
  attempt: number;
  maxAttempts: number;
}
export type JobHandler = (payload: any, ctx: JobContext) => Promise<unknown>;

let bullQueue: any = null;
async function getBullQueue() {
  if (!config.REDIS_URL) return null;
  if (!bullQueue) {
    const { Queue } = await import("bullmq");
    const { default: IORedis } = await import("ioredis");
    const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
    bullQueue = new Queue(BULL_QUEUE, { connection });
  }
  return bullQueue;
}

async function dispatch(job: Pick<Job, "id" | "runAt">) {
  const q = await getBullQueue();
  if (!q) return; // Postgres driver: workers poll the table.
  const delay = Math.max(0, job.runAt.getTime() - Date.now());
  await q.add("run", { jobId: job.id }, { jobId: `${job.id}-${job.runAt.getTime()}`, delay, removeOnComplete: 1000, removeOnFail: 1000, attempts: 1 });
}

/** Durable enqueue: the Job row is written first, so nothing is lost if Redis or the worker restarts. */
export async function enqueue(name: string, payload: Record<string, unknown>, opts: EnqueueOptions = {}): Promise<Job> {
  let job: Job;
  if (opts.dedupeKey) {
    const existing = await prisma.job.findUnique({ where: { dedupeKey: opts.dedupeKey } });
    if (existing) return existing;
  }
  try {
    job = await prisma.job.create({
      data: {
        name,
        payload: payload as Prisma.InputJsonValue,
        runAt: opts.runAt ?? new Date(),
        maxAttempts: opts.maxAttempts ?? 3,
        dedupeKey: opts.dedupeKey,
        projectId: opts.projectId ?? (payload.projectId as string | undefined) ?? null,
      },
    });
  } catch (err) {
    if (opts.dedupeKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return prisma.job.findUniqueOrThrow({ where: { dedupeKey: opts.dedupeKey } });
    }
    throw err;
  }
  await dispatch(job);
  return job;
}

export async function cancelJob(id: string) {
  await prisma.job.updateMany({ where: { id, status: "waiting" }, data: { status: "cancelled", finishedAt: new Date() } });
}

function isRetryable(err: unknown): boolean {
  if (err instanceof PermanentError) return false;
  if (err instanceof AppError) return false; // includes SetupRequiredError
  if (err instanceof ProviderError) return err.retryable;
  return true;
}

export interface WorkerHandle {
  stop(): Promise<void>;
}

export function startWorker(handlers: Record<string, JobHandler>, opts: { concurrency?: number } = {}): WorkerHandle {
  const workerId = `${hostname()}:${process.pid}`;
  const concurrency = opts.concurrency ?? config.WORKER_CONCURRENCY;
  let stopped = false;
  let active = 0;

  async function execute(job: Job) {
    active++;
    const handler = handlers[job.name];
    const ctx: JobContext = { jobId: job.id, attempt: job.attempts, maxAttempts: job.maxAttempts };
    try {
      if (!handler) throw new PermanentError(`No handler registered for job "${job.name}"`);
      const result = await handler(job.payload, ctx);
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "completed", result: (result ?? null) as Prisma.InputJsonValue, finishedAt: new Date(), lockedAt: null, lastError: null },
      });
      if (job.projectId) await emit({ type: "job.completed", projectId: job.projectId, data: { id: job.id, name: job.name } });
    } catch (err) {
      const message = redactString((err as Error).message ?? String(err)).slice(0, 2000);
      const retry = isRetryable(err) && job.attempts < job.maxAttempts;
      log.warn(`job ${job.name} ${job.id} failed (attempt ${job.attempts}/${job.maxAttempts})${retry ? ", will retry" : ""}: ${message}`);
      const runAt = new Date(Date.now() + Math.min(30 * 60_000, 15_000 * 2 ** (job.attempts - 1)));
      const updated = await prisma.job.update({
        where: { id: job.id },
        data: retry ? { status: "waiting", runAt, lastError: message, lockedAt: null } : { status: "failed", lastError: message, finishedAt: new Date(), lockedAt: null },
      });
      if (retry) await dispatch(updated);
      if (job.projectId) await emit({ type: retry ? "job.retrying" : "job.failed", projectId: job.projectId, data: { id: job.id, name: job.name, error: message.slice(0, 300) } });
    } finally {
      active--;
    }
  }

  async function claimNext(): Promise<Job | null> {
    const rows = await prisma.$queryRaw<Job[]>`
      UPDATE "Job" SET status = 'active', "lockedAt" = now(), "lockedBy" = ${workerId}, attempts = attempts + 1, "updatedAt" = now()
      WHERE id = (
        SELECT id FROM "Job" WHERE status = 'waiting' AND "runAt" <= now()
        ORDER BY "runAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED
      ) RETURNING *`;
    return rows[0] ?? null;
  }

  async function claimById(id: string): Promise<Job | null> {
    const rows = await prisma.$queryRaw<Job[]>`
      UPDATE "Job" SET status = 'active', "lockedAt" = now(), "lockedBy" = ${workerId}, attempts = attempts + 1, "updatedAt" = now()
      WHERE id = ${id} AND status = 'waiting' AND "runAt" <= now() + interval '5 seconds' RETURNING *`;
    return rows[0] ?? null;
  }

  /** Re-queues jobs whose worker died mid-run, and (with Redis) re-dispatches overdue jobs that Redis lost. */
  async function recover() {
    const stale = await prisma.job.updateMany({
      where: { status: "active", lockedAt: { lt: new Date(Date.now() - 20 * 60_000) } },
      data: { status: "waiting", lockedAt: null, lastError: "Recovered after worker interruption" },
    });
    if (stale.count) log.warn(`recovered ${stale.count} interrupted job(s)`);
    if (config.REDIS_URL) {
      const overdue = await prisma.job.findMany({ where: { status: "waiting", runAt: { lt: new Date(Date.now() - 60_000) } }, take: 200 });
      for (const j of overdue) await dispatch(j);
    }
  }

  let bullWorker: any = null;
  let recoverTimer: NodeJS.Timeout | null = null;
  let pollTimer: NodeJS.Timeout | null = null;

  (async () => {
    await recover().catch((e) => log.error("recover failed", { error: String(e) }));
    recoverTimer = setInterval(() => recover().catch(() => {}), 60_000);
    if (config.REDIS_URL) {
      const { Worker } = await import("bullmq");
      const { default: IORedis } = await import("ioredis");
      const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
      bullWorker = new Worker(
        BULL_QUEUE,
        async (bj: any) => {
          const job = await claimById(bj.data.jobId);
          if (job) await execute(job);
        },
        { connection, concurrency },
      );
      log.info(`worker ${workerId} started (BullMQ/Redis dispatch, concurrency ${concurrency})`);
    } else {
      log.info(`worker ${workerId} started (Postgres queue, concurrency ${concurrency})`);
      const tick = async () => {
        if (stopped) return;
        try {
          while (active < concurrency) {
            const job = await claimNext();
            if (!job) break;
            void execute(job);
          }
        } catch (e) {
          log.error("poll failed", { error: String(e) });
        }
        pollTimer = setTimeout(tick, 1000);
      };
      void tick();
    }
  })();

  return {
    async stop() {
      stopped = true;
      if (recoverTimer) clearInterval(recoverTimer);
      if (pollTimer) clearTimeout(pollTimer);
      if (bullWorker) await bullWorker.close();
      const deadline = Date.now() + 15000;
      while (active > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    },
  };
}

/** Waits for a job to finish (used by agents that need a synchronous result, e.g. a website audit). */
export async function waitForJob(id: string, timeoutMs = 5 * 60_000): Promise<Job> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await prisma.job.findUniqueOrThrow({ where: { id } });
    if (["completed", "failed", "cancelled"].includes(job.status)) return job;
    if (Date.now() > deadline) throw new Error(`Job ${id} did not finish in time`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}
