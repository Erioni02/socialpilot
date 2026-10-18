import { prisma, Prisma } from "@socialpilot/db";
import { badRequest, createLogger } from "@socialpilot/core";
import { accountFeed, instagramPostByUrl, parseSocialUrl, postFromFeed, profileByUrl, RapidStatsError, type MetricKey, type MetricValue, type RapidQuota } from "@socialpilot/integrations";
import { z } from "zod";
import { getApiKey } from "../infra/credentials";
import { audit } from "../infra/audit";

/**
 * Budget guard for the RapidAPI "Instagram Statistics API". Every response carries the plan's quota headers; we store
 * them and never let automatic use exceed the user's monthly budget (default 45 of the Basic plan's 50, keeping a
 * reserve for manual lookups). On paid plans with overage, the same budget prevents surprise charges.
 */

const log = createLogger("rapidapi");
const SETTINGS = "rapidapi:stats";
const STATE = "rapidapi:state";
/** Requests kept free for manual lookups; automatic tracking stops before touching them. */
export const RAPID_RESERVE = 5;
/** Snapshot ages (hours after posting) for automatic Instagram/X post tracking. */
export const RAPID_MILESTONES_H = [24, 72, 168];

export const rapidSettingsSchema = z.object({
  monthlyBudget: z.number().int().min(1).max(1_000_000).default(45),
  autoTracking: z.boolean().default(true),
});
export type RapidSettings = z.infer<typeof rapidSettingsSchema>;

type State = { quota?: RapidQuota & { at: string }; cycle?: { start: string; used: number }; cids?: Record<string, string> };

async function getRow<T>(userId: string, provider: string, fallback: T): Promise<T> {
  const r = await prisma.providerSetting.findUnique({ where: { userId_provider: { userId, provider } } });
  return (r?.settings as T) ?? fallback;
}
async function setRow(userId: string, provider: string, value: unknown) {
  await prisma.providerSetting.upsert({ where: { userId_provider: { userId, provider } }, update: { settings: value as Prisma.InputJsonValue }, create: { userId, provider, settings: value as Prisma.InputJsonValue } });
}

export async function getRapidSettings(userId: string): Promise<RapidSettings> {
  const parsed = rapidSettingsSchema.safeParse(await getRow(userId, SETTINGS, {}));
  return parsed.success ? parsed.data : rapidSettingsSchema.parse({});
}
export async function saveRapidSettings(userId: string, input: unknown) {
  const s = rapidSettingsSchema.parse(input);
  await setRow(userId, SETTINGS, s);
  await audit({ userId, actor: "user", action: "rapidapi.settings", target: "rapidapi", details: s });
  return s;
}

/** Requests used in the current monthly cycle — from the provider's own counter when known, else our log. */
async function usage(userId: string) {
  const st = await getRow<State>(userId, STATE, {});
  const q = st.quota;
  const resetAt = q?.resetInSec != null ? new Date(new Date(q.at).getTime() + q.resetInSec * 1000) : null;
  const fresh = resetAt && resetAt.getTime() > Date.now();
  if (fresh && q?.limit != null && q.remaining != null) return { used: q.limit - q.remaining, limit: q.limit, remaining: q.remaining, resetAt, hardLimit: q.hardLimit, source: "provider" as const };
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const used = await prisma.auditLog.count({ where: { userId, action: "rapidapi.request", createdAt: { gte: start } } });
  return { used, limit: q?.limit ?? null, remaining: q?.limit != null ? Math.max(0, q.limit - used) : null, resetAt, hardLimit: q?.hardLimit ?? null, source: "local" as const };
}

export async function rapidStatus(userId: string) {
  const [key, settings, u] = await Promise.all([getApiKey(userId, "rapidapi"), getRapidSettings(userId), usage(userId)]);
  const budgetLeft = Math.max(0, Math.min(settings.monthlyBudget - u.used, u.remaining ?? Infinity));
  return { configured: !!key, settings, used: u.used, limit: u.limit, remaining: u.remaining, resetAt: u.resetAt, hardLimit: u.hardLimit, budgetLeft: Number.isFinite(budgetLeft) ? budgetLeft : settings.monthlyBudget, quotaSource: u.source };
}

/** Throws when a request would exceed the budget. `automatic` calls also keep the reserve untouched. */
export async function assertRapidBudget(userId: string, requests: number, automatic = false) {
  const s = await rapidStatus(userId);
  if (!s.configured) throw badRequest("Add your RapidAPI key in Settings → Data sources first.");
  const left = s.budgetLeft - (automatic ? RAPID_RESERVE : 0);
  if (left < requests) throw badRequest(automatic ? "Automatic RapidAPI tracking paused: monthly budget reached (reserve kept for manual lookups)." : `Your RapidAPI budget for this month is used up (${s.used}/${s.settings.monthlyBudget}). Raise it in Social Intel → RapidAPI or wait for the monthly reset.`);
  return s;
}

/** Stores the quota headers from a response and logs the request (one audit row per request). */
export async function recordRapidUse(userId: string, quota: RapidQuota | undefined, what: string, details: Record<string, unknown> = {}) {
  const st = await getRow<State>(userId, STATE, {});
  if (quota && (quota.limit != null || quota.remaining != null)) st.quota = { ...quota, at: new Date().toISOString() };
  await setRow(userId, STATE, st);
  await audit({ userId, actor: details.automatic ? "system" : "user", action: "rapidapi.request", target: what, details: { ...details, remaining: quota?.remaining } });
}

async function rapidKey(userId: string) {
  const key = await getApiKey(userId, "rapidapi");
  if (!key) throw badRequest("Add your RapidAPI key in Settings → Data sources first.");
  return key;
}

/** Account id (cid) for a profile URL, cached so it only costs a request once. */
async function cidFor(userId: string, key: string, profileUrl: string, automatic: boolean) {
  const st = await getRow<State>(userId, STATE, {});
  const cached = st.cids?.[profileUrl.toLowerCase()];
  if (cached) return cached;
  await assertRapidBudget(userId, 2, automatic);
  try {
    const r = await profileByUrl(key, profileUrl, true);
    await recordRapidUse(userId, r.quota, "profile", { url: profileUrl, automatic });
    const cid = r.data?.cid as string | undefined;
    if (!cid) throw badRequest("The statistics API doesn't have this account yet.");
    const fresh = await getRow<State>(userId, STATE, {});
    fresh.cids = { ...(fresh.cids ?? {}), [profileUrl.toLowerCase()]: cid };
    await setRow(userId, STATE, fresh);
    return cid;
  } catch (e) {
    if (e instanceof RapidStatsError) await recordRapidUse(userId, e.quota, "profile", { url: profileUrl, automatic, error: e.message });
    throw e;
  }
}

type Metrics = Partial<Record<MetricKey, MetricValue>>;

/** Live metrics for one posted Instagram or X post (1 request; X may need 1 more the first time for the account id). */
export async function rapidPostMetrics(userId: string, postUrl: string, opts: { automatic: boolean; publishedAt?: Date }): Promise<{ metrics: Metrics; source: string }> {
  const parsed = parseSocialUrl(postUrl);
  const key = await rapidKey(userId);
  if (parsed.platform === "instagram") {
    await assertRapidBudget(userId, 1, opts.automatic);
    try {
      const r = await instagramPostByUrl(key, parsed.url);
      await recordRapidUse(userId, r.quota, "instagram_post", { url: parsed.url, automatic: opts.automatic });
      const m: Metrics = {};
      for (const k of ["views", "likes", "comments"] as const) if (typeof r.data?.[k] === "number" && r.data[k] >= 0) m[k] = { value: r.data[k] };
      return { metrics: m, source: "Instagram Statistics API (RapidAPI, live)" };
    } catch (e) {
      if (e instanceof RapidStatsError) await recordRapidUse(userId, e.quota, "instagram_post", { url: parsed.url, automatic: opts.automatic, error: e.message });
      throw e;
    }
  }
  if (parsed.platform === "x" && parsed.handle) {
    const cid = await cidFor(userId, key, `https://twitter.com/${parsed.handle}`, opts.automatic);
    await assertRapidBudget(userId, 1, opts.automatic);
    const from = new Date((opts.publishedAt ?? new Date()).getTime() - 2 * 86400_000);
    try {
      const r = await accountFeed(key, cid, from, new Date());
      await recordRapidUse(userId, r.quota, "x_feed", { url: parsed.url, automatic: opts.automatic });
      const hit = (r.data?.posts ?? []).find((p: any) => String(p.postID) === parsed.externalId || String(p.postUrl ?? "").includes(parsed.externalId));
      if (!hit) throw badRequest("The statistics API hasn't collected this post yet (it updates accounts on its own schedule). Try again later.");
      return { metrics: postFromFeed(hit).metrics, source: "Instagram Statistics API (RapidAPI, account feed)" };
    } catch (e) {
      if (e instanceof RapidStatsError) await recordRapidUse(userId, e.quota, "x_feed", { url: parsed.url, automatic: opts.automatic, error: e.message });
      throw e;
    }
  }
  throw badRequest("RapidAPI post metrics are used for Instagram and X posts (TikTok is tracked for free).");
}

/** Next due milestone for automatic tracking, or null. */
export function dueRapidMilestone(publishedAt: Date, done: number[], now = Date.now()) {
  const ageH = (now - publishedAt.getTime()) / 3600_000;
  return RAPID_MILESTONES_H.find((m) => ageH >= m && !done.includes(m)) ?? null;
}

export { log as rapidLog };
