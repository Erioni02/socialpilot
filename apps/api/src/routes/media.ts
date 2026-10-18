import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@socialpilot/db";
import { AppError, badRequest, config, notFound } from "@socialpilot/core";
import { imageGenSchema, imageOpSchema, videoGenSchema, videoOpSchema } from "@socialpilot/shared";
import {
  ALLOWED_UPLOAD_TYPES,
  assetWithVersions,
  audit,
  createAsset,
  deleteObject,
  emit,
  enqueue,
  normalizeFolder,
  resolveImageAI,
  resolveVideoAI,
  restoreVersion,
  sniffMime,
  streamObject,
  listFiles,
  writeFile,
  writeAssetText,
} from "@socialpilot/engine";
import { parse, userOf } from "../lib/http";

/** Serializes edits: only one operation per asset at a time, so every edit builds on the latest version. */
async function lockAsset(assetId: string) {
  const r = await prisma.asset.updateMany({ where: { id: assetId, status: { not: "processing" } }, data: { status: "processing", error: null } });
  if (!r.count) throw new AppError(409, "This asset is still processing a previous edit. Try again when it finishes.", "asset_busy");
}

export default async function mediaRoutes(app: FastifyInstance) {
  const P = { preHandler: app.requireProject };

  // ───── Workspace text files (shared by the AI and the user) ─────
  app.get("/projects/:projectId/files", P, async (req) => {
    const { prefix } = parse(z.object({ prefix: z.string().max(300).default("/workspace") }), req.query);
    return { files: await listFiles(req.project.id, prefix) };
  });
  app.put("/projects/:projectId/files", P, async (req) => {
    const body = parse(z.object({ path: z.string().min(1).max(300), content: z.string().max(2_000_000) }), req.body);
    return writeFile(req.project, body.path, body.content, "user");
  });
  app.post("/projects/:projectId/assets/:assetId/text", P, async (req) => {
    const { assetId } = req.params as { assetId: string };
    const { content } = parse(z.object({ content: z.string().max(2_000_000) }), req.body);
    return writeAssetText(req.project, assetId, content, "user");
  });

  async function owned(projectId: string, assetId: string) {
    const a = await prisma.asset.findFirst({ where: { id: assetId, projectId } });
    if (!a) throw notFound("Asset");
    return a;
  }

  app.get("/projects/:projectId/assets", P, async (req) => {
    const q = parse(
      z.object({ folder: z.string().optional(), kind: z.string().optional(), campaignId: z.string().optional(), q: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }),
      req.query,
    );
    const assets = await prisma.asset.findMany({
      where: {
        projectId: req.project.id,
        ...(q.folder ? { folder: q.folder } : {}),
        ...(q.kind ? { kind: q.kind } : {}),
        ...(q.campaignId ? { campaignId: q.campaignId } : {}),
        ...(q.q ? { name: { contains: q.q, mode: "insensitive" } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: q.limit,
      include: { versions: { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true, mimeType: true, width: true, height: true, durationSec: true, sizeBytes: true, operation: true } } },
    });
    const folders = await prisma.asset.groupBy({ by: ["folder"], where: { projectId: req.project.id }, _count: true });
    return { assets, folders: folders.map((f) => ({ folder: f.folder, count: f._count })) };
  });

  app.post("/projects/:projectId/assets/upload", P, async (req) => {
    const file = await req.file({ limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });
    if (!file) throw badRequest("No file uploaded");
    const data = await file.toBuffer();
    if (file.file.truncated) throw badRequest(`File exceeds ${config.MAX_UPLOAD_MB} MB`);
    const mime = sniffMime(data, file.mimetype);
    if (!mime || !ALLOWED_UPLOAD_TYPES[mime]) throw badRequest("Unsupported or mismatched file type. Allowed: PNG, JPEG, WebP, GIF, MP4, MOV, WebM, MP3, WAV, TXT, MD, JSON, SRT.");
    const fields = file.fields as Record<string, any>;
    const folder = normalizeFolder(fields.folder?.value);
    const campaignId = fields.campaignId?.value || null;
    if (campaignId && !(await prisma.campaign.findFirst({ where: { id: campaignId, projectId: req.project.id } }))) throw badRequest("Unknown campaign");
    const name = String(file.filename || "upload").replace(/[^\w.\- ()]/g, "_").slice(0, 150);
    const { asset } = await createAsset(req.project.id, { name, kind: ALLOWED_UPLOAD_TYPES[mime], folder, campaignId, source: "upload" }, data, mime, { operation: "upload", params: { originalName: name } });
    await audit({ userId: userOf(req).id, projectId: req.project.id, actor: "user", action: "asset.uploaded", target: asset.id, details: { name, mime, size: data.length } });
    return { asset };
  });

  app.get("/projects/:projectId/assets/:assetId", P, async (req) => {
    const { assetId } = req.params as { assetId: string };
    await owned(req.project.id, assetId);
    const asset = await assetWithVersions(assetId);
    const usedIn = await prisma.post.findMany({ where: { projectId: req.project.id, mediaAssetIds: { has: assetId } }, select: { id: true, title: true, status: true } });
    return { asset, usedIn };
  });

  /** Authenticated file access (the browser sends the session cookie). */
  app.get("/projects/:projectId/assets/:assetId/file", P, async (req, reply) => {
    const { assetId } = req.params as { assetId: string };
    const { version, download } = parse(z.object({ version: z.string().optional(), download: z.coerce.boolean().optional() }), req.query);
    const asset = await owned(req.project.id, assetId);
    const v = await prisma.assetVersion.findFirst({ where: { assetId, ...(version ? { id: version } : { id: asset.currentVersionId ?? "" }) } });
    if (!v) throw notFound("File");
    reply.header("content-type", v.mimeType).header("cache-control", "private, max-age=3600").header("x-content-type-options", "nosniff");
    if (download) reply.header("content-disposition", `attachment; filename="${asset.name.replace(/[^\w.\- ]/g, "_")}"`);
    if (v.mimeType === "image/svg+xml") reply.header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'");
    return reply.send(streamObject(v.storageKey));
  });

  app.patch("/projects/:projectId/assets/:assetId", P, async (req) => {
    const { assetId } = req.params as { assetId: string };
    await owned(req.project.id, assetId);
    const body = parse(z.object({ name: z.string().min(1).max(200).optional(), folder: z.string().max(200).optional(), campaignId: z.string().nullable().optional(), tags: z.array(z.string().max(40)).max(20).optional(), approvalStatus: z.enum(["none", "pending", "approved", "rejected"]).optional() }), req.body);
    if (body.campaignId && !(await prisma.campaign.findFirst({ where: { id: body.campaignId, projectId: req.project.id } }))) throw badRequest("Unknown campaign");
    const asset = await prisma.asset.update({ where: { id: assetId }, data: { ...body, ...(body.folder ? { folder: normalizeFolder(body.folder) } : {}) } });
    await emit({ type: "asset.updated", projectId: req.project.id, data: { id: assetId } });
    return { asset };
  });

  app.delete("/projects/:projectId/assets/:assetId", P, async (req) => {
    const { assetId } = req.params as { assetId: string };
    const asset = await owned(req.project.id, assetId);
    const used = await prisma.post.count({ where: { projectId: req.project.id, mediaAssetIds: { has: assetId }, status: { in: ["scheduled", "publishing", "in_review"] } } });
    if (used) throw badRequest("This asset is attached to scheduled posts. Detach it first.");
    const versions = await prisma.assetVersion.findMany({ where: { assetId } });
    await prisma.asset.delete({ where: { id: asset.id } });
    for (const v of versions) await deleteObject(v.storageKey).catch(() => {});
    await audit({ userId: userOf(req).id, projectId: req.project.id, actor: "user", action: "asset.deleted", target: assetId, details: { name: asset.name } });
    return { ok: true };
  });

  app.post("/projects/:projectId/assets/:assetId/restore", P, async (req) => {
    const { assetId } = req.params as { assetId: string };
    await owned(req.project.id, assetId);
    const { versionId } = parse(z.object({ versionId: z.string() }), req.body);
    return { version: await restoreVersion(assetId, versionId) };
  });

  app.post("/projects/:projectId/assets/:assetId/image-op", P, async (req) => {
    const { assetId } = req.params as { assetId: string };
    const asset = await owned(req.project.id, assetId);
    const op = parse(imageOpSchema, req.body);
    if (["ai_edit", "remove_background", "variations"].includes(op.op)) await resolveImageAI(userOf(req).id, req.project, (op as any).provider, op.op === "remove_background" ? "remove_background" : "edit");
    await lockAsset(asset.id);
    await emit({ type: "asset.updated", projectId: req.project.id, data: { id: asset.id } });
    const job = await enqueue("media.imageOp", { projectId: req.project.id, assetId, op }, { projectId: req.project.id, maxAttempts: 1 });
    return { jobId: job.id };
  });

  app.post("/projects/:projectId/assets/:assetId/video-op", P, async (req) => {
    const { assetId } = req.params as { assetId: string };
    const asset = await owned(req.project.id, assetId);
    const op = parse(videoOpSchema, req.body);
    if (op.op === "concat") for (const id of op.assetIds) await owned(req.project.id, id);
    await lockAsset(asset.id);
    await emit({ type: "asset.updated", projectId: req.project.id, data: { id: asset.id } });
    const job = await enqueue("media.videoOp", { projectId: req.project.id, assetId, op }, { projectId: req.project.id, maxAttempts: 1 });
    return { jobId: job.id };
  });

  app.post("/projects/:projectId/assets/generate-image", P, async (req) => {
    const input = parse(imageGenSchema, req.body);
    await resolveImageAI(userOf(req).id, req.project, input.provider);
    if (input.campaignId && !(await prisma.campaign.findFirst({ where: { id: input.campaignId, projectId: req.project.id } }))) throw badRequest("Unknown campaign");
    const placeholder = await prisma.asset.create({ data: { projectId: req.project.id, name: input.prompt.slice(0, 60), kind: "image", folder: normalizeFolder(input.folder), campaignId: input.campaignId ?? null, source: "generated", status: "processing" } });
    await emit({ type: "asset.updated", projectId: req.project.id, data: { id: placeholder.id } });
    const job = await enqueue("media.generateImage", { projectId: req.project.id, input, placeholderId: placeholder.id }, { projectId: req.project.id, maxAttempts: 1 });
    return { jobId: job.id, placeholderId: placeholder.id };
  });

  app.post("/projects/:projectId/assets/generate-video", P, async (req) => {
    const input = parse(videoGenSchema, req.body);
    await resolveVideoAI(userOf(req).id, req.project);
    if (input.imageAssetId) await owned(req.project.id, input.imageAssetId);
    const placeholder = await prisma.asset.create({ data: { projectId: req.project.id, name: input.prompt.slice(0, 60), kind: "video", folder: normalizeFolder(input.folder), campaignId: input.campaignId ?? null, source: "generated", status: "processing" } });
    await emit({ type: "asset.updated", projectId: req.project.id, data: { id: placeholder.id } });
    const job = await enqueue("media.generateVideo", { projectId: req.project.id, input, placeholderId: placeholder.id }, { projectId: req.project.id, maxAttempts: 1 });
    return { jobId: job.id, placeholderId: placeholder.id };
  });
}
