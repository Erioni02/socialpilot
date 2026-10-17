import PgBoss from "pg-boss";

/**
 * Persistent job queue on Postgres (pg-boss) — replaces Redis/BullMQ.
 * Job state lives in the `pgboss` schema; our Task rows remain the source of truth for the UI.
 */
export const TOOLS_QUEUE = "tools";
export const MAX_ATTEMPTS = 3;

let boss: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  starting ??= (async () => {
    const instance = new PgBoss({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, application_name: "socialpilot" });
    instance.on("error", (error) => console.error(`[queue] ${error.message}`));
    await instance.start();
    await instance.createQueue(TOOLS_QUEUE, { name: TOOLS_QUEUE, retryLimit: MAX_ATTEMPTS - 1, retryDelay: 5, retryBackoff: true });
    boss = instance;
    return instance;
  })().finally(() => {
    starting = null;
  });
  return starting;
}

/** One job per task: the task id is the singleton key, so double-enqueueing is harmless. */
export async function sendToolJob(taskId: string): Promise<void> {
  const instance = await getBoss();
  await instance.send(TOOLS_QUEUE, { taskId }, { singletonKey: taskId, retryLimit: MAX_ATTEMPTS - 1, retryDelay: 5, retryBackoff: true });
}

/** Task ids that currently have a job waiting or running. */
export async function activeJobTaskIds(): Promise<Set<string>> {
  const instance = await getBoss();
  const db = instance.getDb();
  const result = (await db.executeSql(`SELECT data->>'taskId' AS "taskId" FROM pgboss.job WHERE name = $1 AND state IN ('created','retry','active')`, [TOOLS_QUEUE])) as {
    rows: { taskId: string }[];
  };
  return new Set(result.rows.map((r) => r.taskId));
}

export async function stopBoss(): Promise<void> {
  const instance = boss;
  boss = null;
  await instance?.stop({ graceful: true, timeout: 10_000 });
}
