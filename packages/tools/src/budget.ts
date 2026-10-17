import { prisma } from "@sp/db";
import type { Policy } from "@sp/shared";

export type SpendSummary = { todayAiUsd: number; monthAiUsd: number; todayMediaUsd: number };

export async function spendSummary(projectId: string, now = new Date()): Promise<SpendSummary> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const sum = async (category: "ai" | "media", since: Date) =>
    (await prisma.spendLedger.aggregate({ where: { projectId, category, at: { gte: since } }, _sum: { amountUsd: true } }))._sum.amountUsd ?? 0;
  const [todayAiUsd, monthAiUsd, todayMediaUsd] = await Promise.all([sum("ai", dayStart), sum("ai", monthStart), sum("media", dayStart)]);
  return { todayAiUsd, monthAiUsd, todayMediaUsd };
}

/** Refuses a call whose estimated cost would push today's or this month's spend over the policy budget (UTC days). */
export async function checkBudget(projectId: string, estimateUsd: number, category: "ai" | "media", policy: Policy): Promise<{ ok: boolean; reason?: string }> {
  if (estimateUsd <= 0) return { ok: true };
  const spend = await spendSummary(projectId);
  if (category === "media") {
    return spend.todayMediaUsd + estimateUsd > policy.budget.dailyMediaUsd
      ? { ok: false, reason: `Daily media budget $${policy.budget.dailyMediaUsd} would be exceeded` }
      : { ok: true };
  }
  if (spend.todayAiUsd + estimateUsd > policy.budget.dailyAiUsd) return { ok: false, reason: `Daily AI budget $${policy.budget.dailyAiUsd} would be exceeded` };
  if (spend.monthAiUsd + estimateUsd > policy.budget.monthlyAiUsd) return { ok: false, reason: `Monthly AI budget $${policy.budget.monthlyAiUsd} would be exceeded` };
  return { ok: true };
}
