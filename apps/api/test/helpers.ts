import { prisma, seed } from "@sp/db";
import { resetDatabase } from "@sp/db/testing";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildServer, type ServerOptions } from "../src/server";

export const OWNER = { email: "owner@test.dev", password: "correct horse battery staple" };

export async function testServer(opts: ServerOptions = {}): Promise<FastifyInstance> {
  const app = await buildServer({ logger: false, loginRateLimit: 1000, ...opts });
  await app.ready();
  return app;
}

export { resetDatabase };

export async function seedOwner(email = OWNER.email, password = OWNER.password) {
  const user = await seed({ OWNER_EMAIL: email, OWNER_PASSWORD: password });
  const member = await prisma.workspaceMember.findFirstOrThrow({ where: { userId: user.id } });
  return { user, workspaceId: member.workspaceId };
}

export type Session = { cookie: string; csrf: string; headers: Record<string, string> };

export function cookiesFrom(res: LightMyRequestResponse): Record<string, string> {
  return Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
}

export async function loginAs(app: FastifyInstance, email = OWNER.email, password = OWNER.password): Promise<Session> {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  const jar = cookiesFrom(res);
  const cookie = `sp_session=${jar.sp_session}; sp_csrf=${jar.sp_csrf}`;
  return { cookie, csrf: jar.sp_csrf!, headers: { cookie, "x-csrf-token": jar.sp_csrf! } };
}
