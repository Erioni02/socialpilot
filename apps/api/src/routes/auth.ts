import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@socialpilot/db";
import { config, AppError } from "@socialpilot/core";
import { loginSchema, registerSchema } from "@socialpilot/shared";
import { audit, emit } from "@socialpilot/engine";
import { createSession, hashPassword, SESSION_COOKIE, verifyPassword } from "../plugins/auth";
import { parse, userOf } from "../lib/http";

const publicUser = (u: { id: string; email: string; name: string; emergencyStop: boolean; createdAt: Date }) => ({ id: u.id, email: u.email, name: u.name, emergencyStop: u.emergencyStop, createdAt: u.createdAt });

export default async function authRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  app.get("/auth/config", async () => {
    const users = await prisma.user.count();
    return { registrationOpen: config.ALLOW_REGISTRATION === "true" || users === 0, firstUser: users === 0 };
  });

  app.post("/auth/register", strict, async (req, reply) => {
    const body = parse(registerSchema, req.body);
    const users = await prisma.user.count();
    if (config.ALLOW_REGISTRATION !== "true" && users > 0) throw new AppError(403, "Registration is closed on this server", "registration_closed");
    if (await prisma.user.findUnique({ where: { email: body.email } })) throw new AppError(409, "An account with this email already exists", "conflict");
    const user = await prisma.user.create({ data: { email: body.email, name: body.name, passwordHash: await hashPassword(body.password) } });
    await createSession(reply, user.id, req);
    await audit({ userId: user.id, actor: "user", action: "auth.registered", ip: req.ip });
    return { user: publicUser(user) };
  });

  app.post("/auth/login", strict, async (req, reply) => {
    const body = parse(loginSchema, req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    const ok = user ? await verifyPassword(user.passwordHash, body.password) : await verifyPassword("$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$ZmFrZWhhc2g", body.password);
    if (!user || !ok) {
      await audit({ userId: user?.id, actor: "user", action: "auth.login_failed", details: { email: body.email }, ip: req.ip });
      throw new AppError(401, "Invalid email or password", "invalid_credentials");
    }
    await createSession(reply, user.id, req);
    await audit({ userId: user.id, actor: "user", action: "auth.login", ip: req.ip });
    return { user: publicUser(user) };
  });

  app.post("/auth/logout", async (req, reply) => {
    if (req.sessionId) await prisma.session.delete({ where: { id: req.sessionId } }).catch(() => {});
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/auth/me", { preHandler: app.requireAuth }, async (req) => ({ user: publicUser(userOf(req)) }));

  app.patch("/auth/me", { preHandler: app.requireAuth }, async (req) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(100).optional(), currentPassword: z.string().optional(), newPassword: z.string().min(10).max(256).optional() }), req.body);
    const user = userOf(req);
    const data: Record<string, unknown> = {};
    if (body.name) data.name = body.name;
    if (body.newPassword) {
      if (!body.currentPassword || !(await verifyPassword(user.passwordHash, body.currentPassword))) throw new AppError(400, "Current password is incorrect", "bad_request");
      data.passwordHash = await hashPassword(body.newPassword);
      await prisma.session.deleteMany({ where: { userId: user.id, id: { not: req.sessionId! } } });
    }
    const u = await prisma.user.update({ where: { id: user.id }, data });
    return { user: publicUser(u) };
  });

  /** Global emergency stop: halts agents, automations and every outbound action for all of this user's projects. */
  app.post("/system/emergency-stop", { preHandler: app.requireAuth }, async (req) => {
    const { active } = parse(z.object({ active: z.boolean() }), req.body);
    const user = userOf(req);
    await prisma.user.update({ where: { id: user.id }, data: { emergencyStop: active } });
    if (active) {
      const projects = await prisma.project.findMany({ where: { ownerId: user.id }, select: { id: true } });
      const ids = projects.map((p) => p.id);
      await prisma.task.updateMany({ where: { projectId: { in: ids }, status: { in: ["queued", "planning", "running"] } }, data: { cancelRequested: true } });
      await prisma.job.updateMany({ where: { projectId: { in: ids }, status: "waiting", name: { in: ["agent.run", "automation.run", "publish.target", "approval.execute"] } }, data: { status: "cancelled", lastError: "Emergency stop", finishedAt: new Date() } });
    }
    await audit({ userId: user.id, actor: "user", action: active ? "emergency_stop.on" : "emergency_stop.off", ip: req.ip });
    await emit({ type: "system.emergency_stop", userId: user.id, data: { active } });
    return { emergencyStop: active };
  });
}
