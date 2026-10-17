import { prisma } from "@sp/db";
import { CAPABILITIES, PermissionModeSchema, PolicySchema } from "@sp/shared";
import { enqueueTask, loadPolicy, publishEvent, toTaskSummary } from "@sp/tools";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { authOf } from "../auth/guard";
import { badRequest, HttpError, notFound } from "../errors";
import { ProjectParams, projectScope } from "./scope";

const PolicyUpdate = z.object({
  autonomyLevel: PolicySchema.shape.autonomyLevel.optional(),
  permissions: z.record(z.enum(CAPABILITIES), PermissionModeSchema).optional(),
  budget: PolicySchema.shape.budget.optional(),
  limits: PolicySchema.shape.limits.optional(),
  emergencyStop: z.boolean().optional(),
  confirmName: z.string().optional()
});

/** Policy, approvals, audit and the emergency stop: user-only routes. No tool can change these. */
export const governanceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/projects/:id/policy", { schema: { tags: ["policy"], params: ProjectParams } }, async (request) => {
    const { project } = await projectScope(request);
    return loadPolicy(project.id);
  });

  app.put("/projects/:id/policy", { schema: { tags: ["policy"], params: ProjectParams, body: PolicyUpdate } }, async (request) => {
    const { project, auth } = await projectScope(request);
    const { confirmName, ...changes } = request.body;
    const current = await loadPolicy(project.id);
    if (changes.autonomyLevel && changes.autonomyLevel > current.autonomyLevel && confirmName?.trim() !== project.name) {
      throw badRequest("confirm_name_mismatch", `Type the project name "${project.name}" to raise the autonomy level.`);
    }
    const next = PolicySchema.parse({
      ...current,
      ...changes,
      permissions: { ...current.permissions, ...changes.permissions }
    });
    await prisma.projectPolicy.upsert({
      where: { projectId: project.id },
      create: { projectId: project.id, ...next },
      update: next
    });
    await prisma.auditLog.create({
      data: { workspaceId: auth.workspaceId, projectId: project.id, actorType: "user", actorId: auth.userId, action: "policy.update", argsRedacted: changes, outcome: "succeeded" }
    });
    return next;
  });

  app.get(
    "/projects/:id/approvals",
    { schema: { tags: ["approvals"], params: ProjectParams, querystring: z.object({ status: z.enum(["pending", "approved", "rejected", "expired", "all"]).default("pending") }) } },
    async (request) => {
      const { project } = await projectScope(request);
      const rows = await prisma.approval.findMany({
        where: { projectId: project.id, ...(request.query.status === "all" ? {} : { status: request.query.status }) },
        orderBy: { createdAt: "desc" },
        take: 100
      });
      return rows.map((a) => ({ id: a.id, taskId: a.taskId, toolName: a.toolName, payload: a.payload, reason: a.reason, status: a.status, createdAt: a.createdAt.toISOString(), decidedAt: a.decidedAt?.toISOString() ?? null }));
    }
  );

  const decide = (decision: "approved" | "rejected") => async (request: { params: { id: string } } & Parameters<typeof authOf>[0]) => {
    const auth = authOf(request);
    const approval = await prisma.approval.findFirst({ where: { id: request.params.id, project: { workspaceId: auth.workspaceId } } });
    if (!approval) throw notFound("Approval not found");
    if (approval.status !== "pending") throw new HttpError(409, "already_decided", `This approval was already ${approval.status}.`);
    await prisma.approval.update({ where: { id: approval.id }, data: { status: decision, decidedBy: auth.userId, decidedAt: new Date() } });
    const task = await prisma.task.update({
      where: { id: approval.taskId },
      data: decision === "approved" ? { status: "queued" } : { status: "cancelled", finishedAt: new Date(), error: "Rejected by the owner" }
    });
    if (decision === "approved") await enqueueTask(task.id);
    await prisma.auditLog.create({
      data: { workspaceId: auth.workspaceId, projectId: approval.projectId, actorType: "user", actorId: auth.userId, action: `approval.${decision}`, argsRedacted: { approvalId: approval.id, tool: approval.toolName }, outcome: "succeeded" }
    });
    await publishEvent(task.projectId, { type: "task.updated", task: toTaskSummary(task) });
    return { ok: true, taskStatus: task.status };
  };

  app.post("/approvals/:id/approve", { schema: { tags: ["approvals"], params: z.object({ id: z.string() }) } }, decide("approved"));
  app.post("/approvals/:id/reject", { schema: { tags: ["approvals"], params: z.object({ id: z.string() }) } }, decide("rejected"));

  app.get(
    "/projects/:id/audit",
    { schema: { tags: ["audit"], params: ProjectParams, querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(20) }) } },
    async (request) => {
      const { project } = await projectScope(request);
      const rows = await prisma.auditLog.findMany({ where: { projectId: project.id }, orderBy: { at: "desc" }, take: request.query.limit });
      return rows.map((r) => ({ id: r.id, at: r.at.toISOString(), actorType: r.actorType, action: r.action, outcome: r.outcome, error: r.error }));
    }
  );

  app.put("/workspace/emergency-stop", { schema: { tags: ["workspace"], body: z.object({ enabled: z.boolean() }) } }, async (request) => {
    const auth = authOf(request);
    const workspace = await prisma.workspace.update({ where: { id: auth.workspaceId }, data: { emergencyStop: request.body.enabled } });
    await prisma.auditLog.create({
      data: { workspaceId: auth.workspaceId, actorType: "user", actorId: auth.userId, action: "workspace.emergencyStop", argsRedacted: { enabled: request.body.enabled }, outcome: "succeeded" }
    });
    return { emergencyStop: workspace.emergencyStop };
  });
};
