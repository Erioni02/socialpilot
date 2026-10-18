import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "@socialpilot/db";
import { buildApp } from "../src/app";

let app: FastifyInstance;

async function registerUser(tag: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: { "x-socialpilot-csrf": "1" },
    payload: { email: `${tag}-${Date.now()}@example.test`, password: "correct horse battery", name: tag },
  });
  expect(res.statusCode).toBe(200);
  const cookie = String(res.headers["set-cookie"]).split(";")[0];
  return { cookie, user: res.json().user };
}

const req = (cookie: string) => ({ "x-socialpilot-csrf": "1", cookie });

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("auth & CSRF", () => {
  it("rejects state-changing requests without the CSRF header", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "a@b.co", password: "x" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("csrf");
  });
  it("rejects cross-origin mutations", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/login", headers: { "x-socialpilot-csrf": "1", origin: "https://evil.example" }, payload: { email: "a@b.co", password: "x" } });
    expect(res.statusCode).toBe(403);
  });
  it("requires a session for protected routes", async () => {
    expect((await app.inject({ method: "GET", url: "/api/projects" })).statusCode).toBe(401);
  });
  it("rejects wrong passwords with a generic message", async () => {
    const { user } = await registerUser("pw");
    const res = await app.inject({ method: "POST", url: "/api/auth/login", headers: { "x-socialpilot-csrf": "1" }, payload: { email: user.email, password: "wrong password!" } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Invalid email or password");
  });
});

describe("projects", () => {
  it("isolates projects between users", async () => {
    const a = await registerUser("owner");
    const b = await registerUser("intruder");
    const created = await app.inject({ method: "POST", url: "/api/projects", headers: req(a.cookie), payload: { name: "VibeJudge", websiteUrl: "vibejudge.app" } });
    expect(created.statusCode).toBe(200);
    const project = created.json().project;
    expect(project.websiteUrl).toBe("https://vibejudge.app");
    for (const url of [`/api/projects/${project.id}`, `/api/projects/${project.id}/posts`, `/api/projects/${project.id}/dashboard`, `/api/projects/${project.id}/integrations`]) {
      const res = await app.inject({ method: "GET", url, headers: req(b.cookie) });
      expect(res.statusCode, url).toBe(404);
    }
    const list = await app.inject({ method: "GET", url: "/api/projects", headers: req(b.cookie) });
    expect(list.json().projects).toHaveLength(0);
  });

  it("requires a typed confirmation to raise autonomy and to disable approvals", async () => {
    const a = await registerUser("autonomy");
    const project = (await app.inject({ method: "POST", url: "/api/projects", headers: req(a.cookie), payload: { name: "Autopilot" } })).json().project;
    const raise = await app.inject({ method: "PUT", url: `/api/projects/${project.id}/policy`, headers: req(a.cookie), payload: { autonomyLevel: 4 } });
    expect(raise.statusCode).toBe(428);
    expect(raise.json().details.phrase).toBe("ENABLE LEVEL 4");
    const ok = await app.inject({ method: "PUT", url: `/api/projects/${project.id}/policy`, headers: req(a.cookie), payload: { autonomyLevel: 4, confirmation: "ENABLE LEVEL 4" } });
    expect(ok.statusCode).toBe(200);
    const disable = await app.inject({ method: "PUT", url: `/api/projects/${project.id}/policy`, headers: req(a.cookie), payload: { autonomyLevel: 4, approvals: { publish: false } } });
    expect(disable.statusCode).toBe(428);
    const audits = await prisma.auditLog.count({ where: { projectId: project.id, action: "policy.updated" } });
    expect(audits).toBe(1);
  });

  it("validates input", async () => {
    const a = await registerUser("validate");
    const res = await app.inject({ method: "POST", url: "/api/projects", headers: req(a.cookie), payload: { name: "" } });
    expect(res.statusCode).toBe(400);
  });

  it("never returns stored secrets", async () => {
    const a = await registerUser("secrets");
    const put = await app.inject({ method: "PUT", url: "/api/providers/anthropic", headers: req(a.cookie), payload: { apiKey: "sk-ant-test-0123456789abcdef" } });
    expect(put.statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: "/api/providers", headers: req(a.cookie) });
    const body = list.body;
    expect(body).not.toContain("0123456789abcdef");
    expect(list.json().providers.find((p: any) => p.provider === "anthropic").hint).toBe("…cdef");
    const row = await prisma.providerCredential.findFirstOrThrow({ where: { userId: a.user.id, provider: "anthropic" } });
    expect(row.secretEnc).not.toContain("sk-ant");
  });

  it("rejects SSRF targets for website analysis-style inputs", async () => {
    const a = await registerUser("ssrf");
    const project = (await app.inject({ method: "POST", url: "/api/projects", headers: req(a.cookie), payload: { name: "SSRF" } })).json().project;
    const res = await app.inject({ method: "POST", url: `/api/projects/${project.id}/integrations/public-profile`, headers: req(a.cookie), payload: { url: "http://169.254.169.254/" } });
    expect(res.statusCode).toBe(400);
  });

  it("uploads only allowed file types by magic bytes", async () => {
    const a = await registerUser("upload");
    const project = (await app.inject({ method: "POST", url: "/api/projects", headers: req(a.cookie), payload: { name: "Uploads" } })).json().project;
    const boundary = "----sp";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="evil.png"\r\nContent-Type: image/png\r\n\r\n`),
      Buffer.from("<script>alert(1)</script>"),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({ method: "POST", url: `/api/projects/${project.id}/assets/upload`, headers: { ...req(a.cookie), "content-type": `multipart/form-data; boundary=${boundary}` }, payload: body });
    expect(res.statusCode).toBe(400);
  });

  it("rejects forged public media signatures", async () => {
    const res = await app.inject({ method: "GET", url: "/public/media/abc/2026-10/x.png?exp=9999999999&sig=forged" });
    expect(res.statusCode).toBe(403);
  });
});
