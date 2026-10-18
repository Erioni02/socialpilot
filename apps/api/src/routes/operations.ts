import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, Prisma } from "@socialpilot/db";
import { badRequest, notFound } from "@socialpilot/core";
import { AGENT_TYPES, automationSchema, taskCreateSchema } from "@socialpilot/shared";
import {
  audit,
  cancelTask,
  closeCodeChange,
  createTask,
  decideApproval,
  deploymentLogs,
  emit,
  listDeployments,
  listRepoFiles,
  MORNING_TEMPLATE,
  nextRun,
  proposeCodeChange,
  readRepoFile,
  refreshChecks,
  requestMerge,
  requestPromotion,
  startWebsiteAudit,
  submitCodeChange,
  triggerAutomation,
  validateCron,
} from "@socialpilot/engine";
import { parse, userOf } from "../lib/http";

export default async function operationsRoutes(app: FastifyInstance) {
  const P = { preHandler: app.requireProject };
  const userActor = (req: any) => ({ kind: "user" as const, userId: userOf(req).id });

  // ───── Website audits ─────
  app.get("/projects/:projectId/audits", P, async (req) => ({
    audits: await prisma.websiteAudit.findMany({ where: { projectId: req.project.id }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, url: true, status: true, pagesCrawled: true, scores: true, error: true, createdAt: true, finishedAt: true } }),
  }));
  app.post("/projects/:projectId/audits", P, async (req) => {
    const { url } = parse(z.object({ url: z.string().url().optional() }), req.body);
    if (!url && !req.project.websiteUrl) throw badRequest("Add a website URL to the project first");
    const r = await startWebsiteAudit(req.project, url);
    return { auditId: r.audit.id, jobId: r.jobId };
  });
  app.get("/projects/:projectId/audits/:auditId", P, async (req) => {
    const { auditId } = req.params as { auditId: string };
    const a = await prisma.websiteAudit.findFirst({ where: { id: auditId, projectId: req.project.id } });
    if (!a) throw notFound("Audit");
    return { audit: a };
  });

  // ───── Repository & code changes ─────
  app.get("/projects/:projectId/repo/files", P, async (req) => {
    const { prefix } = parse(z.object({ prefix: z.string().max(300).default("") }), req.query);
    return listRepoFiles(req.project.id, prefix);
  });
  app.get("/projects/:projectId/repo/file", P, async (req) => {
    const { path } = parse(z.object({ path: z.string().min(1).max(500) }), req.query);
    return readRepoFile(req.project.id, path);
  });
  app.get("/projects/:projectId/code-changes", P, async (req) => ({
    changes: await prisma.codeChange.findMany({ where: { projectId: req.project.id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, title: true, status: true, branch: true, prUrl: true, prNumber: true, previewUrl: true, createdBy: true, createdAt: true, checks: true, repo: true } }),
  }));
  app.post("/projects/:projectId/code-changes", P, async (req) => {
    const body = parse(z.object({ title: z.string().min(3).max(150), description: z.string().max(8000).default(""), files: z.array(z.object({ path: z.string().min(1).max(500), content: z.string().max(500_000).nullable() })).min(1).max(30) }), req.body);
    return { change: await proposeCodeChange(req.project, body, userActor(req)) };
  });
  app.post("/projects/:projectId/code-changes/ai", P, async (req) => {
    const { instruction } = parse(z.object({ instruction: z.string().min(5).max(4000) }), req.body);
    const task = await createTask(req.project, { instruction: `Website code change request: ${instruction}\nRead the relevant repository files, propose a minimal change with propose_code_change, then open a pull request with open_pull_request. Do not merge.`, agentType: "website_code" }, "user");
    return { taskId: task.id };
  });
  app.get("/projects/:projectId/code-changes/:changeId", P, async (req) => {
    const { changeId } = req.params as { changeId: string };
    const c = await prisma.codeChange.findFirst({ where: { id: changeId, projectId: req.project.id } });
    if (!c) throw notFound("Code change");
    return { change: c };
  });
  app.post("/projects/:projectId/code-changes/:changeId/push", P, async (req) => {
    const { changeId } = req.params as { changeId: string };
    return submitCodeChange(req.project, changeId, userActor(req));
  });
  app.post("/projects/:projectId/code-changes/:changeId/refresh", P, async (req) => {
    const { changeId } = req.params as { changeId: string };
    return { change: await refreshChecks(req.project, changeId) };
  });
  app.post("/projects/:projectId/code-changes/:changeId/merge", P, async (req) => {
    const { changeId } = req.params as { changeId: string };
    const { confirm } = parse(z.object({ confirm: z.literal(true) }), req.body);
    if (!confirm) throw badRequest("Confirmation required");
    return requestMerge(req.project, changeId, userActor(req));
  });
  app.post("/projects/:projectId/code-changes/:changeId/close", P, async (req) => {
    const { changeId } = req.params as { changeId: string };
    await closeCodeChange(req.project, changeId, userOf(req).id);
    return { ok: true };
  });

  // ───── Deployments ─────
  app.get("/projects/:projectId/deployments", P, async (req) => ({ deployments: await listDeployments(req.project.id) }));
  app.get("/projects/:projectId/deployments/:deploymentId/logs", P, async (req) => {
    const { deploymentId } = req.params as { deploymentId: string };
    return { lines: await deploymentLogs(req.project.id, deploymentId) };
  });
  app.post("/projects/:projectId/deployments/:deploymentId/promote", P, async (req) => {
    const { deploymentId } = req.params as { deploymentId: string };
    const body = parse(z.object({ mode: z.enum(["promote", "rollback"]).default("promote"), confirm: z.literal(true) }), req.body);
    return requestPromotion(req.project, deploymentId, body.mode, userActor(req));
  });

  // ───── Agents & tasks ─────
  app.get("/projects/:projectId/tasks", P, async (req) => {
    const q = parse(z.object({ status: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
    return { tasks: await prisma.task.findMany({ where: { projectId: req.project.id, ...(q.status ? { status: { in: q.status.split(",") } } : {}) }, orderBy: { createdAt: "desc" }, take: q.limit }) };
  });
  app.post("/projects/:projectId/tasks", P, async (req) => {
    const body = parse(taskCreateSchema, req.body);
    if (body.attachmentAssetIds.length) {
      const n = await prisma.asset.count({ where: { id: { in: body.attachmentAssetIds }, projectId: req.project.id } });
      if (n !== body.attachmentAssetIds.length) throw badRequest("Unknown attachment");
    }
    return { task: await createTask(req.project, body, "user") };
  });
  app.get("/projects/:projectId/tasks/:taskId", P, async (req) => {
    const { taskId } = req.params as { taskId: string };
    const task = await prisma.task.findFirst({ where: { id: taskId, projectId: req.project.id }, include: { steps: { orderBy: { seq: "asc" } } } });
    if (!task) throw notFound("Task");
    const approvals = await prisma.approval.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
    return { task, approvals };
  });
  app.post("/projects/:projectId/tasks/:taskId/cancel", P, async (req) => {
    const { taskId } = req.params as { taskId: string };
    return { cancelled: await cancelTask(req.project.id, taskId) };
  });

  // ───── Approvals ─────
  app.get("/projects/:projectId/approvals", P, async (req) => {
    const q = parse(z.object({ status: z.string().default("pending") }), req.query);
    return { approvals: await prisma.approval.findMany({ where: { projectId: req.project.id, ...(q.status === "all" ? {} : { status: { in: q.status.split(",") } }) }, orderBy: { createdAt: "desc" }, take: 100 }) };
  });
  app.post("/projects/:projectId/approvals/:approvalId/decide", P, async (req) => {
    const { approvalId } = req.params as { approvalId: string };
    const body = parse(z.object({ decision: z.enum(["approve", "reject"]), note: z.string().max(1000).optional() }), req.body);
    return { approval: await decideApproval(userOf(req).id, req.project, approvalId, body.decision, body.note) };
  });

  // ───── Automations ─────
  app.get("/projects/:projectId/automations", P, async (req) => ({
    automations: await prisma.automation.findMany({ where: { projectId: req.project.id }, orderBy: { createdAt: "asc" }, include: { runs: { orderBy: { startedAt: "desc" }, take: 1 } } }),
    templates: [{ ...MORNING_TEMPLATE, trigger: { ...MORNING_TEMPLATE.trigger, timezone: req.project.timezone } }],
  }));
  const saveAutomation = async (req: any, existingId?: string) => {
    const body = parse(automationSchema, req.body);
    if (body.trigger.type === "cron") {
      if (!body.trigger.cron) throw badRequest("Cron expression required");
      validateCron(body.trigger.cron, body.trigger.timezone);
    }
    const previous = existingId ? await prisma.automation.findUnique({ where: { id: existingId } }) : null;
    if (body.allowAutoPublish && !previous?.allowAutoPublish) {
      const confirm = (req.body as any).confirmation;
      if (confirm !== "ALLOW AUTO PUBLISH") throw badRequest("Allowing automatic publishing requires typing “ALLOW AUTO PUBLISH”.");
    }
    const data = { name: body.name, description: body.description, trigger: body.trigger as Prisma.InputJsonValue, steps: body.steps as Prisma.InputJsonValue, active: body.active, allowAutoPublish: body.allowAutoPublish, nextRunAt: body.active ? nextRun(body.trigger) : null };
    const a = existingId ? await prisma.automation.update({ where: { id: existingId }, data }) : await prisma.automation.create({ data: { ...data, projectId: req.project.id } });
    await audit({ userId: userOf(req).id, projectId: req.project.id, actor: "user", action: existingId ? "automation.updated" : "automation.created", target: a.id, details: { active: a.active, allowAutoPublish: a.allowAutoPublish, steps: body.steps.map((s) => s.type) } });
    await emit({ type: "automation.updated", projectId: req.project.id, data: { id: a.id } });
    return { automation: a };
  };
  app.post("/projects/:projectId/automations", P, async (req) => saveAutomation(req));
  app.put("/projects/:projectId/automations/:automationId", P, async (req) => {
    const { automationId } = req.params as { automationId: string };
    if (!(await prisma.automation.findFirst({ where: { id: automationId, projectId: req.project.id } }))) throw notFound("Automation");
    return saveAutomation(req, automationId);
  });
  app.delete("/projects/:projectId/automations/:automationId", P, async (req) => {
    const { automationId } = req.params as { automationId: string };
    await prisma.automation.deleteMany({ where: { id: automationId, projectId: req.project.id } });
    await audit({ userId: userOf(req).id, projectId: req.project.id, actor: "user", action: "automation.deleted", target: automationId });
    return { ok: true };
  });
  app.post("/projects/:projectId/automations/:automationId/run", P, async (req) => {
    const { automationId } = req.params as { automationId: string };
    return { jobId: (await triggerAutomation(req.project, automationId)).id };
  });
  app.get("/projects/:projectId/automations/:automationId/runs", P, async (req) => {
    const { automationId } = req.params as { automationId: string };
    return { runs: await prisma.automationRun.findMany({ where: { automationId, automation: { projectId: req.project.id } }, orderBy: { startedAt: "desc" }, take: 30 }) };
  });

  app.get("/agents/types", { preHandler: app.requireAuth }, async () => ({ types: AGENT_TYPES }));
}
