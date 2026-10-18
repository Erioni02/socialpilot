import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { badRequest } from "@socialpilot/core";
import type { Project, User } from "@socialpilot/db";

declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
    sessionId: string | null;
    project: Project;
  }
}

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    throw badRequest(
      r.error.issues[0] ? `${r.error.issues[0].path.join(".") || "input"}: ${r.error.issues[0].message}` : "Invalid input",
      r.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return r.data;
}

export function userOf(req: FastifyRequest): User {
  if (!req.user) throw Object.assign(new Error("Not signed in"), { statusCode: 401 });
  return req.user;
}

export const idParam = z.object({ projectId: z.string().min(1).max(40) });

export function sendCsv(reply: FastifyReply, name: string, rows: Record<string, unknown>[]) {
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  reply.header("content-type", "text/csv").header("content-disposition", `attachment; filename="${name}.csv"`);
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
