import type { FastifyInstance } from "fastify";
import pg from "pg";
import { prisma } from "@socialpilot/db";
import { config, createLogger } from "@socialpilot/core";
import { EVENTS_CHANNEL, type AppEvent } from "@socialpilot/engine";

const log = createLogger("events");

type Subscriber = { userId: string; projectIds: Set<string>; send: (e: AppEvent) => void };
const subscribers = new Set<Subscriber>();
let listener: pg.Client | null = null;

/** One LISTEN connection per API process fans Postgres NOTIFY events out to SSE clients (filtered by ownership). */
export async function startEventListener() {
  const connect = async () => {
    const client = new pg.Client({ connectionString: config.DATABASE_URL });
    client.on("error", (e) => {
      log.warn(`listener error: ${e.message}; reconnecting`);
      listener = null;
      setTimeout(() => void connect().catch(() => {}), 2000);
    });
    await client.connect();
    await client.query(`LISTEN ${EVENTS_CHANNEL}`);
    client.on("notification", (msg) => {
      if (!msg.payload) return;
      let event: AppEvent;
      try {
        event = JSON.parse(msg.payload);
      } catch {
        return;
      }
      for (const s of subscribers) {
        if (event.projectId && !s.projectIds.has(event.projectId)) continue;
        if (event.userId && event.userId !== s.userId) continue;
        if (!event.projectId && !event.userId && event.type !== "discover.updated" && event.type !== "intel.updated") continue;
        s.send(event);
      }
    });
    listener = client;
  };
  await connect();
}

export async function stopEventListener() {
  await listener?.end().catch(() => {});
}

export default async function eventRoutes(app: FastifyInstance) {
  app.get("/events", { preHandler: app.requireAuth }, async (req, reply) => {
    const user = req.user!;
    const projects = await prisma.project.findMany({ where: { ownerId: user.id }, select: { id: true } });
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    res.write(`retry: 3000\n\n`);
    const sub: Subscriber = {
      userId: user.id,
      projectIds: new Set(projects.map((p) => p.id)),
      send: (e) => res.write(`event: message\ndata: ${JSON.stringify(e)}\n\n`),
    };
    subscribers.add(sub);
    // Refresh project membership periodically so new projects receive events.
    const refresh = setInterval(async () => {
      const ps = await prisma.project.findMany({ where: { ownerId: user.id }, select: { id: true } }).catch(() => null);
      if (ps) sub.projectIds = new Set(ps.map((p) => p.id));
    }, 30_000);
    const ping = setInterval(() => res.write(`: ping\n\n`), 25_000);
    req.raw.on("close", () => {
      clearInterval(ping);
      clearInterval(refresh);
      subscribers.delete(sub);
    });
  });
}
