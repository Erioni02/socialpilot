import { prisma } from "@sp/db";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginAs, resetDatabase, seedOwner, testServer } from "./helpers";

let app: FastifyInstance;

beforeEach(async () => {
  await resetDatabase();
  app = await testServer();
});
afterEach(() => app.close());
afterAll(() => prisma.$disconnect());

describe("workspace isolation", () => {
  it("never exposes another workspace's project, tasks or approvals", async () => {
    await seedOwner("a@test.dev", "password-for-a-123");
    await seedOwner("b@test.dev", "password-for-b-123");
    const a = await loginAs(app, "a@test.dev", "password-for-a-123");
    const b = await loginAs(app, "b@test.dev", "password-for-b-123");
    const project = (await app.inject({ method: "POST", url: "/api/projects", headers: b.headers, payload: { name: "B's", websiteUrl: "example.com" } })).json();
    const { taskId } = (await app.inject({ method: "POST", url: `/api/projects/${project.id}/analyze`, headers: b.headers })).json();

    for (const path of ["", "/brand-profile", "/brand-profile/versions", "/website", "/integrations", "/policy", "/tasks", "/approvals", "/audit"]) {
      const res = await app.inject({ method: "GET", url: `/api/projects/${project.id}${path}`, headers: a.headers });
      expect(res.statusCode, path).toBe(404);
    }
    expect((await app.inject({ method: "GET", url: `/api/tasks/${taskId}`, headers: a.headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/tasks/${taskId}/cancel`, headers: a.headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/projects/${project.id}/analyze`, headers: a.headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/projects", headers: a.headers })).json()).toEqual([]);
  });
});
