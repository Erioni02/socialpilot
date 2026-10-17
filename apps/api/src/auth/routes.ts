import { prisma } from "@sp/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HttpError } from "../errors";
import { authOf, requireAuth } from "./guard";
import { createSession, CSRF_COOKIE, destroySession, newToken, SESSION_COOKIE, verifyLogin } from "./session";

const UserDTO = z.object({ id: z.string(), email: z.string(), name: z.string() });
const WorkspaceDTO = z.object({ id: z.string(), name: z.string(), emergencyStop: z.boolean() });

export const authRoutes = (opts: { loginRateLimit: number; secureCookies: boolean }): FastifyPluginAsyncZod =>
  async (app) => {
    const cookieBase = { path: "/", sameSite: "lax" as const, secure: opts.secureCookies };

    app.post(
      "/auth/login",
      {
        config: { rateLimit: { max: opts.loginRateLimit, timeWindow: "1 minute" } },
        schema: {
          tags: ["auth"],
          body: z.object({ email: z.string().email().max(200), password: z.string().min(1).max(500) }),
          response: { 200: z.object({ user: UserDTO }) }
        }
      },
      async (request, reply) => {
        const user = await verifyLogin(request.body.email, request.body.password);
        if (!user) throw new HttpError(401, "invalid_credentials", "Invalid email or password");
        const { token, expiresAt } = await createSession(user.id, { ip: request.ip, userAgent: request.headers["user-agent"] });
        reply.setCookie(SESSION_COOKIE, token, { ...cookieBase, httpOnly: true, expires: expiresAt });
        reply.setCookie(CSRF_COOKIE, newToken(), { ...cookieBase, httpOnly: false, expires: expiresAt });
        return { user: { id: user.id, email: user.email, name: user.name } };
      }
    );

    app.post("/auth/logout", { schema: { tags: ["auth"] } }, async (request, reply) => {
      await destroySession(request.cookies[SESSION_COOKIE]);
      reply.clearCookie(SESSION_COOKIE, cookieBase).clearCookie(CSRF_COOKIE, cookieBase);
      return reply.code(204).send();
    });

    app.get(
      "/auth/me",
      { preHandler: requireAuth, schema: { tags: ["auth"], response: { 200: z.object({ user: UserDTO, workspace: WorkspaceDTO }) } } },
      async (request) => {
        const auth = authOf(request);
        const [user, workspace] = await Promise.all([
          prisma.user.findUniqueOrThrow({ where: { id: auth.userId } }),
          prisma.workspace.findUniqueOrThrow({ where: { id: auth.workspaceId } })
        ]);
        return { user: { id: user.id, email: user.email, name: user.name }, workspace: { id: workspace.id, name: workspace.name, emergencyStop: workspace.emergencyStop } };
      }
    );
  };
