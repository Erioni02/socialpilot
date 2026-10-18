import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@socialpilot/db";
import { notFound } from "@socialpilot/core";
import { TRAFFIC_EST_COST_PER_DOMAIN } from "@socialpilot/integrations";
import {
  analyzeIntelUrl,
  deleteIntelEntity,
  exportIntelCsv,
  getApiKey,
  getIntelEntity,
  intelDashboard,
  listIntelEntities,
  MAX_PAID_CHARGE_USD,
  setWatched,
  startTrafficReport,
} from "@socialpilot/engine";
import { parse, userOf } from "../lib/http";

export default async function intelRoutes(app: FastifyInstance) {
  const A = { preHandler: app.requireAuth };

  async function ownedProjectId(userId: string, projectId?: string | null) {
    if (!projectId) return null;
    const p = await prisma.project.findFirst({ where: { id: projectId, ownerId: userId }, select: { id: true } });
    if (!p) throw notFound("Project");
    return p.id;
  }

  app.get("/intel/config", A, async (req) => ({
    apifyConfigured: !!(await getApiKey(userOf(req).id, "apify")),
    maxPaidChargeUsd: MAX_PAID_CHARGE_USD,
    trafficCostPerDomainUsd: TRAFFIC_EST_COST_PER_DOMAIN,
  }));

  /** Free sources by default. Paid sources only with paidProvider + confirmPaid=true for this single request. */
  app.post("/intel/analyze", { preHandler: app.requireAuth, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const body = parse(
      z.object({
        url: z.string().trim().min(3).max(1000),
        projectId: z.string().optional().nullable(),
        paidProvider: z.enum(["apify-instagram", "apify-tiktok"]).optional(),
        confirmPaid: z.boolean().optional(),
        maxChargeUsd: z.number().min(0.01).max(MAX_PAID_CHARGE_USD).optional(),
      }),
      req.body,
    );
    const user = userOf(req);
    const projectId = await ownedProjectId(user.id, body.projectId);
    return analyzeIntelUrl(user.id, { ...body, projectId });
  });

  app.get("/intel/dashboard", A, async (req) => {
    const q = parse(z.object({ platform: z.enum(["all", "tiktok", "instagram", "x"]).default("all"), watchedOnly: z.coerce.boolean().default(false) }), req.query);
    return intelDashboard(userOf(req).id, q);
  });

  app.get("/intel/entities", A, async (req) => {
    const q = parse(z.object({ watched: z.coerce.boolean().optional(), platform: z.string().optional(), kind: z.enum(["profile", "post"]).optional() }), req.query);
    return { entities: await listIntelEntities(userOf(req).id, q) };
  });
  app.get("/intel/entities/:id", A, async (req) => getIntelEntity(userOf(req).id, (req.params as { id: string }).id));
  app.patch("/intel/entities/:id", A, async (req) => {
    const { watched } = parse(z.object({ watched: z.boolean() }), req.body);
    await setWatched(userOf(req).id, (req.params as { id: string }).id, watched);
    return { ok: true };
  });
  app.delete("/intel/entities/:id", A, async (req) => {
    await deleteIntelEntity(userOf(req).id, (req.params as { id: string }).id);
    return { ok: true };
  });
  /** Re-fetch with free sources (paid refreshes go through /intel/analyze with explicit confirmation). */
  app.post("/intel/entities/:id/refresh", A, async (req) => {
    const user = userOf(req);
    const e = await prisma.intelEntity.findFirst({ where: { id: (req.params as { id: string }).id, userId: user.id } });
    if (!e) throw notFound("Tracked item");
    return analyzeIntelUrl(user.id, { url: e.url, projectId: e.projectId });
  });

  app.get("/intel/searches", A, async (req) => ({
    searches: await prisma.intelSearch.findMany({ where: { userId: userOf(req).id }, orderBy: { createdAt: "desc" }, take: 100 }),
  }));
  app.delete("/intel/searches", A, async (req) => {
    await prisma.intelSearch.deleteMany({ where: { userId: userOf(req).id } });
    return { ok: true };
  });

  app.get("/intel/export.csv", A, async (req, reply) => {
    const q = parse(z.object({ platform: z.string().optional(), entityId: z.string().optional() }), req.query);
    const csv = await exportIntelCsv(userOf(req).id, q);
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="social-intel-${new Date().toISOString().slice(0, 10)}.csv"`);
    return csv;
  });

  // ───── Website traffic estimates (Apify) ─────
  app.get("/intel/traffic", A, async (req) => {
    const q = parse(z.object({ projectId: z.string().optional() }), req.query);
    const user = userOf(req);
    const projectId = q.projectId ? await ownedProjectId(user.id, q.projectId) : undefined;
    return { reports: await prisma.webTrafficReport.findMany({ where: { userId: user.id, ...(projectId ? { projectId } : {}) }, orderBy: { createdAt: "desc" }, take: 30 }) };
  });
  app.post("/intel/traffic", A, async (req) => {
    const body = parse(z.object({ domain: z.string().min(3).max(300), projectId: z.string().optional().nullable(), maxBudgetUsd: z.number().min(0.17).max(2), confirm: z.literal(true) }), req.body);
    const user = userOf(req);
    const projectId = await ownedProjectId(user.id, body.projectId);
    return { report: await startTrafficReport(user.id, { ...body, projectId }) };
  });
}
