import { z } from "zod";

/** Granular permissions a project can grant to its AI agents and automations. */
export const PERMISSIONS = [
  "readAccountData",
  "createContent",
  "editAssets",
  "schedule",
  "publish",
  "reply",
  "editCode",
  "mergeCode",
  "deploy",
  "spendMoney",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, { label: string; description: string }> = {
  readAccountData: { label: "Read account data", description: "Read metrics, posts, comments and analytics from connected accounts." },
  createContent: { label: "Create content", description: "Create and edit drafts, campaigns and notes." },
  editAssets: { label: "Edit assets", description: "Generate and edit images, videos and other media." },
  schedule: { label: "Schedule", description: "Place approved content on the calendar." },
  publish: { label: "Publish", description: "Publish content to connected social accounts." },
  reply: { label: "Reply", description: "Send replies to comments and mentions." },
  editCode: { label: "Edit website code", description: "Create branches, commit changes and open pull requests." },
  mergeCode: { label: "Merge code", description: "Merge pull requests into the default branch." },
  deploy: { label: "Deploy", description: "Promote deployments to production." },
  spendMoney: { label: "Spend money", description: "Call paid AI/media APIs within budget limits." },
};

export const AUTONOMY_LEVELS = [1, 2, 3, 4] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const AUTONOMY_LABELS: Record<AutonomyLevel, { name: string; description: string }> = {
  1: { name: "Assistant", description: "Analyzes information and recommends actions. Cannot create or change anything." },
  2: { name: "Creator", description: "Creates and edits content, images, videos and drafts." },
  3: { name: "Marketing operator", description: "Schedules content and performs specifically authorized social actions (with approvals)." },
  4: { name: "Controlled autopilot", description: "Researches, creates, schedules, publishes and replies within configured limits." },
};

/** The maximum set of permissions each autonomy level can unlock. Granular toggles narrow this further. */
export const LEVEL_CEILING: Record<AutonomyLevel, Permission[]> = {
  1: ["readAccountData"],
  2: ["readAccountData", "createContent", "editAssets", "spendMoney", "editCode"],
  3: ["readAccountData", "createContent", "editAssets", "spendMoney", "editCode", "schedule", "publish", "reply"],
  4: ["readAccountData", "createContent", "editAssets", "spendMoney", "editCode", "schedule", "publish", "reply", "mergeCode", "deploy"],
};

/** Action categories that may require a human approval before they execute. */
export const APPROVAL_CATEGORIES = ["publish", "reply", "merge", "deploy", "spendOverBudget"] as const;
export type ApprovalCategory = (typeof APPROVAL_CATEGORIES)[number];

export const policyLimitsSchema = z.object({
  dailyPosts: z.number().int().min(0).max(200).default(5),
  dailyReplies: z.number().int().min(0).max(500).default(20),
  dailyAiSpendUsd: z.number().min(0).max(10000).default(5),
  monthlyAiSpendUsd: z.number().min(0).max(100000).default(50),
  taskBudgetUsd: z.number().min(0).max(1000).default(2),
  publishHours: z
    .object({ start: z.number().int().min(0).max(23), end: z.number().int().min(1).max(24) })
    .default({ start: 8, end: 21 }),
  allowedTopics: z.array(z.string().max(80)).max(50).default([]),
  blockedTopics: z.array(z.string().max(80)).max(50).default([]),
});
export type PolicyLimits = z.infer<typeof policyLimitsSchema>;

export const policySchema = z.object({
  autonomyLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(2),
  permissions: z.record(z.enum(PERMISSIONS), z.boolean()).default({}),
  approvals: z.record(z.enum(APPROVAL_CATEGORIES), z.boolean()).default({}),
  limits: policyLimitsSchema.default({}),
  autoReplyCategories: z.array(z.string()).default([]),
});
export type Policy = z.infer<typeof policySchema>;

export const DEFAULT_PERMISSIONS: Record<Permission, boolean> = {
  readAccountData: true,
  createContent: true,
  editAssets: true,
  schedule: false,
  publish: false,
  reply: false,
  editCode: false,
  mergeCode: false,
  deploy: false,
  spendMoney: true,
};

export const DEFAULT_APPROVALS: Record<ApprovalCategory, boolean> = {
  publish: true,
  reply: true,
  merge: true,
  deploy: true,
  spendOverBudget: true,
};

export function normalizePolicy(raw: unknown): Policy {
  const parsed = policySchema.parse(raw ?? {});
  return {
    ...parsed,
    permissions: { ...DEFAULT_PERMISSIONS, ...parsed.permissions },
    approvals: { ...DEFAULT_APPROVALS, ...parsed.approvals },
  };
}

export type PermissionDecision =
  | { allowed: true; requiresApproval: boolean; reason?: string }
  | { allowed: false; requiresApproval: false; reason: string };

const APPROVAL_FOR: Partial<Record<Permission, ApprovalCategory>> = {
  publish: "publish",
  reply: "reply",
  mergeCode: "merge",
  deploy: "deploy",
};

/**
 * Pure permission check used by every server-side tool and job.
 * A permission is effective only if the autonomy level allows it AND the granular toggle is on.
 * Outbound actions additionally consult the approval rules; below level 4 approvals are always enforced.
 */
export function checkPermission(policy: Policy, permission: Permission): PermissionDecision {
  const level = policy.autonomyLevel as AutonomyLevel;
  if (!LEVEL_CEILING[level].includes(permission)) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: `Autonomy level ${level} (${AUTONOMY_LABELS[level].name}) does not allow "${PERMISSION_LABELS[permission].label}".`,
    };
  }
  if (!policy.permissions[permission]) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: `The "${PERMISSION_LABELS[permission].label}" permission is disabled for this project.`,
    };
  }
  const category = APPROVAL_FOR[permission];
  if (!category) return { allowed: true, requiresApproval: false };
  const approvalOn = policy.approvals[category] !== false;
  // Approvals can only be bypassed at Controlled autopilot.
  const requiresApproval = level < 4 ? true : approvalOn;
  return { allowed: true, requiresApproval };
}

export function effectivePermissions(policy: Policy): Record<Permission, PermissionDecision> {
  return Object.fromEntries(PERMISSIONS.map((p) => [p, checkPermission(policy, p)])) as Record<Permission, PermissionDecision>;
}

/** Phrase the user must type to raise autonomy. Not exposed to agents as a tool. */
export function autonomyConfirmationPhrase(level: AutonomyLevel): string {
  return `ENABLE LEVEL ${level}`;
}

export function isWithinPublishHours(limits: PolicyLimits, date: Date, timeZone: string): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(date),
  );
  const { start, end } = limits.publishHours;
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}
