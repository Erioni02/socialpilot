import { prisma, type Project } from "@socialpilot/db";
import { AppError, forbidden, notFound } from "@socialpilot/core";
import { checkPermission, normalizePolicy, PERMISSION_LABELS, type Permission, type Policy } from "@socialpilot/shared";
import { audit } from "../infra/audit";

export async function getProjectForUser(userId: string, projectId: string): Promise<Project> {
  const p = await prisma.project.findFirst({ where: { id: projectId, ownerId: userId } });
  if (!p) throw notFound("Project");
  return p;
}

export function projectPolicy(project: Pick<Project, "policy">): Policy {
  return normalizePolicy(project.policy);
}

export class EmergencyStopError extends AppError {
  constructor() {
    super(423, "Emergency stop is active. Turn it off in the header to resume automated and outbound actions.", "emergency_stop");
  }
}

export async function assertNotStopped(project: Pick<Project, "ownerId" | "paused" | "name">): Promise<void> {
  const owner = await prisma.user.findUnique({ where: { id: project.ownerId }, select: { emergencyStop: true } });
  if (owner?.emergencyStop) throw new EmergencyStopError();
  if (project.paused) throw new AppError(423, `Project "${project.name}" is paused.`, "project_paused");
}

export type Actor = { kind: "user"; userId: string } | { kind: "agent"; agentType: string; taskId: string } | { kind: "automation"; automationId: string };

export function actorLabel(a: Actor): string {
  return a.kind === "user" ? "user" : a.kind === "agent" ? `agent:${a.agentType}` : `automation:${a.automationId}`;
}

/**
 * Server-side permission gate for AI agents and automations. Human users acting directly are governed by
 * project ownership, while their outbound actions still respect the emergency stop.
 * Returns whether the action must go through the approval queue.
 */
export async function guard(project: Project, permission: Permission, actor: Actor, opts: { outbound?: boolean } = {}): Promise<{ requiresApproval: boolean }> {
  if (actor.kind === "user") {
    if (opts.outbound) await assertNotStopped(project);
    return { requiresApproval: false };
  }
  await assertNotStopped(project);
  const decision = checkPermission(projectPolicy(project), permission);
  if (!decision.allowed) {
    await audit({ userId: project.ownerId, projectId: project.id, actor: actorLabel(actor), action: "permission.denied", target: permission, details: { reason: decision.reason } });
    throw forbidden(decision.reason);
  }
  return { requiresApproval: decision.requiresApproval };
}

export function permissionLabel(p: Permission) {
  return PERMISSION_LABELS[p].label;
}
