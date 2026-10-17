import { z } from "zod";
import { CAPABILITIES, type Capability } from "../capabilities";

export const PermissionModeSchema = z.enum(["deny", "approve", "allow"]);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

export const PolicySchema = z.object({
  autonomyLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  permissions: z.record(z.enum(CAPABILITIES), PermissionModeSchema),
  budget: z.object({
    dailyAiUsd: z.number().min(0),
    monthlyAiUsd: z.number().min(0),
    dailyMediaUsd: z.number().min(0)
  }),
  limits: z.object({
    maxPostsPerDay: z.number().int().min(0),
    maxRepliesPerDay: z.number().int().min(0),
    publishHours: z.tuple([z.number().int().min(0).max(23), z.number().int().min(1).max(24)]),
    allowedTopics: z.array(z.string().max(80))
  }),
  emergencyStop: z.boolean().default(false)
});
export type Policy = z.infer<typeof PolicySchema>;

const APPROVE_BY_DEFAULT: Capability[] = ["social.publish", "social.reply", "code.merge", "deploy.production", "spend.media"];

export function defaultPolicy(): Policy {
  return {
    autonomyLevel: 1,
    permissions: Object.fromEntries(CAPABILITIES.map((c) => [c, APPROVE_BY_DEFAULT.includes(c) ? "approve" : "allow"])) as Record<Capability, PermissionMode>,
    budget: { dailyAiUsd: 1, monthlyAiUsd: 20, dailyMediaUsd: 0 },
    limits: { maxPostsPerDay: 3, maxRepliesPerDay: 20, publishHours: [9, 21], allowedTopics: [] },
    emergencyStop: false
  };
}
