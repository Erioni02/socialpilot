import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { hash, verify } from "@node-rs/argon2";
import { prisma } from "@socialpilot/db";
import { config, isProd, randomToken, sha256 } from "@socialpilot/core";

export const SESSION_COOKIE = "sp_session";
const SESSION_DAYS = 30;

export async function hashPassword(pw: string) {
  return hash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
}
export async function verifyPassword(hashStr: string, pw: string) {
  try {
    return await verify(hashStr, pw);
  } catch {
    return false;
  }
}

export async function createSession(reply: FastifyReply, userId: string, req: FastifyRequest) {
  const token = randomToken(32);
  await prisma.session.create({
    data: { id: sha256(token), userId, expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000), ip: req.ip, userAgent: req.headers["user-agent"]?.slice(0, 300) },
  });
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: isProd, path: "/", maxAge: SESSION_DAYS * 86400 });
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export default fp(async function authPlugin(app: FastifyInstance) {
  app.decorateRequest("user", null);
  app.decorateRequest("sessionId", null);
  app.decorateRequest("project", null as any);

  app.addHook("onRequest", async (req, reply) => {
    // CSRF: state-changing API requests must carry a custom header (not settable cross-site without CORS preflight)
    // and, when present, a same-site Origin.
    if (!SAFE_METHODS.has(req.method) && req.url.startsWith("/api/") && !req.url.startsWith("/api/oauth/")) {
      if (req.headers["x-socialpilot-csrf"] !== "1") return reply.code(403).send({ error: "Missing CSRF header", code: "csrf" });
      const origin = req.headers.origin;
      if (origin) {
        const allowed = [config.APP_URL, config.API_PUBLIC_URL].map((u) => new URL(u).origin);
        if (!allowed.includes(origin)) return reply.code(403).send({ error: "Cross-origin request rejected", code: "csrf" });
      }
    }
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const id = sha256(token);
    const session = await prisma.session.findUnique({ where: { id }, include: { user: true } });
    if (!session || session.expiresAt < new Date()) return;
    req.user = session.user;
    req.sessionId = id;
    if (Date.now() - session.lastSeenAt.getTime() > 3600_000) {
      await prisma.session.update({ where: { id }, data: { lastSeenAt: new Date() } }).catch(() => {});
    }
  });

  app.decorate("requireAuth", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: "Not signed in", code: "unauthenticated" });
  });

  /** Loads :projectId and enforces ownership for every project-scoped route. */
  app.decorate("requireProject", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: "Not signed in", code: "unauthenticated" });
    const projectId = (req.params as Record<string, string>).projectId;
    const project = projectId ? await prisma.project.findFirst({ where: { id: projectId, ownerId: req.user.id } }) : null;
    if (!project) return reply.code(404).send({ error: "Project not found", code: "not_found" });
    req.project = project;
  });
});

declare module "fastify" {
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    requireProject: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  }
}
