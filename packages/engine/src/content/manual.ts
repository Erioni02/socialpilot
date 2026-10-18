import sharp from "sharp";
import { zipSync, strToU8 } from "fflate";
import { prisma, Prisma, type Project } from "@socialpilot/db";
import { badRequest, createLogger, notFound } from "@socialpilot/core";
import { parseSocialUrl, type MetricKey, type MetricValue } from "@socialpilot/integrations";
import { PLATFORM_LIMITS, type SocialPlatform } from "@socialpilot/shared";
import { z } from "zod";
import { getObject } from "../infra/storage";
import { audit } from "../infra/audit";
import { emit } from "../infra/events";
import { enqueue } from "../infra/queue";
import { aiJson, hasTextAI } from "../ai/service";
import { recordOwnerMetrics, recordSourcedMetrics, snapshotUrl } from "../intel/service";
import { dueRapidMilestone, getRapidSettings, rapidPostMetrics, rapidStatus } from "../intel/rapidapi";
import { getApiKey } from "../infra/credentials";
import { refreshPostStatus, schedulePost } from "./publishing";
import { renderPlatformText } from "./service";
import type { Actor } from "../projects/context";

/**
 * Manual publishing desk: posts for platforms you publish yourself land in "Ready to post" with platform-ready media,
 * the final caption and a checklist. After posting, you paste the live URL; SocialPilot validates it, removes the item
 * from the desk and tracks the post's public metrics on a decaying schedule (free sources), with screenshot/manual
 * entry for metrics only the account owner can see.
 */

const log = createLogger("manual-publishing");
type Metrics = Partial<Record<MetricKey, MetricValue>>;

const PLATFORM_NAME: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", x: "X" };

/** Posting checklist per platform (what to do in the app so the post performs and tracking works). */
const CHECKLIST: Record<string, string[]> = {
  instagram: [
    "Use the platform-ready files (JPEG, 4:5–1.91:1); for carousels keep the file order.",
    "Paste the caption; first line is the hook — keep it above the fold.",
    "Pick the cover frame for Reels and turn on 'Also share to feed'.",
    "Add location / collaborators / product tags if relevant.",
    "After posting: ••• → Copy link, then paste it here.",
  ],
  tiktok: [
    "Upload the platform-ready file (9:16, 1080×1920).",
    "Paste the caption; add 3–5 relevant hashtags at the end.",
    "Choose a cover with readable text; add a trending sound only if it fits the brand.",
    "Disclose branded content if this promotes a product (Content disclosure toggle).",
    "After posting: Share → Copy link, then paste it here.",
  ],
  x: [
    "Attach the media (up to 4 images or 1 video) in the given order.",
    "Paste the text; for threads post each part as a reply to the previous one.",
    "Keep links in the last part of a thread when reach matters.",
    "After posting: Share → Copy link, then paste it here.",
  ],
};

// ───────────── Platform-ready media ─────────────

/** Fits an image into a frame without cropping: blurred, darkened cover of itself behind a contained foreground. */
async function fitWithBackdrop(input: Buffer, w: number, h: number) {
  const bg = await sharp(input).rotate().resize(w, h, { fit: "cover" }).blur(40).modulate({ brightness: 0.75 }).toBuffer();
  const fg = await sharp(input).rotate().resize(w, h, { fit: "inside", withoutEnlargement: false }).toBuffer();
  return sharp(bg).composite([{ input: fg, gravity: "center" }]).jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
}

/** Converts an image to the platform's preferred format and aspect range. Videos are returned unchanged. */
export async function platformReadyImage(platform: string, data: Buffer): Promise<{ data: Buffer; mimeType: string; note: string }> {
  const img = sharp(data, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  const w = meta.width ?? 1080;
  const h = meta.height ?? 1080;
  const ratio = w / h;
  if (platform === "instagram") {
    if (ratio < 0.8) return { data: await fitWithBackdrop(data, 1080, 1350), mimeType: "image/jpeg", note: "Fitted to 4:5 (1080×1350) without cropping" };
    if (ratio > 1.91) return { data: await fitWithBackdrop(data, 1080, 566), mimeType: "image/jpeg", note: "Fitted to 1.91:1 without cropping" };
    const out = await img.resize({ width: Math.min(1080, w), withoutEnlargement: false }).toColorspace("srgb").jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
    return { data: out, mimeType: "image/jpeg", note: "JPEG, 1080px wide" };
  }
  if (platform === "tiktok") {
    if (Math.abs(ratio - 9 / 16) < 0.01) return { data: await img.resize(1080, 1920).jpeg({ quality: 92, mozjpeg: true }).toBuffer(), mimeType: "image/jpeg", note: "JPEG 1080×1920" };
    return { data: await fitWithBackdrop(data, 1080, 1920), mimeType: "image/jpeg", note: "Fitted to 9:16 (1080×1920) without cropping" };
  }
  // X: keep aspect, cap the long edge, JPEG for photos (PNG keeps transparency/graphics crisp).
  const long = Math.max(w, h);
  const resized = long > 4096 ? img.resize({ width: w >= h ? 4096 : undefined, height: h > w ? 4096 : undefined }) : img;
  if (meta.format === "png" && meta.hasAlpha) return { data: await resized.png().toBuffer(), mimeType: "image/png", note: "PNG (transparency kept)" };
  return { data: await resized.jpeg({ quality: 92, mozjpeg: true }).toBuffer(), mimeType: "image/jpeg", note: "JPEG, original aspect" };
}

const extOf = (mime: string) => ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" })[mime] ?? "bin";
const safeName = (s: string) => s.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "-").slice(0, 60) || "media";

async function loadMedia(post: { mediaAssetIds: string[] }) {
  if (!post.mediaAssetIds.length) return [];
  const assets = await prisma.asset.findMany({ where: { id: { in: post.mediaAssetIds } } });
  const out = [];
  for (const id of post.mediaAssetIds) {
    const a = assets.find((x) => x.id === id);
    if (!a?.currentVersionId) continue;
    const v = await prisma.assetVersion.findUnique({ where: { id: a.currentVersionId } });
    if (v) out.push({ asset: a, version: v });
  }
  return out;
}

// ───────────── Desk ─────────────

export async function readyToPost(project: Project) {
  const targets = await prisma.postTarget.findMany({
    where: { status: "manual", post: { projectId: project.id, status: { notIn: ["cancelled", "draft"] } } },
    include: { post: { include: { campaign: { select: { id: true, name: true, slug: true } } } } },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
  });
  const now = Date.now();
  const items = [];
  for (const t of targets) {
    const platform = t.platform as SocialPlatform;
    const rendered = renderPlatformText(t.post, platform, t.post.campaign?.slug);
    const media = await loadMedia(t.post);
    const limit = PLATFORM_LIMITS[platform]?.maxChars;
    items.push({
      targetId: t.id,
      postId: t.postId,
      platform,
      platformName: PLATFORM_NAME[platform] ?? platform,
      title: t.post.title,
      type: t.post.type,
      campaign: t.post.campaign ? { id: t.post.campaign.id, name: t.post.campaign.name } : null,
      dueAt: t.scheduledAt,
      state: !t.scheduledAt || t.scheduledAt.getTime() <= now ? (t.scheduledAt && now - t.scheduledAt.getTime() > 3600_000 ? "overdue" : "due") : "upcoming",
      caption: rendered.text,
      captionLength: rendered.text.length,
      captionLimit: limit ?? null,
      thread: rendered.thread ?? null,
      videoTitle: rendered.title ?? null,
      media: media.map(({ asset, version }) => ({ assetId: asset.id, name: asset.name, kind: asset.kind, mimeType: version.mimeType, width: version.width, height: version.height, sizeBytes: version.sizeBytes, durationSec: version.durationSec })),
      checklist: CHECKLIST[platform] ?? [],
    });
  }
  return { items, counts: { due: items.filter((i) => i.state !== "upcoming").length, upcoming: items.filter((i) => i.state === "upcoming").length } };
}

/** Sends a post to the desk for the chosen platforms (now or at a time), bypassing API publishing. */
export async function sendToDesk(project: Project, postId: string, input: { platforms?: SocialPlatform[]; at?: Date }, actor: Actor) {
  return schedulePost(project, postId, { scheduledAt: input.at ?? new Date(), platforms: input.platforms }, actor, { manual: true });
}

/** Platform-ready download for one desk item: media (converted) + caption + checklist, as a ZIP. */
export async function deskBundle(project: Project, targetId: string) {
  const t = await prisma.postTarget.findFirst({ where: { id: targetId, post: { projectId: project.id } }, include: { post: { include: { campaign: true } } } });
  if (!t) throw notFound("Ready-to-post item");
  const platform = t.platform as SocialPlatform;
  const rendered = renderPlatformText(t.post, platform, t.post.campaign?.slug);
  const files: Record<string, Uint8Array> = {};
  const notes: string[] = [];
  const media = await loadMedia(t.post);
  let i = 0;
  for (const { asset, version } of media) {
    i++;
    const raw = await getObject(version.storageKey);
    const n = String(i).padStart(2, "0");
    if (version.mimeType.startsWith("image/")) {
      const ready = await platformReadyImage(platform, raw);
      files[`${n}-${safeName(asset.name)}.${extOf(ready.mimeType)}`] = ready.data;
      notes.push(`${n}: ${asset.name} — ${ready.note}`);
    } else {
      files[`${n}-${safeName(asset.name)}.${extOf(version.mimeType)}`] = raw;
      notes.push(`${n}: ${asset.name} — original video (${version.width ?? "?"}×${version.height ?? "?"}${version.durationSec ? `, ${Math.round(version.durationSec)}s` : ""})`);
    }
  }
  files["caption.txt"] = strToU8(rendered.text + "\n");
  if (rendered.thread?.length) files["thread.txt"] = strToU8(rendered.thread.map((p, k) => `--- ${k + 1}/${rendered.thread!.length} ---\n${p}`).join("\n\n") + "\n");
  if (rendered.title) files["video-title.txt"] = strToU8(rendered.title + "\n");
  files["POSTING-CHECKLIST.txt"] = strToU8(
    [`${PLATFORM_NAME[platform] ?? platform} — ${t.post.title || "post"}`, t.scheduledAt ? `Planned for: ${t.scheduledAt.toISOString()}` : "", "", "Files:", ...notes.map((x) => `  ${x}`), "", "Checklist:", ...(CHECKLIST[platform] ?? []).map((x) => `  [ ] ${x}`)].join("\n") + "\n",
  );
  const zip = zipSync(files, { level: 0 });
  return { filename: `${safeName(t.post.title || "post")}-${platform}.zip`, data: Buffer.from(zip) };
}

/** One platform-ready file (for single downloads). */
export async function deskMediaFile(project: Project, targetId: string, assetId: string) {
  const t = await prisma.postTarget.findFirst({ where: { id: targetId, post: { projectId: project.id } }, include: { post: true } });
  if (!t || !t.post.mediaAssetIds.includes(assetId)) throw notFound("Media");
  const [m] = (await loadMedia({ mediaAssetIds: [assetId] })) ?? [];
  if (!m) throw notFound("Media");
  const raw = await getObject(m.version.storageKey);
  if (!m.version.mimeType.startsWith("image/")) return { filename: `${safeName(m.asset.name)}.${extOf(m.version.mimeType)}`, mimeType: m.version.mimeType, data: raw };
  const ready = await platformReadyImage(t.platform, raw);
  return { filename: `${safeName(m.asset.name)}-${t.platform}.${extOf(ready.mimeType)}`, mimeType: ready.mimeType, data: ready.data };
}

/** You posted it: validate the live URL, close the desk item, start tracking. */
export async function markPosted(project: Project, targetId: string, input: { url: string; postedAt?: Date }, userId: string) {
  const t = await prisma.postTarget.findFirst({ where: { id: targetId, post: { projectId: project.id } } });
  if (!t) throw notFound("Ready-to-post item");
  if (t.status === "published") throw badRequest("This post is already marked as posted");
  let parsed;
  try {
    parsed = parseSocialUrl(input.url);
  } catch (e) {
    throw badRequest((e as Error).message);
  }
  if (parsed.platform !== t.platform) throw badRequest(`That's a ${PLATFORM_NAME[parsed.platform]} link, but this item is for ${PLATFORM_NAME[t.platform] ?? t.platform}.`);
  if (parsed.kind !== "post") throw badRequest("Paste the link to the post itself (not the profile).");
  const dup = await prisma.postTarget.findFirst({ where: { id: { not: t.id }, platform: t.platform, remoteId: parsed.externalId, post: { projectId: project.id } } });
  if (dup) throw badRequest("That post link is already attached to another item in this project.");
  const postedAt = input.postedAt && input.postedAt.getTime() <= Date.now() + 60_000 ? input.postedAt : new Date();
  await prisma.postTarget.update({
    where: { id: t.id },
    data: { status: "published", publishedAt: postedAt, remoteUrl: parsed.url, remoteId: parsed.externalId, lastError: null, providerState: { manual: true, tracking: "pending" } },
  });
  await audit({ userId, projectId: project.id, actor: "user", action: "post.manual_published", target: t.id, details: { url: parsed.url } });
  await refreshPostStatus(t.postId);
  await enqueue("posts.track", { targetId: t.id }, { projectId: project.id, dedupeKey: `track:${t.id}:first`, maxAttempts: 2 });
  return { targetId: t.id, url: parsed.url };
}

/** Undo "posted" (wrong link etc.): puts the item back on the desk. Snapshots already taken stay in history. */
export async function unmarkPosted(project: Project, targetId: string, userId: string) {
  const t = await prisma.postTarget.findFirst({ where: { id: targetId, post: { projectId: project.id } } });
  if (!t || !(t.providerState as any)?.manual) throw notFound("Manually posted item");
  await prisma.postTarget.update({ where: { id: t.id }, data: { status: "manual", publishedAt: null, remoteUrl: null, remoteId: null, metrics: Prisma.DbNull, metricsAt: null, providerState: { handoffNotified: new Date().toISOString() } } });
  await audit({ userId, projectId: project.id, actor: "user", action: "post.manual_unpublished", target: t.id });
  await refreshPostStatus(t.postId);
}

// ───────────── Tracking ─────────────

/** Decaying refresh cadence: fresh posts change fast, old posts barely move. */
export function trackingIntervalMs(publishedAt: Date, now = Date.now()) {
  const age = now - publishedAt.getTime();
  const h = 3600_000;
  if (age < 48 * h) return 20 * 60_000;
  if (age < 7 * 24 * h) return 2 * h;
  if (age < 30 * 24 * h) return 12 * h;
  if (age < 90 * 24 * h) return 24 * h;
  return Infinity;
}

const metricsOf = (snap: { metrics: unknown } | null) => (snap?.metrics ?? {}) as Metrics;
const ownerKeys = (m: unknown) => Object.fromEntries(Object.entries((m ?? {}) as Record<string, unknown>).filter(([k]) => !k.startsWith("_")));

/** Job: refresh one tracked post from free public sources. */
export async function trackPostedTarget(payload: { targetId: string }) {
  const t = await prisma.postTarget.findUnique({ where: { id: payload.targetId }, include: { post: { include: { project: true } } } });
  if (!t || t.status !== "published" || !t.remoteUrl) return { skipped: true };
  const project = t.post.project;
  const state = (t.providerState ?? {}) as Record<string, unknown>;
  const r = await snapshotUrl(project.ownerId, project.id, t.remoteUrl);
  let ok = r.outcome.status === "ok" || r.outcome.status === "partial";
  let note: string | null = ok ? null : (r.outcome.message ?? null);
  const rapidDone = ((state.rapidMilestones as number[]) ?? []).slice();
  // Instagram (no public data) and X (no public views): live numbers from RapidAPI at 1, 3 and 7 days, within budget.
  if (r.entityId && (t.platform === "instagram" || t.platform === "x") && t.publishedAt && (await getApiKey(project.ownerId, "rapidapi")) && (await getRapidSettings(project.ownerId)).autoTracking) {
    const due = dueRapidMilestone(t.publishedAt, rapidDone);
    if (due != null) {
      try {
        const m = await rapidPostMetrics(project.ownerId, t.remoteUrl, { automatic: true, publishedAt: t.publishedAt });
        if (Object.keys(m.metrics).length) {
          await recordSourcedMetrics(project.ownerId, r.entityId, m.metrics, m.source);
          ok = true;
          note = null;
        }
        rapidDone.push(due);
      } catch (e) {
        log.info(`rapidapi tracking skipped for ${t.id}: ${(e as Error).message}`);
        if (!ok) note = (e as Error).message;
        // Budget stops are retried at the next run; other failures don't retry the same milestone forever.
        if (!/budget|paused/i.test((e as Error).message)) rapidDone.push(due);
      }
    }
  }
  const latest = r.entityId ? await prisma.intelSnapshot.findFirst({ where: { entityId: r.entityId }, orderBy: { capturedAt: "desc" } }) : null;
  await prisma.postTarget.update({
    where: { id: t.id },
    data: {
      // Newest automatic values win; owner-entered metrics the free source can't see (e.g. X views) are kept.
      ...(latest ? { metrics: { ...ownerKeys(t.metrics), ...metricsOf(latest), _source: latest.source, _confidence: latest.confidence } as unknown as Prisma.InputJsonValue, metricsAt: latest.capturedAt } : {}),
      providerState: { ...state, intelEntityId: r.entityId ?? state.intelEntityId ?? null, tracking: ok ? "auto" : "owner_input", trackingNote: note, rapidMilestones: rapidDone, lastTrackAt: new Date().toISOString() } as Prisma.InputJsonValue,
    },
  });
  await emit({ type: "post.updated", projectId: project.id, data: { id: t.postId } });
  return { status: r.outcome.status };
}

/** Manual "refresh with RapidAPI" for one posted Instagram/X post (uses 1 request from the monthly budget). */
export async function refreshPostedWithRapid(project: Project, targetId: string, userId: string) {
  const { target, entityId } = await trackedEntity(project, targetId);
  const m = await rapidPostMetrics(project.ownerId, target.remoteUrl!, { automatic: false, publishedAt: target.publishedAt ?? undefined });
  if (!Object.keys(m.metrics).length) throw badRequest("The statistics API returned no metrics for this post.");
  const snap = await recordSourcedMetrics(project.ownerId, entityId, m.metrics, m.source);
  const merged = { ...ownerKeys(target.metrics), ...m.metrics, _source: snap.source, _confidence: "exact" };
  await prisma.postTarget.update({ where: { id: target.id }, data: { metrics: merged as unknown as Prisma.InputJsonValue, metricsAt: snap.capturedAt, providerState: { ...((target.providerState ?? {}) as object), tracking: "auto", trackingNote: null } as Prisma.InputJsonValue } });
  await audit({ userId, projectId: project.id, actor: "user", action: "post.metrics_rapidapi", target: target.id });
  await emit({ type: "post.updated", projectId: project.id, data: { id: target.postId } });
  return { metrics: m.metrics, status: await rapidStatus(project.ownerId) };
}

/** Scheduler: enqueue tracked posts that are due by their cadence. */
export async function dispatchPostTracking() {
  const since = new Date(Date.now() - 90 * 86400_000);
  const rows = await prisma.postTarget.findMany({
    where: { status: "published", remoteUrl: { not: null }, publishedAt: { gte: since }, post: { project: { paused: false } } },
    select: { id: true, publishedAt: true, metricsAt: true, providerState: true, post: { select: { projectId: true } } },
    take: 2000,
  });
  let n = 0;
  for (const r of rows) {
    const st = (r.providerState ?? {}) as Record<string, unknown>;
    const last = st.lastTrackAt ? new Date(String(st.lastTrackAt)).getTime() : r.metricsAt?.getTime() ?? 0;
    const every = trackingIntervalMs(r.publishedAt!);
    if (Date.now() - last < every) continue;
    // API-published posts on connected accounts are refreshed by integration syncs; free tracking only covers public URLs.
    await enqueue("posts.track", { targetId: r.id }, { projectId: r.post.projectId, dedupeKey: `track:${r.id}:${Math.floor(Date.now() / Math.min(every, 86400_000))}`, maxAttempts: 1 });
    if (++n >= 200) break;
  }
  return { enqueued: n };
}

async function trackedEntity(project: Project, targetId: string) {
  const t = await prisma.postTarget.findFirst({ where: { id: targetId, post: { projectId: project.id }, status: "published" } });
  if (!t?.remoteUrl) throw notFound("Posted item");
  let entityId = (t.providerState as any)?.intelEntityId as string | undefined;
  if (!entityId) {
    const r = await snapshotUrl(project.ownerId, project.id, t.remoteUrl);
    entityId = r.entityId ?? undefined;
    if (entityId) await prisma.postTarget.update({ where: { id: t.id }, data: { providerState: { ...((t.providerState ?? {}) as object), intelEntityId: entityId } as Prisma.InputJsonValue } });
  }
  if (!entityId) throw badRequest("Couldn't link this post for tracking. Check the URL.");
  return { target: t, entityId };
}

const metricInput = z.object({
  views: z.number().int().min(0).optional(),
  likes: z.number().int().min(0).optional(),
  comments: z.number().int().min(0).optional(),
  shares: z.number().int().min(0).optional(),
  saves: z.number().int().min(0).optional(),
  reach: z.number().int().min(0).optional(),
  impressions: z.number().int().min(0).optional(),
  profile_visits: z.number().int().min(0).optional(),
  follows: z.number().int().min(0).optional(),
  link_clicks: z.number().int().min(0).optional(),
});
export type OwnerMetricsInput = z.infer<typeof metricInput>;
export const OWNER_METRICS = Object.keys(metricInput.shape) as (keyof OwnerMetricsInput)[];

/** Save metrics you entered or confirmed from a screenshot. */
export async function saveOwnerMetrics(project: Project, targetId: string, input: unknown, source: "manual" | "screenshot", userId: string) {
  const values = metricInput.parse(input);
  const { target, entityId } = await trackedEntity(project, targetId);
  const metrics: Metrics = {};
  for (const [k, v] of Object.entries(values)) if (v != null) (metrics as any)[k] = { value: v };
  const snap = await recordOwnerMetrics(project.ownerId, entityId, metrics, source);
  const merged = { ...((target.metrics ?? {}) as object), ...metrics, _source: snap.source, _confidence: "exact" };
  await prisma.postTarget.update({ where: { id: target.id }, data: { metrics: merged as unknown as Prisma.InputJsonValue, metricsAt: snap.capturedAt } });
  await audit({ userId, projectId: project.id, actor: "user", action: "post.metrics_entered", target: target.id, details: { source, metrics: values } });
  await emit({ type: "post.updated", projectId: project.id, data: { id: target.postId } });
  return { snapshotId: snap.id };
}

const extracted = z.object({
  views: z.number().nullable().optional(),
  likes: z.number().nullable().optional(),
  comments: z.number().nullable().optional(),
  shares: z.number().nullable().optional(),
  saves: z.number().nullable().optional(),
  reach: z.number().nullable().optional(),
  impressions: z.number().nullable().optional(),
  profile_visits: z.number().nullable().optional(),
  follows: z.number().nullable().optional(),
  link_clicks: z.number().nullable().optional(),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  notes: z.string().default(""),
});

/** Reads metrics from an Insights screenshot with the vision model. Returns values for you to confirm — nothing is saved. */
export async function readMetricsScreenshot(project: Project, userId: string, image: { data: Buffer; mimeType: string }) {
  if (!(await hasTextAI(userId, project))) throw badRequest("Reading screenshots needs a vision-capable AI provider (Settings → AI providers).");
  const jpeg = await sharp(image.data, { failOn: "none" }).rotate().resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  const r = await aiJson(
    { userId, projectId: project.id },
    {
      role: "vision",
      system:
        "You read social media analytics screenshots (Instagram Insights, TikTok Analytics, X post analytics). Extract ONLY numbers that are clearly visible. Convert abbreviations exactly as shown (1.2K = 1200, 3.4M = 3400000) and say so in notes. Use null for anything not visible. Never estimate or infer.",
      prompt:
        'Return JSON with keys views, likes, comments, shares, saves, reach, impressions, profile_visits, follows, link_clicks (numbers or null), confidence ("high"|"medium"|"low") and notes (mention any abbreviated values or ambiguity). Map: Plays/Views → views; Accounts reached → reach; Reposts → shares; Bookmarks → saves; Profile activity/visits → profile_visits; Follows → follows; Link/website taps → link_clicks.',
      images: [{ mimeType: "image/jpeg", base64: jpeg.toString("base64") }],
      schema: extracted,
      schemaHint: '{"views": number|null, "likes": number|null, ..., "confidence": "high"|"medium"|"low", "notes": string}',
      maxTokens: 600,
    },
    project,
  );
  const values: Record<string, number> = {};
  for (const k of OWNER_METRICS) {
    const v = (r.data as any)[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) values[k] = Math.round(v);
  }
  return { values, confidence: r.data.confidence, notes: r.data.notes, model: r.model };
}

// ───────────── Reporting ─────────────

const ENGAGEMENT: MetricKey[] = ["likes", "comments", "shares", "saves"];

/** Performance of everything published (manually or via API) in a window, from stored metrics and snapshots. */
export async function postedPerformance(project: Project, days = 30) {
  const since = new Date(Date.now() - days * 86400_000);
  const targets = await prisma.postTarget.findMany({
    where: { status: "published", publishedAt: { gte: since }, post: { projectId: project.id } },
    include: { post: { select: { id: true, title: true, body: true, type: true, mediaAssetIds: true, campaign: { select: { id: true, name: true } } } } },
    orderBy: { publishedAt: "desc" },
  });
  const entityIds = targets.map((t) => (t.providerState as any)?.intelEntityId).filter(Boolean) as string[];
  const snaps = entityIds.length ? await prisma.intelSnapshot.findMany({ where: { entityId: { in: entityIds } }, orderBy: { capturedAt: "asc" }, select: { entityId: true, capturedAt: true, metrics: true, source: true } }) : [];
  const byEntity = new Map<string, typeof snaps>();
  for (const s of snaps) byEntity.set(s.entityId, [...(byEntity.get(s.entityId) ?? []), s]);

  const posts = targets.map((t) => {
    const st = (t.providerState ?? {}) as Record<string, any>;
    const m = (t.metrics ?? {}) as Record<string, any>;
    const val = (k: string) => (typeof m[k]?.value === "number" ? m[k].value : typeof m[k] === "number" ? m[k] : null);
    const views = val("views");
    const engagement = ENGAGEMENT.reduce((s, k) => s + (val(k) ?? 0), 0);
    const hasEng = ENGAGEMENT.some((k) => val(k) != null);
    const series = (byEntity.get(st.intelEntityId) ?? []).map((s) => ({ at: s.capturedAt, ...Object.fromEntries(Object.entries((s.metrics ?? {}) as Record<string, any>).map(([k, v]) => [k, v?.value])) }));
    return {
      targetId: t.id,
      postId: t.postId,
      platform: t.platform,
      title: t.post.title || t.post.body.slice(0, 80),
      type: t.post.type,
      campaign: t.post.campaign,
      url: t.remoteUrl,
      publishedAt: t.publishedAt,
      manual: !!st.manual,
      tracking: st.tracking ?? (st.manual ? "pending" : "integration"),
      trackingNote: st.trackingNote ?? null,
      metricsAt: t.metricsAt,
      source: m._source ?? null,
      metrics: Object.fromEntries(["views", "likes", "comments", "shares", "saves", "reach", "impressions", "profile_visits", "follows", "link_clicks"].map((k) => [k, val(k)])),
      engagement: hasEng ? engagement : null,
      engagementRate: hasEng && views ? engagement / views : null,
      series,
    };
  });

  const sum = (list: typeof posts, k: string) => list.reduce((s, p) => s + ((p.metrics as any)[k] ?? 0), 0);
  const platforms = [...new Set(posts.map((p) => p.platform))].map((pl) => {
    const list = posts.filter((p) => p.platform === pl);
    const withRate = list.filter((p) => p.engagementRate != null);
    return {
      platform: pl,
      posts: list.length,
      views: sum(list, "views"),
      likes: sum(list, "likes"),
      comments: sum(list, "comments"),
      shares: sum(list, "shares"),
      saves: sum(list, "saves"),
      avgEngagementRate: withRate.length ? withRate.reduce((s, p) => s + p.engagementRate!, 0) / withRate.length : null,
      needsInput: list.filter((p) => p.tracking === "owner_input").length,
    };
  });

  // Best weekday/hour by median engagement rate (only when there's enough data to say anything).
  const rated = posts.filter((p) => p.engagementRate != null && p.publishedAt);
  const tz = project.timezone || "UTC";
  const bucket = (d: Date, opt: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opt }).format(d);
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
  };
  const group = (key: (d: Date) => string) => {
    const g = new Map<string, number[]>();
    for (const p of rated) g.set(key(new Date(p.publishedAt!)), [...(g.get(key(new Date(p.publishedAt!))) ?? []), p.engagementRate!]);
    return [...g.entries()].filter(([, v]) => v.length >= 2).map(([k, v]) => ({ key: k, posts: v.length, medianEngagementRate: median(v) })).sort((a, b) => b.medianEngagementRate - a.medianEngagementRate);
  };
  const timing = rated.length >= 6 ? { byWeekday: group((d) => bucket(d, { weekday: "long" })), byHour: group((d) => bucket(d, { hour: "numeric", hour12: false })), timezone: tz } : null;

  return {
    days,
    totals: { posts: posts.length, views: sum(posts, "views"), engagement: posts.reduce((s, p) => s + (p.engagement ?? 0), 0), needsInput: posts.filter((p) => p.tracking === "owner_input").length },
    platforms,
    posts,
    top: [...posts].filter((p) => p.engagementRate != null).sort((a, b) => b.engagementRate! - a.engagementRate!).slice(0, 5),
    timing,
    coverage: {
      tiktok: "Views, likes, comments, shares and saves are read automatically from the public video page.",
      x: "Likes and replies are read automatically. With a RapidAPI key, views and reposts are added at 1, 3 and 7 days (once the provider has collected the post). Bookmarks: screenshot or manual entry.",
      instagram: "Instagram shows no public data without login. With a RapidAPI key, likes, comments and views are read live at 1, 3 and 7 days (or on demand). Owner-only numbers (reach, saves, shares) come from an Insights screenshot or manual entry.",
    },
  };
}

export { log as manualLog };
