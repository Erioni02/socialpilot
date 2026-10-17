import { subscribeProject } from "@sp/tools";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { ProjectParams, projectScope } from "./scope";

const HEARTBEAT_MS = 20_000;

/** Server-Sent Events: live task progress, task status changes and new approvals for one project. */
export const eventRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/projects/:id/events", { schema: { tags: ["events"], params: ProjectParams } }, async (request, reply) => {
    const { project } = await projectScope(request);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    res.write("retry: 3000\n\n");

    const unsubscribe = await subscribeProject(project.id, (event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
};
