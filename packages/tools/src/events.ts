import { prisma, type Task } from "@sp/db";
import type { ProjectEvent, TaskSummary } from "@sp/shared";
import pg from "pg";

/**
 * Live project events over Postgres LISTEN/NOTIFY (no Redis). Publishers call pg_notify through Prisma;
 * the API keeps one dedicated listening connection and fans events out to SSE clients.
 */
const CHANNEL = "sp_events";
const MAX_PAYLOAD = 7500; // Postgres NOTIFY payloads must stay under 8000 bytes

export function toTaskSummary(task: Task): TaskSummary {
  return {
    id: task.id,
    projectId: task.projectId,
    toolName: task.toolName,
    status: task.status,
    error: task.error,
    output: task.output ?? null,
    createdAt: task.createdAt.toISOString(),
    startedAt: task.startedAt?.toISOString() ?? null,
    finishedAt: task.finishedAt?.toISOString() ?? null
  };
}

export async function publishEvent(projectId: string, event: ProjectEvent): Promise<void> {
  let payload = JSON.stringify({ projectId, event });
  if (payload.length > MAX_PAYLOAD && event.type === "task.updated") {
    payload = JSON.stringify({ projectId, event: { ...event, task: { ...event.task, output: null, outputTruncated: true } } });
  }
  if (payload.length > MAX_PAYLOAD && event.type === "task.event") {
    payload = JSON.stringify({ projectId, event: { ...event, event: { ...event.event, data: null } } });
  }
  try {
    await prisma.$executeRaw`SELECT pg_notify(${CHANNEL}, ${payload})`;
  } catch (error) {
    console.warn(`[events] publish failed: ${(error as Error).message}`);
  }
}

type Listener = (event: ProjectEvent) => void;
const listeners = new Map<string, Set<Listener>>();
let client: pg.Client | null = null;
let connecting: Promise<void> | null = null;

async function ensureListening(): Promise<void> {
  if (client) return;
  connecting ??= (async () => {
    const c = new pg.Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
    c.on("notification", (msg) => {
      if (!msg.payload) return;
      try {
        const { projectId, event } = JSON.parse(msg.payload) as { projectId: string; event: ProjectEvent };
        listeners.get(projectId)?.forEach((fn) => fn(event));
      } catch {
        /* ignore malformed payloads */
      }
    });
    c.on("error", (error) => {
      console.warn(`[events] listener connection lost: ${error.message}; reconnecting`);
      client = null;
      connecting = null;
      setTimeout(() => void ensureListening().catch(() => {}), 2000);
    });
    await c.connect();
    await c.query(`LISTEN ${CHANNEL}`);
    client = c;
  })().finally(() => {
    connecting = null;
  });
  return connecting;
}

/** Subscribe to one project's events. Returns an unsubscribe function. */
export async function subscribeProject(projectId: string, listener: Listener): Promise<() => void> {
  await ensureListening();
  const set = listeners.get(projectId) ?? new Set();
  set.add(listener);
  listeners.set(projectId, set);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(projectId);
  };
}

export async function closeEvents(): Promise<void> {
  const c = client;
  client = null;
  await c?.end().catch(() => {});
}
