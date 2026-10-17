import { prisma } from "@sp/db";
import { defaultPolicy, type Policy } from "@sp/shared";
import type { Actor, AnyTool } from "./types";

export type Decision = { decision: "allow" | "approve" | "deny"; reason: string };

/**
 * Whether `actor` may run `tool` under `policy`.
 * - A denied capability is denied for everyone, the user included.
 * - Autonomy levels limit agents/schedules; the user acting directly is not limited by them.
 * - Approval applies to non-user actors: "always", or "policy" + the capability set to "approve".
 */
export function decide(policy: Policy, tool: AnyTool, actor: Actor): Decision {
  const mode = policy.permissions[tool.capability] ?? "deny";
  if (mode === "deny") return { decision: "deny", reason: "permission" };
  if (actor.type === "user") return { decision: "allow", reason: "user" };
  if (tool.userOnly) return { decision: "deny", reason: "user_only" };
  if (policy.autonomyLevel < tool.minAutonomy) return { decision: "deny", reason: "autonomy" };
  if (tool.approval === "always" || (tool.approval === "policy" && mode === "approve")) return { decision: "approve", reason: "approval_required" };
  return { decision: "allow", reason: "policy" };
}

/** The project's stored policy merged over the defaults (so new capabilities get safe defaults). */
export async function loadPolicy(projectId: string): Promise<Policy> {
  const base = defaultPolicy();
  const row = await prisma.projectPolicy.findUnique({ where: { projectId } });
  if (!row) return base;
  return {
    autonomyLevel: row.autonomyLevel as Policy["autonomyLevel"],
    permissions: { ...base.permissions, ...(row.permissions as object) },
    budget: { ...base.budget, ...(row.budget as object) },
    limits: { ...base.limits, ...(row.limits as object) },
    emergencyStop: row.emergencyStop
  };
}
