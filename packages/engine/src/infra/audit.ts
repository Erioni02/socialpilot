import { prisma, Prisma } from "@socialpilot/db";
import { redact } from "@socialpilot/core";
import { emit } from "./events";

export interface AuditInput {
  userId?: string | null;
  projectId?: string | null;
  actor: string;
  action: string;
  target?: string;
  details?: Record<string, unknown>;
  ip?: string;
}

export async function audit(input: AuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: input.userId ?? null,
      projectId: input.projectId ?? null,
      actor: input.actor,
      action: input.action,
      target: input.target,
      details: redact(input.details ?? {}) as Prisma.InputJsonValue,
      ip: input.ip,
    },
  });
}

export async function notify(args: { userId: string; projectId?: string | null; type: string; title: string; body?: string; link?: string }) {
  const n = await prisma.notification.create({
    data: { userId: args.userId, projectId: args.projectId ?? null, type: args.type, title: args.title, body: args.body ?? "", link: args.link },
  });
  await emit({ type: "notification", userId: args.userId, projectId: args.projectId, data: { id: n.id, title: n.title } });
  return n;
}
