import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, Prisma } from "@socialpilot/db";
import { AppError, badRequest, notFound, safeFetch } from "@socialpilot/core";
import {
  AGENT_TYPES,
  aiConfigSchema,
  autonomyConfirmationPhrase,
  createProjectSchema,
  effectivePermissions,
  normalizePolicy,
  policySchema,
  projectUpdateSchema,
  type AutonomyLevel,
} from "@socialpilot/shared";
import {
  audit,
  budgetStatus,
  createProject,
  emit,
  listDiscoverItems,
  projectReadiness,
  relevance,
  socialAnalytics,
  startBrandAnalysis,
  webAnalytics,
} from "@socialpilot/engine";
import { parse, userOf } from "../lib/http";

const siteStatusCache = new Map<string, { at: number; value: unknown }>();
async function websiteStatus(url: string) {
  const hit = siteStatusCache.get(url);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value;
  let value: unknown;
  try {
    const r = await safeFetch(url, { method: "GET", timeoutMs: 10000, maxBytes: 200_000 });
    value = { up: r.status < 400, status: r.status, responseMs: r.timingMs, checkedAt: new Date().toISOString(), finalUrl: r.url };
  } catch (e) {
    value = { up: false, error: (e as Error).message.slice(0, 200), checkedAt: new Date().toISOString() };
  }
  siteStatusCache.set(url, { at: Date.now(), value });
  return value;
}

export default async function projectRoutes(app: FastifyInstance) {
  const P = { preHandler: app.requireProject };

  app.get("/projects", { preHandler: app.requireAuth }, async (req) => {
    const user = userOf(req);
    const projects = await prisma.project.findMany({
      where: { ownerId: user.id },
      orderBy: { updatedAt: "desc" },
      include: { integrations: { where: { status: { notIn: ["disconnected"] } }, select: { provider: true, status: true, accountHandle: true } }, _count: { select: { posts: true, tasks: true, approvals: { where: { status: "pending" } } } } },
    });
    return { projects };
  });

  app.post("/projects", { preHandler: app.requireAuth }, async (req) => {
    const body = parse(createProjectSchema, req.body);
    const project = await createProject(userOf(req).id, body);
    return { project };
  });

  app.get("/projects/:projectId", P, async (req) => {
    const user = userOf(req);
    const readiness = await projectReadiness(user.id, req.project);
    const policy = normalizePolicy(req.project.policy);
    return { project: req.project, readiness, policy, effective: effectivePermissions(policy) };
  });

  app.patch("/projects/:projectId", P, async (req) => {
    const body = parse(projectUpdateSchema, req.body);
    const data: Prisma.ProjectUpdateInput = {};
    for (const k of ["name", "websiteUrl", "logoUrl", "description", "targetAudience", "industry", "timezone", "setupStep", "setupComplete"] as const) {
      if (body[k] !== undefined) (data as any)[k] = body[k];
    }
    for (const k of ["products", "objectives", "brand", "competitors", "keywords"] as const) {
      if (body[k] !== undefined) (data as any)[k] = body[k] as Prisma.InputJsonValue;
    }
    if (body.timezone) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: body.timezone });
      } catch {
        throw badRequest("Unknown timezone");
      }
    }
    if (Object.keys(data).some((k) => ["description", "targetAudience", "industry", "products", "brand"].includes(k))) data.profileSource = req.project.profileSource ?? "manual";
    const project = await prisma.project.update({ where: { id: req.project.id }, data });
    await audit({ userId: userOf(req).id, projectId: project.id, actor: "user", action: "project.updated", details: { fields: Object.keys(data) } });
    await emit({ type: "project.updated", projectId: project.id, data: {} });
    return { project };
  });

  app.delete("/projects/:projectId", P, async (req) => {
    const { confirm } = parse(z.object({ confirm: z.string() }), req.body);
    if (confirm !== req.project.name) throw badRequest("Type the project name to confirm deletion");
    await prisma.project.delete({ where: { id: req.project.id } });
    await audit({ userId: userOf(req).id, actor: "user", action: "project.deleted", target: req.project.id, details: { name: req.project.name } });
    return { ok: true };
  });

  // ───── Wizard: website analysis → proposed profile ─────
  app.post("/projects/:projectId/analyze", P, async (req) => {
    const body = parse(z.object({ url: z.string().url().optional() }), req.body);
    if (body.url && body.url !== req.project.websiteUrl) await prisma.project.update({ where: { id: req.project.id }, data: { websiteUrl: body.url } });
    const audit = await startBrandAnalysis(userOf(req).id, { ...req.project, websiteUrl: body.url ?? req.project.websiteUrl }, body.url);
    return { auditId: audit.id };
  });

  app.get("/projects/:projectId/analysis/:auditId", P, async (req) => {
    const { auditId } = req.params as { auditId: string };
    const a = await prisma.websiteAudit.findFirst({ where: { id: auditId, projectId: req.project.id } });
    if (!a) throw notFound("Analysis");
    const report = a.report as any;
    return {
      id: a.id,
      status: a.status,
      error: a.error,
      url: a.url,
      pagesCrawled: a.pagesCrawled,
      profile: (a.aiAnalysis as any)?.profile ?? null,
      summary: report ? { pages: report.pages?.map((p: any) => ({ url: p.url, title: p.title, status: p.status })), issues: report.issues?.length ?? 0, scores: a.scores, hints: report.profileHints } : null,
    };
  });

  app.post("/projects/:projectId/apply-profile", P, async (req) => {
    const body = parse(
      projectUpdateSchema.extend({ profileSource: z.enum(["ai", "heuristic", "manual"]).optional() }),
      req.body,
    );
    const data: any = { profileSource: body.profileSource ?? "manual" };
    for (const k of ["name", "websiteUrl", "logoUrl", "description", "targetAudience", "industry", "timezone"] as const) if (body[k] !== undefined) data[k] = body[k];
    for (const k of ["products", "objectives", "brand", "competitors", "keywords"] as const) if (body[k] !== undefined) data[k] = body[k];
    const project = await prisma.project.update({ where: { id: req.project.id }, data });
    await audit({ userId: userOf(req).id, projectId: project.id, actor: "user", action: "project.profile_confirmed", details: { source: data.profileSource } });
    return { project };
  });

  // ───── Command center ─────
  app.get("/projects/:projectId/dashboard", P, async (req) => {
    const user = userOf(req);
    const p = req.project;
    const now = new Date();
    const [readiness, latestAudit, upcoming, recentPublished, inbox, opportunities, runningTasks, recentActivity, pendingApprovals, failedTasks, failedJobs, budget, automations, social, web, trends] = await Promise.all([
      projectReadiness(user.id, p),
      prisma.websiteAudit.findFirst({ where: { projectId: p.id, status: "completed" }, orderBy: { createdAt: "desc" }, select: { id: true, scores: true, finishedAt: true, pagesCrawled: true, url: true } }),
      prisma.post.findMany({ where: { projectId: p.id, status: { in: ["scheduled", "in_review"] }, scheduledAt: { gte: now } }, orderBy: { scheduledAt: "asc" }, take: 6, include: { targets: { select: { platform: true, status: true } } } }),
      prisma.postTarget.findMany({ where: { post: { projectId: p.id }, status: "published" }, orderBy: { publishedAt: "desc" }, take: 6, include: { post: { select: { id: true, title: true, body: true } } } }),
      prisma.inboxItem.findMany({ where: { projectId: p.id, status: { in: ["new", "drafted", "escalated", "pending_approval"] } }, orderBy: [{ priority: "desc" }, { receivedAt: "desc" }], take: 6 }),
      prisma.opportunity.findMany({ where: { projectId: p.id, status: { in: ["new", "saved"] } }, orderBy: { createdAt: "desc" }, take: 4 }),
      prisma.task.findMany({ where: { projectId: p.id, status: { in: ["queued", "planning", "running"] } }, orderBy: { createdAt: "desc" }, take: 5 }),
      prisma.auditLog.findMany({ where: { projectId: p.id }, orderBy: { createdAt: "desc" }, take: 12 }),
      prisma.approval.count({ where: { projectId: p.id, status: "pending" } }),
      prisma.task.findMany({ where: { projectId: p.id, status: "failed", finishedAt: { gte: new Date(Date.now() - 7 * 86400_000) } }, orderBy: { finishedAt: "desc" }, take: 5, select: { id: true, title: true, error: true, finishedAt: true } }),
      prisma.job.findMany({ where: { projectId: p.id, status: "failed", updatedAt: { gte: new Date(Date.now() - 7 * 86400_000) } }, orderBy: { updatedAt: "desc" }, take: 5, select: { id: true, name: true, lastError: true, updatedAt: true } }),
      budgetStatus(p),
      prisma.automation.findMany({ where: { projectId: p.id, active: true }, orderBy: { nextRunAt: "asc" }, take: 5, select: { id: true, name: true, nextRunAt: true, lastRunAt: true } }),
      socialAnalytics(p).catch(() => ({ accounts: [] })),
      webAnalytics(p, 28).catch((e) => ({ connected: true, error: String(e) })),
      listDiscoverItems({ hours: 48, limit: 200 }),
    ]);
    const integrations = await prisma.integration.findMany({ where: { projectId: p.id, status: { not: "disconnected" } }, select: { id: true, provider: true, status: true, accountHandle: true, lastSyncAt: true, lastError: true, kind: true } });
    const relevantTrends = trends
      .map((t) => ({ t, r: relevance(p, t) }))
      .filter((x) => x.r.score > 0)
      .sort((a, b) => b.r.score - a.r.score || (b.t.score ?? 0) - (a.t.score ?? 0))
      .slice(0, 6)
      .map(({ t, r }) => ({ id: t.id, title: t.title, url: t.url, sourceName: t.sourceName, sourceType: t.sourceType, publishedAt: t.publishedAt, score: t.score, comments: t.comments, matched: r.matched }));
    return {
      project: p,
      readiness,
      website: p.websiteUrl ? { url: p.websiteUrl, status: await websiteStatus(p.websiteUrl), latestAudit } : null,
      integrations,
      social: (social as any).accounts.map((a: any) => ({ integrationId: a.integrationId, platform: a.platform, handle: a.handle, status: a.status, followers: a.latest?.followers ?? null, followerGrowth: a.followerGrowth ?? null, growthWindowDays: a.growthWindowDays ?? 0, series: a.followersSeries, topPost: a.topPosts?.[0] ?? null, note: a.note, error: a.postsError ?? a.lastError })),
      web,
      upcoming,
      recentPublished,
      inbox,
      opportunities,
      trends: relevantTrends,
      runningTasks,
      recentActivity,
      health: { pendingApprovals, failedTasks, failedJobs, budget, automations },
    };
  });

  // ───── Policy & AI config ─────
  app.get("/projects/:projectId/policy", P, async (req) => {
    const policy = normalizePolicy(req.project.policy);
    return { policy, effective: effectivePermissions(policy) };
  });

  app.put("/projects/:projectId/policy", P, async (req) => {
    const body = parse(policySchema.extend({ confirmation: z.string().optional() }), req.body);
    const current = normalizePolicy(req.project.policy);
    const next = normalizePolicy(body);
    if (next.autonomyLevel > current.autonomyLevel && body.confirmation !== autonomyConfirmationPhrase(next.autonomyLevel as AutonomyLevel)) {
      throw new AppError(428, `Raising autonomy requires typing “${autonomyConfirmationPhrase(next.autonomyLevel as AutonomyLevel)}”.`, "confirmation_required", { phrase: autonomyConfirmationPhrase(next.autonomyLevel as AutonomyLevel) });
    }
    const loosened = (Object.keys(next.approvals) as (keyof typeof next.approvals)[]).filter((k) => current.approvals[k] && !next.approvals[k]);
    if (loosened.length && body.confirmation !== "DISABLE APPROVALS" && next.autonomyLevel === current.autonomyLevel) {
      throw new AppError(428, `Turning off approvals (${loosened.join(", ")}) requires typing “DISABLE APPROVALS”.`, "confirmation_required", { phrase: "DISABLE APPROVALS" });
    }
    const { confirmation: _c, ...stored } = { ...next, confirmation: undefined };
    const project = await prisma.project.update({ where: { id: req.project.id }, data: { policy: stored as unknown as Prisma.InputJsonValue } });
    await audit({ userId: userOf(req).id, projectId: project.id, actor: "user", action: "policy.updated", details: { from: current, to: next } });
    await emit({ type: "project.updated", projectId: project.id, data: {} });
    return { policy: next, effective: effectivePermissions(next) };
  });

  app.put("/projects/:projectId/paused", P, async (req) => {
    const { paused } = parse(z.object({ paused: z.boolean() }), req.body);
    const project = await prisma.project.update({ where: { id: req.project.id }, data: { paused } });
    await audit({ userId: userOf(req).id, projectId: project.id, actor: "user", action: paused ? "project.paused" : "project.resumed" });
    return { project };
  });

  app.put("/projects/:projectId/ai-config", P, async (req) => {
    const body = parse(aiConfigSchema, req.body);
    const project = await prisma.project.update({ where: { id: req.project.id }, data: { aiConfig: body as Prisma.InputJsonValue } });
    await audit({ userId: userOf(req).id, projectId: project.id, actor: "user", action: "ai_config.updated", details: body });
    return { aiConfig: project.aiConfig };
  });

  app.get("/projects/:projectId/budget", P, async (req) => {
    const b = await budgetStatus(req.project);
    const byModel = await prisma.aiUsage.groupBy({ by: ["provider", "model", "kind"], where: { projectId: req.project.id, createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } }, _sum: { costUsd: true, inputTokens: true, outputTokens: true, units: true }, _count: true });
    return { ...b, last30Days: byModel };
  });

  // ───── Notes ─────
  app.get("/projects/:projectId/notes", P, async (req) => ({ notes: await prisma.note.findMany({ where: { projectId: req.project.id }, orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }] }) }));
  app.post("/projects/:projectId/notes", P, async (req) => {
    const body = parse(z.object({ title: z.string().trim().min(1).max(200), body: z.string().max(50000).default(""), pinned: z.boolean().default(false) }), req.body);
    return { note: await prisma.note.create({ data: { ...body, projectId: req.project.id } }) };
  });
  app.patch("/projects/:projectId/notes/:noteId", P, async (req) => {
    const { noteId } = req.params as { noteId: string };
    const body = parse(z.object({ title: z.string().trim().min(1).max(200).optional(), body: z.string().max(50000).optional(), pinned: z.boolean().optional() }), req.body);
    const r = await prisma.note.updateMany({ where: { id: noteId, projectId: req.project.id }, data: body });
    if (!r.count) throw notFound("Note");
    return { ok: true };
  });
  app.delete("/projects/:projectId/notes/:noteId", P, async (req) => {
    const { noteId } = req.params as { noteId: string };
    await prisma.note.deleteMany({ where: { id: noteId, projectId: req.project.id } });
    return { ok: true };
  });

  // ───── Agent configuration ─────
  app.get("/projects/:projectId/agents", P, async (req) => {
    const configs = await prisma.agentConfig.findMany({ where: { projectId: req.project.id } });
    return { agents: AGENT_TYPES.map((t) => configs.find((c) => c.agentType === t) ?? { agentType: t, enabled: true, instructions: "", model: null }) };
  });
  app.put("/projects/:projectId/agents/:agentType", P, async (req) => {
    const { agentType } = parse(z.object({ agentType: z.enum(AGENT_TYPES) }), req.params);
    const body = parse(z.object({ enabled: z.boolean(), instructions: z.string().max(5000).default(""), model: z.string().max(120).nullable().optional() }), req.body);
    const cfg = await prisma.agentConfig.upsert({
      where: { projectId_agentType: { projectId: req.project.id, agentType } },
      update: body,
      create: { projectId: req.project.id, agentType, ...body },
    });
    await audit({ userId: userOf(req).id, projectId: req.project.id, actor: "user", action: "agent_config.updated", target: agentType, details: { enabled: body.enabled } });
    return { agent: cfg };
  });

  app.get("/projects/:projectId/jobs", P, async (req) => {
    const q = parse(z.object({ status: z.string().optional() }), req.query);
    return { jobs: await prisma.job.findMany({ where: { projectId: req.project.id, ...(q.status ? { status: q.status } : {}) }, orderBy: { createdAt: "desc" }, take: 50 }) };
  });

  app.get("/projects/:projectId/jobs/:jobId", P, async (req) => {
    const { jobId } = req.params as { jobId: string };
    const job = await prisma.job.findFirst({ where: { id: jobId, projectId: req.project.id }, select: { id: true, name: true, status: true, attempts: true, maxAttempts: true, lastError: true, result: true, createdAt: true, finishedAt: true } });
    if (!job) throw notFound("Job");
    return { job };
  });

  app.get("/projects/:projectId/activity", P, async (req) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(300).default(100) }), req.query);
    return { items: await prisma.auditLog.findMany({ where: { projectId: req.project.id }, orderBy: { createdAt: "desc" }, take: q.limit }) };
  });
}
