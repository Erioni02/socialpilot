import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, Prisma } from "@socialpilot/db";
import { badRequest, notFound } from "@socialpilot/core";
import { campaignSchema, postSchema, postUpdateSchema, scheduleSchema, SOCIAL_PLATFORMS, PLATFORM_LIMITS, type Brand } from "@socialpilot/shared";
import {
  aiJson,
  audit,
  campaignPerformance,
  createCampaign,
  createPost,
  duplicatePost,
  emit,
  enqueue,
  markManualPublished,
  markPosted,
  planSlot,
  qualityCheck,
  renderPlatformText,
  restorePostVersion,
  retryTarget,
  schedulePost,
  setPostStatus,
  tzOffsetMinutes,
  unschedulePost,
  updatePost,
  upcomingTargets,
} from "@socialpilot/engine";
import { parse, userOf } from "../lib/http";

export default async function contentRoutes(app: FastifyInstance) {
  const P = { preHandler: app.requireProject };
  const userActor = (req: any) => ({ kind: "user" as const, userId: userOf(req).id });

  // ───── Campaigns ─────
  app.get("/projects/:projectId/campaigns", P, async (req) => {
    const campaigns = await prisma.campaign.findMany({ where: { projectId: req.project.id }, orderBy: { createdAt: "desc" }, include: { _count: { select: { posts: true, assets: true } } } });
    return { campaigns };
  });
  app.post("/projects/:projectId/campaigns", P, async (req) => ({ campaign: await createCampaign(req.project, parse(campaignSchema, req.body)) }));
  app.get("/projects/:projectId/campaigns/:campaignId", P, async (req) => {
    const { campaignId } = req.params as { campaignId: string };
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, projectId: req.project.id },
      include: { posts: { orderBy: { createdAt: "asc" }, include: { targets: true } }, assets: { orderBy: { createdAt: "desc" }, take: 100 } },
    });
    if (!campaign) throw notFound("Campaign");
    const perf = (await campaignPerformance(req.project)).find((c) => c.id === campaignId) ?? null;
    return { campaign, performance: perf };
  });
  app.patch("/projects/:projectId/campaigns/:campaignId", P, async (req) => {
    const { campaignId } = req.params as { campaignId: string };
    const body = parse(campaignSchema.partial(), req.body);
    const r = await prisma.campaign.updateMany({ where: { id: campaignId, projectId: req.project.id }, data: { ...body, pillars: body.pillars as Prisma.InputJsonValue | undefined } });
    if (!r.count) throw notFound("Campaign");
    await emit({ type: "campaign.updated", projectId: req.project.id, data: { id: campaignId } });
    return { ok: true };
  });
  app.delete("/projects/:projectId/campaigns/:campaignId", P, async (req) => {
    const { campaignId } = req.params as { campaignId: string };
    const scheduled = await prisma.post.count({ where: { campaignId, status: { in: ["scheduled", "publishing"] } } });
    if (scheduled) throw badRequest("Unschedule the campaign's posts first");
    await prisma.campaign.deleteMany({ where: { id: campaignId, projectId: req.project.id } });
    await audit({ userId: userOf(req).id, projectId: req.project.id, actor: "user", action: "campaign.deleted", target: campaignId });
    return { ok: true };
  });
  app.post("/projects/:projectId/campaigns/:campaignId/plan", P, async (req) => {
    const { campaignId } = req.params as { campaignId: string };
    const body = parse(z.object({ days: z.number().int().min(1).max(31).optional(), postsPerDay: z.number().min(0.2).max(5).optional(), extra: z.string().max(2000).optional(), materialize: z.boolean().default(false), generateImages: z.boolean().default(false) }), req.body);
    if (!(await prisma.campaign.findFirst({ where: { id: campaignId, projectId: req.project.id } }))) throw notFound("Campaign");
    const job = await enqueue("campaign.plan", { projectId: req.project.id, campaignId, options: body, materialize: body.materialize, generateImages: body.generateImages }, { projectId: req.project.id, maxAttempts: 1 });
    return { jobId: job.id };
  });
  app.post("/projects/:projectId/campaigns/:campaignId/materialize", P, async (req) => {
    const { campaignId } = req.params as { campaignId: string };
    const body = parse(z.object({ generateImages: z.boolean().default(false) }), req.body);
    const c = await prisma.campaign.findFirst({ where: { id: campaignId, projectId: req.project.id } });
    if (!c?.plan) throw badRequest("Generate a plan first");
    const job = await enqueue("campaign.materialize", { projectId: req.project.id, campaignId, generateImages: body.generateImages }, { projectId: req.project.id, maxAttempts: 1 });
    return { jobId: job.id };
  });
  /** Schedules every draft of a materialized plan at its planned day/time. */
  app.post("/projects/:projectId/campaigns/:campaignId/schedule-plan", P, async (req) => {
    const { campaignId } = req.params as { campaignId: string };
    const c = await prisma.campaign.findFirst({ where: { id: campaignId, projectId: req.project.id }, include: { posts: { where: { status: "draft" } } } });
    if (!c) throw notFound("Campaign");
    const results = [];
    for (const post of c.posts) {
      const m = post.notes.match(/Plan day (\d+) at (\d{1,2}:\d{2})/);
      if (!m) continue;
      const at = planSlot(c, Number(m[1]), m[2], req.project.timezone);
      if (at < new Date()) {
        results.push({ postId: post.id, error: "Planned time is in the past" });
        continue;
      }
      try {
        const r = await schedulePost(req.project, post.id, { scheduledAt: at, timezone: req.project.timezone }, userActor(req));
        results.push({ postId: post.id, scheduledAt: at, targets: r.targets });
      } catch (e) {
        results.push({ postId: post.id, error: (e as Error).message });
      }
    }
    return { results };
  });

  // ───── Posts ─────
  app.get("/projects/:projectId/posts", P, async (req) => {
    const q = parse(z.object({ status: z.string().optional(), campaignId: z.string().optional(), q: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }), req.query);
    const posts = await prisma.post.findMany({
      where: {
        projectId: req.project.id,
        ...(q.status ? { status: { in: q.status.split(",") } } : {}),
        ...(q.campaignId ? { campaignId: q.campaignId } : {}),
        ...(q.q ? { OR: [{ title: { contains: q.q, mode: "insensitive" } }, { body: { contains: q.q, mode: "insensitive" } }] } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: q.limit,
      include: { targets: true, campaign: { select: { id: true, name: true } } },
    });
    return { posts };
  });
  app.post("/projects/:projectId/posts", P, async (req) => ({ post: await createPost(req.project, parse(postSchema, req.body), "user") }));
  app.get("/projects/:projectId/posts/:postId", P, async (req) => {
    const { postId } = req.params as { postId: string };
    const post = await prisma.post.findFirst({ where: { id: postId, projectId: req.project.id }, include: { targets: true, versions: { orderBy: { version: "desc" } }, campaign: true } });
    if (!post) throw notFound("Post");
    const previews = Object.fromEntries(post.platforms.map((p) => [p, renderPlatformText(post, p as any, post.campaign?.slug)]));
    const approval = post.approvalId ? await prisma.approval.findUnique({ where: { id: post.approvalId } }) : null;
    return { post, previews, approval, limits: PLATFORM_LIMITS };
  });
  app.patch("/projects/:projectId/posts/:postId", P, async (req) => {
    const { postId } = req.params as { postId: string };
    return { post: await updatePost(req.project, postId, parse(postUpdateSchema, req.body), "user") };
  });
  app.delete("/projects/:projectId/posts/:postId", P, async (req) => {
    const { postId } = req.params as { postId: string };
    const post = await prisma.post.findFirst({ where: { id: postId, projectId: req.project.id }, include: { targets: true } });
    if (!post) throw notFound("Post");
    if (post.targets.some((t) => t.status === "publishing" || t.status === "scheduled")) throw badRequest("Unschedule the post first");
    await prisma.post.delete({ where: { id: postId } });
    await audit({ userId: userOf(req).id, projectId: req.project.id, actor: "user", action: "post.deleted", target: postId });
    await emit({ type: "post.updated", projectId: req.project.id, data: { id: postId, deleted: true } });
    return { ok: true };
  });
  app.post("/projects/:projectId/posts/:postId/quality", P, async (req) => {
    const { postId } = req.params as { postId: string };
    const { ai } = parse(z.object({ ai: z.boolean().default(false) }), req.body);
    return qualityCheck(userOf(req).id, req.project, postId, { ai });
  });
  app.post("/projects/:projectId/posts/:postId/status", P, async (req) => {
    const { postId } = req.params as { postId: string };
    const { status } = parse(z.object({ status: z.enum(["draft", "in_review", "approved", "cancelled"]) }), req.body);
    return { post: await setPostStatus(req.project, postId, status, userOf(req).id) };
  });
  app.post("/projects/:projectId/posts/:postId/schedule", P, async (req) => {
    const { postId } = req.params as { postId: string };
    const body = parse(scheduleSchema, req.body);
    return schedulePost(req.project, postId, body, userActor(req));
  });
  app.post("/projects/:projectId/posts/:postId/publish-now", P, async (req) => {
    const { postId } = req.params as { postId: string };
    const body = parse(z.object({ platforms: z.array(z.enum(SOCIAL_PLATFORMS)).optional() }), req.body);
    // No API posting: "now" puts the post on the Ready to post desk immediately.
    return schedulePost(req.project, postId, { scheduledAt: new Date(), platforms: body.platforms }, userActor(req));
  });
  app.post("/projects/:projectId/posts/:postId/unschedule", P, async (req) => {
    const { postId } = req.params as { postId: string };
    await unschedulePost(req.project, postId, userOf(req).id);
    return { ok: true };
  });
  app.post("/projects/:projectId/posts/:postId/restore", P, async (req) => {
    const { postId } = req.params as { postId: string };
    const { version } = parse(z.object({ version: z.number().int().min(1) }), req.body);
    return { post: await restorePostVersion(req.project, postId, version, "user") };
  });
  app.post("/projects/:projectId/posts/:postId/duplicate", P, async (req) => {
    const { postId } = req.params as { postId: string };
    return { post: await duplicatePost(req.project, postId, "user") };
  });
  app.post("/projects/:projectId/targets/:targetId/retry", P, async (req) => {
    const { targetId } = req.params as { targetId: string };
    await retryTarget(req.project, targetId);
    return { ok: true };
  });
  app.post("/projects/:projectId/targets/:targetId/manual-published", P, async (req) => {
    const { targetId } = req.params as { targetId: string };
    const { url } = parse(z.object({ url: z.string().url().optional() }), req.body);
    // With a link, use the validated flow so the post is tracked in Analytics.
    if (url) await markPosted(req.project, targetId, { url }, userOf(req).id);
    else await markManualPublished(req.project, targetId, undefined, userOf(req).id);
    return { ok: true };
  });

  /** AI writing helpers (rewrite, translate, hooks, hashtags, CTAs, platform variants). Suggestions only — nothing is saved. */
  app.post("/projects/:projectId/content/assist", P, async (req) => {
    const body = parse(
      z.object({
        text: z.string().min(1).max(10000),
        mode: z.enum(["rewrite", "shorten", "translate", "hooks", "hashtags", "cta", "variants", "thread"]),
        instruction: z.string().max(1000).optional(),
        language: z.string().max(40).optional(),
        platforms: z.array(z.enum(SOCIAL_PLATFORMS)).default(["x", "instagram", "tiktok"]),
      }),
      req.body,
    );
    const brand = (req.project.brand ?? {}) as Brand;
    const tasks: Record<typeof body.mode, string> = {
      rewrite: "Rewrite the text in 3 different ways, keeping the meaning.",
      shorten: "Produce 3 shorter versions; one must fit in 280 characters.",
      translate: `Translate the text into ${body.language ?? "Spanish"}, adapting idioms naturally. Return 1 suggestion.`,
      hooks: "Write 5 scroll-stopping opening hooks for this post.",
      hashtags: "Suggest 3 sets of relevant hashtags (5-8 each, no #) — mix broad and niche, no banned or misleading tags.",
      cta: "Suggest 5 clear calls to action suitable for this post.",
      variants: `Write one platform-optimized version for each of: ${body.platforms.join(", ")} (X ≤ 280 chars). Return them in suggestions with the platform name as label.`,
      thread: "Turn the text into an X thread of 3-8 posts, each ≤ 280 characters. Return each post as a suggestion in order.",
    };
    const r = await aiJson(
      { userId: userOf(req).id, projectId: req.project.id },
      {
        system: `You are a social media copywriter for ${req.project.name}. Voice: ${brand.voice || "clear and friendly"}. Tone: ${(brand.tone ?? []).join(", ")}. Avoid: ${(brand.doNotSay ?? []).join(", ")}. Never invent facts or statistics.`,
        prompt: `${tasks[body.mode]}${body.instruction ? `\nExtra instruction: ${body.instruction}` : ""}\n\nText:\n"""${body.text}"""`,
        schemaHint: '{"suggestions": [{"label": string, "text": string}]}',
        schema: z.object({ suggestions: z.array(z.object({ label: z.string().default(""), text: z.string() })).min(1) }),
        maxTokens: 3000,
      },
      req.project,
    );
    return r.data;
  });

  // ───── Calendar & queues ─────
  app.get("/projects/:projectId/calendar", P, async (req) => {
    const q = parse(z.object({ from: z.coerce.date(), to: z.coerce.date() }), req.query);
    if (+q.to - +q.from > 100 * 86400_000) throw badRequest("Range too large");
    return { posts: await upcomingTargets(req.project.id, q.from, q.to), timezone: req.project.timezone };
  });

  app.get("/projects/:projectId/queues", P, async (req) => ({ queues: await prisma.recurringQueue.findMany({ where: { projectId: req.project.id }, orderBy: { createdAt: "asc" } }) }));
  const queueSchema = z.object({
    name: z.string().min(1).max(100),
    platforms: z.array(z.enum(SOCIAL_PLATFORMS)).min(1),
    slots: z.array(z.object({ weekday: z.number().int().min(0).max(6), time: z.string().regex(/^\d{1,2}:\d{2}$/) })).min(1).max(70),
    timezone: z.string().default("UTC"),
    active: z.boolean().default(true),
  });
  app.post("/projects/:projectId/queues", P, async (req) => ({ queue: await prisma.recurringQueue.create({ data: { ...parse(queueSchema, req.body), projectId: req.project.id } }) }));
  app.patch("/projects/:projectId/queues/:queueId", P, async (req) => {
    const { queueId } = req.params as { queueId: string };
    const r = await prisma.recurringQueue.updateMany({ where: { id: queueId, projectId: req.project.id }, data: parse(queueSchema.partial(), req.body) });
    if (!r.count) throw notFound("Queue");
    return { ok: true };
  });
  app.delete("/projects/:projectId/queues/:queueId", P, async (req) => {
    const { queueId } = req.params as { queueId: string };
    await prisma.recurringQueue.deleteMany({ where: { id: queueId, projectId: req.project.id } });
    return { ok: true };
  });
  /** Puts a post into the next free slot of a recurring queue (timezone-aware). */
  app.post("/projects/:projectId/posts/:postId/queue", P, async (req) => {
    const { postId } = req.params as { postId: string };
    const { queueId } = parse(z.object({ queueId: z.string() }), req.body);
    const queue = await prisma.recurringQueue.findFirst({ where: { id: queueId, projectId: req.project.id, active: true } });
    if (!queue) throw notFound("Queue");
    const taken = new Set((await prisma.post.findMany({ where: { projectId: req.project.id, queueId, status: { in: ["scheduled", "in_review"] } }, select: { scheduledAt: true } })).map((p) => p.scheduledAt?.getTime()));
    const slots = queue.slots as { weekday: number; time: string }[];
    let chosen: Date | null = null;
    for (let d = 0; d < 60 && !chosen; d++) {
      const day = new Date(Date.now() + d * 86400_000);
      for (const s of [...slots].sort((a, b) => a.time.localeCompare(b.time))) {
        const [h, m] = s.time.split(":").map(Number);
        const localMidnight = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m));
        const at = new Date(localMidnight.getTime() - tzOffsetMinutes(localMidnight, queue.timezone) * 60_000);
        const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(new Intl.DateTimeFormat("en-US", { timeZone: queue.timezone, weekday: "short" }).format(at));
        if (weekday !== s.weekday || at.getTime() < Date.now() + 5 * 60_000 || taken.has(at.getTime())) continue;
        chosen = at;
        break;
      }
    }
    if (!chosen) throw badRequest("No free slot in the next 60 days");
    const r = await schedulePost(req.project, postId, { scheduledAt: chosen, timezone: queue.timezone, platforms: queue.platforms as any }, userActor(req));
    await prisma.post.update({ where: { id: postId }, data: { queueId } });
    return { ...r, scheduledAt: chosen };
  });
}
