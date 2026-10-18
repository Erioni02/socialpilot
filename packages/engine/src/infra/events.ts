import { prisma } from "@socialpilot/db";

export const EVENTS_CHANNEL = "socialpilot_events";

export interface AppEvent {
  type: string;
  userId?: string | null;
  projectId?: string | null;
  data?: Record<string, unknown>;
  at?: string;
}

/**
 * Publishes a small event via Postgres NOTIFY so every API instance (and its SSE clients) sees it,
 * regardless of which process (API or worker) produced it. Payloads must stay small (<8KB): ids + status only.
 */
export async function emit(event: AppEvent): Promise<void> {
  const payload = JSON.stringify({ ...event, at: new Date().toISOString() });
  if (payload.length > 7500) throw new Error("Event payload too large");
  try {
    await prisma.$executeRaw`SELECT pg_notify(${EVENTS_CHANNEL}, ${payload})`;
  } catch {
    /* events are best-effort */
  }
}
