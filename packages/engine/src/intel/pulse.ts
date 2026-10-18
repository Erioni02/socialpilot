import { prisma, Prisma, type DiscoverItem, type Project } from "@socialpilot/db";
import { badRequest, createLogger, redactString } from "@socialpilot/core";
import {
  fetchBlueskyTrending,
  fetchGoogleTrends,
  fetchMastodonTag,
  fetchMastodonTrends,
  fetchSocialCrawlTrending,
  SOCIALCRAWL_TRENDING_CREDITS,
  type PulseItem,
  type PulsePlatform,
} from "@socialpilot/integrations";
import { z } from "zod";
import { relevance } from "../discover/service";
import { getApiKey } from "../infra/credentials";
import { audit, notify } from "../infra/audit";
import { emit } from "../infra/events";

/**
 * Social Pulse — runs every 20 minutes from the scheduler.
 * Free sources always run. Paid SocialCrawl trending feeds (TikTok, Instagram Reels) run only for users who opted in,
 * never above their daily credit cap, and at most once per interval.
 */

const log = createLogger("pulse");
export const PULSE_INTERVAL_MIN = 20;
const SETTINGS_KEY = "intel:pulse";

export const pulseSettingsSchema = z.object({
  /** Country for Google Trends (ISO code). */
  geo: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).default("US"),
  /** Notify when new trends match a project's keywords. */
  notify: z.boolean().default(true),
  /** Paid opt-in: SocialCrawl trending feeds. Off unless the user turns it on. */
  paid: z
    .object({
      enabled: z.boolean().default(false),
      platforms: z.array(z.enum(["tiktok", "instagram"])).default(["tiktok"]),
      region: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).default("US"),
      /** Hard cap of SocialCrawl credits per day (UTC). */
      dailyCreditCap: z.number().int().min(5).max(500).default(20),
      /** Minutes between paid runs (≥ 20). */
      everyMinutes: z.number().int().min(20).max(1440).default(120),
    })
    .default({}),
});
export type PulseSettings = z.infer<typeof pulseSettingsSchema>;

export async function getPulseSettings(userId: string): Promise<PulseSettings> {
  const row = await prisma.providerSetting.findUnique({ where: { userId_provider: { userId, provider: SETTINGS_KEY } } });
  const parsed = pulseSettingsSchema.safeParse(row?.settings ?? {});
  return parsed.success ? parsed.data : pulseSettingsSchema.parse({});
}

export async function savePulseSettings(userId: string, input: unknown) {
  const s = pulseSettingsSchema.parse(input);
  if (s.paid.enabled && !(await getApiKey(userId, "socialcrawl"))) throw badRequest("Add your SocialCrawl API key in Settings → Data sources before enabling paid trend crawling.");
  await prisma.providerSetting.upsert({
    where: { userId_provider: { userId, provider: SETTINGS_KEY } },
    update: { settings: s as Prisma.InputJsonValue },
    create: { userId, provider: SETTINGS_KEY, settings: s as Prisma.InputJsonValue },
  });
  await audit({ userId, actor: "user", action: "intel.pulse_settings", target: "pulse", details: { paid: s.paid } });
  return s;
}

const startOfUtcDay = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

/** Paid credits spent today, from the audit log (single source of truth for spend). */
export async function pulseCreditsToday(userId: string) {
  const rows = await prisma.auditLog.findMany({ where: { userId, action: "intel.pulse_paid", createdAt: { gte: startOfUtcDay() } }, select: { details: true, createdAt: true }, orderBy: { createdAt: "desc" } });
  return { credits: rows.reduce((s, r) => s + Number((r.details as any)?.credits ?? 0), 0), lastRunAt: rows[0]?.createdAt ?? null };
}

const LABEL: Record<PulsePlatform, string> = { bluesky: "Bluesky", mastodon: "Mastodon", google_trends: "Google Trends", tiktok: "TikTok (SocialCrawl)", instagram: "Instagram (SocialCrawl)" };

/** Upserts items, keeping the first-seen score so we can measure how fast something is rising. Returns ids of new items. */
async function store(items: PulseItem[]): Promise<string[]> {
  const created: string[] = [];
  for (const it of items) {
    if (!it.title || !/^https?:\/\//.test(it.url)) continue;
    const sourceType = `pulse:${it.platform}`;
    const externalId = it.externalId.slice(0, 500);
    const existing = await prisma.discoverItem.findUnique({ where: { sourceType_externalId: { sourceType, externalId } } });
    if (existing) {
      const prevRaw = (existing.raw ?? {}) as Record<string, unknown>;
      await prisma.discoverItem.update({
        where: { id: existing.id },
        data: { score: it.score ?? null, comments: it.comments ?? null, summary: it.summary.slice(0, 2000) || existing.summary, raw: { ...it.raw, kind: it.kind, firstScore: prevRaw.firstScore ?? existing.score ?? 0, firstSeenAt: prevRaw.firstSeenAt ?? existing.fetchedAt.toISOString(), lastSeenAt: new Date().toISOString() } as Prisma.InputJsonValue },
      });
    } else {
      const row = await prisma.discoverItem.create({
        data: {
          sourceType,
          sourceName: LABEL[it.platform],
          externalId,
          title: it.title.slice(0, 500),
          url: it.url.slice(0, 2000),
          summary: it.summary.slice(0, 2000),
          author: it.author?.slice(0, 200),
          publishedAt: it.publishedAt,
          score: it.score ?? null,
          comments: it.comments ?? null,
          category: "social",
          tags: it.tags.slice(0, 10),
          raw: { ...it.raw, kind: it.kind, firstScore: it.score ?? 0, firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() } as Prisma.InputJsonValue,
        },
      });
      created.push(row.id);
    }
  }
  return created;
}

async function activeProjects() {
  return prisma.project.findMany({ where: { paused: false }, orderBy: { updatedAt: "desc" }, take: 1000 });
}

/** Up to 8 hashtags from project keywords, for Mastodon tag timelines. */
function keywordTags(projects: Project[]): string[] {
  const tags = projects.flatMap((p) => ((p.keywords as string[]) ?? []).map((k) => String(k).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")).filter((k) => k.length >= 3 && k.length <= 30));
  return [...new Set(tags)].slice(0, 8);
}

/** Job entry point (every 20 minutes). */
export async function runSocialPulse() {
  const projects = await activeProjects();
  // Everyone with saved pulse settings (paid opt-ins live here) plus project owners (defaults).
  const saved = await prisma.providerSetting.findMany({ where: { provider: SETTINGS_KEY }, select: { userId: true } });
  const owners = [...new Set([...saved.map((r) => r.userId), ...projects.map((p) => p.ownerId)])];
  const settings = new Map<string, PulseSettings>();
  for (const u of owners) settings.set(u, await getPulseSettings(u));
  const geos = [...new Set([...settings.values()].map((s) => s.geo))].slice(0, 5);
  if (!geos.length) geos.push("US");

  const summary: Record<string, number | string> = {};
  const createdIds: string[] = [];
  const run = async (name: string, f: () => Promise<PulseItem[]>) => {
    try {
      const items = await f();
      createdIds.push(...(await store(items)));
      summary[name] = items.length;
    } catch (e) {
      summary[name] = `error: ${redactString((e as Error).message).slice(0, 200)}`;
      log.warn(`pulse source ${name} failed: ${summary[name]}`);
    }
  };

  // Free, always.
  await run("bluesky", () => fetchBlueskyTrending());
  await run("mastodon", () => fetchMastodonTrends());
  for (const tag of keywordTags(projects)) await run(`mastodon #${tag}`, () => fetchMastodonTag(tag));
  for (const geo of geos) await run(`google_trends ${geo}`, () => fetchGoogleTrends(geo));

  // Paid, opt-in per user, capped.
  for (const [userId, s] of settings) {
    if (!s.paid.enabled || !s.paid.platforms.length) continue;
    const key = await getApiKey(userId, "socialcrawl");
    if (!key) continue;
    const spent = await pulseCreditsToday(userId);
    if (spent.lastRunAt && Date.now() - spent.lastRunAt.getTime() < s.paid.everyMinutes * 60_000 - 60_000) continue;
    let used = spent.credits;
    for (const platform of s.paid.platforms) {
      const cost = SOCIALCRAWL_TRENDING_CREDITS[platform];
      if (used + cost > s.paid.dailyCreditCap) {
        summary[`${platform} (paid)`] = `skipped: daily cap ${s.paid.dailyCreditCap} credits reached`;
        continue;
      }
      try {
        const r = await fetchSocialCrawlTrending(key, platform, s.paid.region);
        createdIds.push(...(await store(r.items)));
        used += r.credits;
        summary[`${platform} (paid)`] = r.items.length;
        await audit({ userId, actor: "system", action: "intel.pulse_paid", target: `socialcrawl-${platform}`, details: { credits: r.credits, items: r.items.length, cap: s.paid.dailyCreditCap } });
      } catch (e) {
        summary[`${platform} (paid)`] = `error: ${redactString((e as Error).message).slice(0, 200)}`;
      }
    }
  }

  await notifyMatches(projects, settings, createdIds);
  await prisma.discoverItem.deleteMany({ where: { sourceType: { startsWith: "pulse:" }, fetchedAt: { lt: new Date(Date.now() - 14 * 86400_000) } } });
  await emit({ type: "intel.pulse", data: { ...summary, new: createdIds.length } });
  return { ...summary, new: createdIds.length };
}

async function notifyMatches(projects: Project[], settings: Map<string, PulseSettings>, createdIds: string[]) {
  if (!createdIds.length) return;
  const fresh = await prisma.discoverItem.findMany({ where: { id: { in: createdIds } } });
  for (const p of projects) {
    if (settings.get(p.ownerId)?.notify === false) continue;
    const hits = fresh
      .map((i) => ({ i, r: relevance(p, i) }))
      .filter((x) => x.r.score >= 2)
      .sort((a, b) => b.r.score - a.r.score || (b.i.score ?? 0) - (a.i.score ?? 0))
      .slice(0, 3);
    if (!hits.length) continue;
    const recent = await prisma.notification.findFirst({ where: { projectId: p.id, type: "pulse", createdAt: { gte: new Date(Date.now() - 2 * 3600_000) } } });
    if (recent) continue;
    await notify({
      userId: p.ownerId,
      projectId: p.id,
      type: "pulse",
      title: `${hits.length} rising trend${hits.length > 1 ? "s" : ""} match ${p.name}`,
      body: hits.map((h) => `${h.i.sourceName}: ${h.i.title.slice(0, 90)}`).join("\n"),
      link: `/intel?tab=pulse&project=${p.id}`,
    });
  }
}

/** Momentum: score gained per hour since first seen, plus a recency bonus. */
export function pulseMomentum(i: Pick<DiscoverItem, "score" | "publishedAt" | "fetchedAt" | "raw">) {
  const raw = (i.raw ?? {}) as Record<string, unknown>;
  const first = Number(raw.firstScore ?? 0);
  const firstSeen = raw.firstSeenAt ? new Date(String(raw.firstSeenAt)) : i.fetchedAt;
  const hours = Math.max(0.33, (Date.now() - firstSeen.getTime()) / 3600_000);
  const gain = Math.max(0, (i.score ?? 0) - first) / hours;
  const ageH = (Date.now() - i.publishedAt.getTime()) / 3600_000;
  return Math.log10(1 + (i.score ?? 0)) + Math.log10(1 + gain) * 1.5 + 2 / (1 + ageH / 6);
}

export async function listPulse(userId: string, opts: { platform?: string; hours?: number; projectId?: string | null; limit?: number }) {
  const since = new Date(Date.now() - (opts.hours ?? 24) * 3600_000);
  const items = await prisma.discoverItem.findMany({
    where: { fetchedAt: { gte: since }, sourceType: opts.platform && opts.platform !== "all" ? `pulse:${opts.platform}` : { startsWith: "pulse:" } },
    orderBy: { fetchedAt: "desc" },
    take: 600,
  });
  const project = opts.projectId ? await prisma.project.findFirst({ where: { id: opts.projectId, ownerId: userId } }) : null;
  const ranked = items
    .map((i) => {
      const rel = project ? relevance(project, i) : { score: 0, matched: [] as string[] };
      const raw = (i.raw ?? {}) as Record<string, unknown>;
      return {
        id: i.id,
        platform: i.sourceType.replace("pulse:", ""),
        source: i.sourceName,
        kind: String(raw.kind ?? "post"),
        title: i.title,
        summary: i.summary,
        url: i.url,
        author: i.author,
        publishedAt: i.publishedAt,
        firstSeenAt: raw.firstSeenAt ?? i.fetchedAt,
        score: i.score,
        comments: i.comments,
        tags: i.tags,
        thumbnail: (raw.thumbnail as string) ?? (raw.image as string) ?? (raw.picture as string) ?? ((raw.media as string[]) ?? [])[0] ?? null,
        momentum: pulseMomentum(i) + rel.score * 1.2,
        matched: rel.matched,
      };
    })
    .sort((a, b) => b.momentum - a.momentum)
    .slice(0, Math.min(opts.limit ?? 100, 300));
  const last = await prisma.discoverItem.findFirst({ where: { sourceType: { startsWith: "pulse:" } }, orderBy: { fetchedAt: "desc" }, select: { fetchedAt: true } });
  return { items: ranked, lastCrawlAt: last?.fetchedAt ?? null, intervalMinutes: PULSE_INTERVAL_MIN };
}
