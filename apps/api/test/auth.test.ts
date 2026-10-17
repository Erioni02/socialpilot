import { prisma } from "@sp/db";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { cookiesFrom, loginAs, OWNER, resetDatabase, seedOwner, testServer } from "./helpers";

let app: FastifyInstance;

beforeEach(async () => {
  await resetDatabase();
  await seedOwner();
  app = await testServer();
});
afterEach(() => app.close());
afterAll(() => prisma.$disconnect());

describe("auth", () => {
  it("rejects a wrong password with a generic message", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: OWNER.email, password: "wrong password!!" } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: "invalid_credentials", message: "Invalid email or password" } });
  });

  it("gives the same answer for an unknown email", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "nobody@test.dev", password: "whatever password" } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe("Invalid email or password");
  });

  it("logs in with an httpOnly session cookie and a readable CSRF cookie", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "OWNER@test.dev", password: OWNER.password } });
    expect(res.statusCode).toBe(200);
    const session = res.cookies.find((c) => c.name === "sp_session")!;
    const csrf = res.cookies.find((c) => c.name === "sp_csrf")!;
    expect(session.httpOnly).toBe(true);
    expect(session.sameSite).toBe("Lax");
    expect(csrf.httpOnly).toBeFalsy();
    expect(res.json().user.email).toBe(OWNER.email);
    const stored = await prisma.session.findFirstOrThrow();
    expect(stored.tokenHash).not.toBe(session.value);
  });

  it("returns the user and workspace from /me", async () => {
    const s = await loginAs(app);
    const res = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: s.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ user: { email: OWNER.email }, workspace: { emergencyStop: false } });
  });

  it("returns 401 from /me without a session", async () => {
    expect((await app.inject({ method: "GET", url: "/api/auth/me" })).statusCode).toBe(401);
  });

  it("returns 401 for an expired session", async () => {
    const s = await loginAs(app);
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: s.cookie } })).statusCode).toBe(401);
  });

  it("rejects a mutating request without the CSRF header", async () => {
    const s = await loginAs(app);
    const res = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: s.cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("csrf");
  });

  it("logs out and deletes the session", async () => {
    const s = await loginAs(app);
    const res = await app.inject({ method: "POST", url: "/api/auth/logout", headers: s.headers });
    expect(res.statusCode).toBe(204);
    expect(await prisma.session.count()).toBe(0);
    expect(cookiesFrom(res).sp_session).toBe("");
  });

  it("rate-limits login attempts", async () => {
    const limited = await testServer({ loginRateLimit: 5 });
    const attempt = () => limited.inject({ method: "POST", url: "/api/auth/login", payload: { email: OWNER.email, password: "wrong password!!" } });
    for (let i = 0; i < 5; i++) expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(429);
    await limited.close();
  });

  it("reports health", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.json()).toEqual({ ok: true, db: true });
  });

  it("serves OpenAPI docs", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs/json" });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().paths)).toContain("/api/auth/login");
  });
});
