import { prisma, type Prisma, type Project } from "@sp/db";
import { defaultPolicy, INTEGRATIONS, normalizeSiteUrl, type WebsiteIssue } from "@sp/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import sharp from "sharp";
import { z } from "zod";
import { authOf } from "../auth/guard";
import { badRequest, notFound } from "../errors";
import { getStorage } from "../storage";
import { ProjectParams, projectScope } from "./scope";

const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "project";

async function uniqueSlug(workspaceId: string, name: string) {
  const base = slugify(name);
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!(await prisma.project.findFirst({ where: { workspaceId, slug }, select: { id: true } }))) return slug;
  }
}

export function toProjectDTO(p: Project) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    websiteUrl: p.websiteUrl,
    status: p.status,
    hasLogo: Boolean(p.logoUrl),
    wizardStep: p.wizardStep,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString()
  };
}

const websiteUrl = z
  .string()
  .max(500)
  .transform((value, ctx) => {
    try {
      return normalizeSiteUrl(value).startUrl;
    } catch (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message });
      return z.NEVER;
    }
  });

const LOGO_FORMATS = new Set(["png", "jpeg", "webp", "gif"]);

export const projectRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/projects", { schema: { tags: ["projects"] } }, async (request) => {
    const { workspaceId } = authOf(request);
    const projects = await prisma.project.findMany({
      where: { workspaceId, status: { not: "archived" } },
      orderBy: { updatedAt: "desc" },
      include: { websiteSnapshots: { orderBy: { fetchedAt: "desc" }, take: 1 } }
    });
    return projects.map(({ websiteSnapshots, ...p }) => {
      const snap = websiteSnapshots[0];
      return {
        ...toProjectDTO(p),
        latestSnapshot: snap ? { httpStatus: snap.httpStatus, responseMs: snap.responseMs, fetchedAt: snap.fetchedAt.toISOString(), issueCount: (snap.issues as unknown[]).length } : null
      };
    });
  });

  app.post(
    "/projects",
    { schema: { tags: ["projects"], body: z.object({ name: z.string().trim().min(1).max(80), websiteUrl: websiteUrl.optional() }) } },
    async (request, reply) => {
      const { workspaceId, userId } = authOf(request);
      const slug = await uniqueSlug(workspaceId, request.body.name);
      const policy = defaultPolicy();
      const project = await prisma.project.create({
        data: {
          workspaceId,
          name: request.body.name,
          slug,
          websiteUrl: request.body.websiteUrl,
          policy: { create: { autonomyLevel: policy.autonomyLevel, permissions: policy.permissions, budget: policy.budget, limits: policy.limits } },
          integrations: { create: INTEGRATIONS.map((i) => ({ provider: i.key })) }
        }
      });
      await prisma.auditLog.create({ data: { workspaceId, projectId: project.id, actorType: "user", actorId: userId, action: "project.create", argsRedacted: { name: project.name }, outcome: "succeeded" } });
      return reply.code(201).send(toProjectDTO(project));
    }
  );

  app.get("/projects/:id", { schema: { tags: ["projects"], params: ProjectParams } }, async (request) => toProjectDTO((await projectScope(request)).project));

  app.patch(
    "/projects/:id",
    {
      schema: {
        tags: ["projects"],
        params: ProjectParams,
        body: z.object({
          name: z.string().trim().min(1).max(80).optional(),
          websiteUrl: websiteUrl.optional(),
          wizardStep: z.number().int().min(1).max(8).optional(),
          status: z.enum(["draft", "active"]).optional()
        })
      }
    },
    async (request) => {
      const { project } = await projectScope(request);
      return toProjectDTO(await prisma.project.update({ where: { id: project.id }, data: request.body }));
    }
  );

  app.delete("/projects/:id", { schema: { tags: ["projects"], params: ProjectParams } }, async (request, reply) => {
    const { project, auth } = await projectScope(request);
    await prisma.project.update({ where: { id: project.id }, data: { status: "archived" } });
    await prisma.auditLog.create({ data: { workspaceId: auth.workspaceId, projectId: project.id, actorType: "user", actorId: auth.userId, action: "project.archive", outcome: "succeeded" } });
    return reply.code(204).send();
  });

  app.get("/projects/:id/integrations", { schema: { tags: ["integrations"], params: ProjectParams } }, async (request) => {
    const { project } = await projectScope(request);
    const rows = await prisma.integration.findMany({ where: { projectId: project.id } });
    return INTEGRATIONS.map((info) => {
      const row = rows.find((r) => r.provider === info.key);
      return {
        ...info,
        status: row?.status ?? "not_connected",
        accountLabel: row?.accountLabel ?? null,
        scopes: row?.scopes ?? [],
        lastSyncAt: row?.lastSyncAt?.toISOString() ?? null,
        lastError: row?.lastError ?? null
      };
    });
  });

  app.get("/projects/:id/website", { schema: { tags: ["website"], params: ProjectParams } }, async (request) => {
    const { project } = await projectScope(request);
    const snap = await prisma.websiteSnapshot.findFirst({ where: { projectId: project.id }, orderBy: { fetchedAt: "desc" } });
    if (!snap) return null;
    return {
      id: snap.id,
      rootUrl: snap.rootUrl,
      fetchedAt: snap.fetchedAt.toISOString(),
      httpStatus: snap.httpStatus,
      responseMs: snap.responseMs,
      sitemapFound: snap.sitemapFound,
      robotsTxtFound: snap.robotsTxt !== null,
      pages: (snap.pages as { url: string; title: string; httpStatus: number; wordCount: number }[]).map((p) => ({ url: p.url, title: p.title, httpStatus: p.httpStatus, wordCount: p.wordCount })),
      issues: snap.issues as WebsiteIssue[],
      brokenLinks: snap.brokenLinks as Prisma.JsonArray
    };
  });

  app.post("/projects/:id/logo", { schema: { tags: ["projects"], params: ProjectParams } }, async (request) => {
    const { project } = await projectScope(request);
    const file = await request.file();
    if (!file) throw badRequest("no_file", "Attach an image file.");
    const input = await file.toBuffer(); // throws 413 past the multipart size limit
    const meta = await sharp(input)
      .metadata()
      .catch(() => null);
    if (!meta?.format || !LOGO_FORMATS.has(meta.format)) throw badRequest("invalid_image", "Upload a PNG, JPEG, WebP or GIF image.");
    const png = await sharp(input, { animated: false }).resize(512, 512, { fit: "inside", withoutEnlargement: false }).png().toBuffer();
    const key = `projects/${project.id}/logo.png`;
    await getStorage().put(key, png, "image/png");
    await prisma.project.update({ where: { id: project.id }, data: { logoUrl: key } });
    return { ok: true };
  });

  app.get("/projects/:id/logo", { schema: { tags: ["projects"], params: ProjectParams } }, async (request, reply) => {
    const { project } = await projectScope(request);
    const data = project.logoUrl ? await getStorage().get(project.logoUrl) : null;
    if (!data) throw notFound("No logo");
    return reply.header("content-type", "image/png").header("cache-control", "private, max-age=60").send(data);
  });
};
