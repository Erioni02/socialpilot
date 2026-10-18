import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@socialpilot/db";
import { badRequest, config } from "@socialpilot/core";
import { SOCIAL_PLATFORMS } from "@socialpilot/shared";
import {
  deskBundle,
  deskMediaFile,
  markPosted,
  postedPerformance,
  readMetricsScreenshot,
  readyToPost,
  refreshPostedWithRapid,
  saveOwnerMetrics,
  sendToDesk,
  sniffMime,
  trackPostedTarget,
  unmarkPosted,
} from "@socialpilot/engine";
import { parse, userOf } from "../lib/http";

/** Manual publishing desk ("Ready to post") and tracking of manually posted content. */
export default async function readyRoutes(app: FastifyInstance) {
  const P = { preHandler: app.requireProject };

  app.get("/projects/:projectId/ready", P, async (req) => readyToPost(req.project));

  app.post("/projects/:projectId/posts/:postId/send-to-ready", P, async (req) => {
    const { postId } = req.params as { postId: string };
    const body = parse(z.object({ platforms: z.array(z.enum(SOCIAL_PLATFORMS)).min(1).optional(), at: z.coerce.date().optional() }), req.body ?? {});
    return sendToDesk(req.project, postId, body, { kind: "user", userId: userOf(req).id });
  });

  /** Platform-ready ZIP: converted media + caption + posting checklist. */
  app.get("/projects/:projectId/ready/:targetId/bundle", P, async (req, reply) => {
    const { targetId } = req.params as { targetId: string };
    const b = await deskBundle(req.project, targetId);
    reply.header("content-type", "application/zip").header("content-disposition", `attachment; filename="${b.filename}"`).header("cache-control", "no-store");
    return reply.send(b.data);
  });

  app.get("/projects/:projectId/ready/:targetId/media/:assetId", P, async (req, reply) => {
    const { targetId, assetId } = req.params as { targetId: string; assetId: string };
    const f = await deskMediaFile(req.project, targetId, assetId);
    reply.header("content-type", f.mimeType).header("content-disposition", `attachment; filename="${f.filename}"`).header("cache-control", "no-store").header("x-content-type-options", "nosniff");
    return reply.send(f.data);
  });

  app.post("/projects/:projectId/ready/:targetId/posted", P, async (req) => {
    const { targetId } = req.params as { targetId: string };
    const body = parse(z.object({ url: z.string().trim().min(8).max(1000), postedAt: z.coerce.date().optional() }), req.body);
    return markPosted(req.project, targetId, body, userOf(req).id);
  });

  app.post("/projects/:projectId/ready/:targetId/unpost", P, async (req) => {
    const { targetId } = req.params as { targetId: string };
    await unmarkPosted(req.project, targetId, userOf(req).id);
    return { ok: true };
  });

  // ───── Tracking ─────
  app.get("/projects/:projectId/posted", P, async (req) => {
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query);
    return postedPerformance(req.project, days);
  });

  app.post("/projects/:projectId/posted/:targetId/refresh", { preHandler: app.requireProject, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const { targetId } = req.params as { targetId: string };
    const t = await prisma.postTarget.findFirst({ where: { id: targetId, post: { projectId: req.project.id }, status: "published" } });
    if (!t) throw badRequest("Not a posted item");
    return trackPostedTarget({ targetId });
  });

  /** Live Instagram/X numbers from the RapidAPI statistics API (uses 1 request of the monthly budget). */
  app.post("/projects/:projectId/posted/:targetId/refresh-rapidapi", P, async (req) => {
    const { targetId } = req.params as { targetId: string };
    return refreshPostedWithRapid(req.project, targetId, userOf(req).id);
  });

  app.put("/projects/:projectId/posted/:targetId/metrics", P, async (req) => {
    const { targetId } = req.params as { targetId: string };
    const { source, metrics } = parse(z.object({ source: z.enum(["manual", "screenshot"]).default("manual"), metrics: z.record(z.number().int().min(0)) }), req.body);
    return saveOwnerMetrics(req.project, targetId, metrics, source, userOf(req).id);
  });

  /** Reads an analytics screenshot with the vision model; returns values to confirm (nothing saved). */
  app.post("/projects/:projectId/posted/metrics/read-screenshot", { preHandler: app.requireProject, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const file = await req.file({ limits: { fileSize: Math.min(config.MAX_UPLOAD_MB, 20) * 1024 * 1024, files: 1 } });
    if (!file) throw badRequest("No screenshot uploaded");
    const data = await file.toBuffer();
    if (file.file.truncated) throw badRequest("Screenshot is too large");
    const mime = sniffMime(data, file.mimetype);
    if (!mime || !["image/png", "image/jpeg", "image/webp"].includes(mime)) throw badRequest("Upload a PNG, JPEG or WebP screenshot");
    return readMetricsScreenshot(req.project, userOf(req).id, { data, mimeType: mime });
  });
}
