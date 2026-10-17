import { prisma } from "@sp/db";
import { executeTool, publishEvent, toTaskSummary } from "@sp/tools";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { authOf } from "../auth/guard";
import { HttpError, notFound } from "../errors";
import { ProjectParams, projectScope } from "./scope";

/** Tools the dashboard may trigger directly. Everything else has a dedicated route (or is agent-only). */
const QUICK_ACTION_TOOLS = new Set(["brand.draftProfile", "project.summary"]);

async function scopedTask(request: Parameters<typeof authOf>[0], id: string) {
  const { workspaceId } = authOf(request);
  const task = await prisma.task.findFirst({ where: { id, project: { workspaceId } } });
  if (!task) throw notFound("Task not found");
  return task;
}

export const taskRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post("/projects/:id/analyze", { schema: { tags: ["tasks"], params: ProjectParams } }, async (request) => {
    const { scope, actor } = await projectScope(request);
    // One analysis at a time per project: the advisory lock serializes concurrent clicks.
    return prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`analyze:${scope.projectId}`}))`;
        const running = await prisma.task.findFirst({ where: { projectId: scope.projectId, toolName: "website.analyze", status: { in: ["queued", "running"] } } });
        if (running) return { taskId: running.id, status: running.status, existing: true };
        const result = await executeTool({ ...scope, actor }, "website.analyze", {});
        return { taskId: result.taskId, status: result.status, existing: false };
      },
      { timeout: 15_000 }
    );
  });

  app.post(
    "/projects/:id/tools/:name",
    { schema: { tags: ["tasks"], params: ProjectParams.extend({ name: z.string() }), body: z.record(z.unknown()).optional() } },
    async (request) => {
      const { name } = request.params;
      if (!QUICK_ACTION_TOOLS.has(name)) throw notFound(`No quick action "${name}"`);
      const { scope, actor } = await projectScope(request);
      return executeTool({ ...scope, actor }, name, request.body ?? {});
    }
  );

  app.get(
    "/projects/:id/tasks",
    { schema: { tags: ["tasks"], params: ProjectParams, querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }) } },
    async (request) => {
      const { project } = await projectScope(request);
      const tasks = await prisma.task.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, take: request.query.limit });
      return tasks.map(toTaskSummary);
    }
  );

  app.get("/tasks/:id", { schema: { tags: ["tasks"], params: z.object({ id: z.string() }) } }, async (request) => {
    const task = await scopedTask(request, request.params.id);
    const events = await prisma.taskEvent.findMany({ where: { taskId: task.id }, orderBy: { at: "asc" }, take: 500 });
    return {
      task: toTaskSummary(task),
      events: events.map((e) => ({ id: e.id, at: e.at.toISOString(), level: e.level, message: e.message, data: e.data ?? null }))
    };
  });

  app.post("/tasks/:id/cancel", { schema: { tags: ["tasks"], params: z.object({ id: z.string() }) } }, async (request) => {
    const task = await scopedTask(request, request.params.id);
    if (!["queued", "running", "awaiting_approval"].includes(task.status)) throw new HttpError(409, "not_cancellable", `The task is already ${task.status}.`);
    const updated = await prisma.task.update({ where: { id: task.id }, data: { status: "cancelled", finishedAt: new Date() } });
    await prisma.approval.updateMany({ where: { taskId: task.id, status: "pending" }, data: { status: "expired", decidedAt: new Date() } });
    await publishEvent(task.projectId, { type: "task.updated", task: toTaskSummary(updated) });
    return toTaskSummary(updated);
  });
};
