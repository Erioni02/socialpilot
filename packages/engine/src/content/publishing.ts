import { prisma, Prisma, type Post, type PostTarget, type Project } from "@socialpilot/db";
import { AppError, badRequest, createLogger, notFound, ProviderError, redactString, SetupRequiredError } from "@socialpilot/core";
import { socialAdapter, type PublishMedia } from "@socialpilot/social";
import { CAPABILITY_REGISTRY, explainUnavailable, isWithinPublishHours, normalizePolicy, type SocialPlatform } from "@socialpilot/shared";
import { adapterContext } from "../integrations/service";
import { getObject, signedPublicUrl } from "../infra/storage";
import { emit } from "../infra/events";
import { enqueue, PermanentError, type JobContext } from "../infra/queue";
import { audit, notify } from "../infra/audit";
import { assertNotStopped, guard, type Actor, actorLabel } from "../projects/context";
import { qualityCheck, renderPlatformText, requiredOperation } from "./service";
import { requestApproval } from "../approvals/service";

const log = createLogger("publishing");

async function mediaKinds(post: Post) {
  if (!post.mediaAssetIds.length) return [];
  const assets = await prisma.asset.findMany({ where: { id: { in: post.mediaAssetIds } } });
  return post.mediaAssetIds.map((id) => assets.find((a) => a.id === id)?.kind ?? "image");
}

/**
 * Schedules a post. Humans schedule directly; agents/automations go through the permission gate,
 * and outbound publishing creates an approval when the policy requires it.
 */
export async function schedulePost(project: Project, postId: string, input: { scheduledAt: Date; timezone?: string; platforms?: SocialPlatform[] }, actor: Actor, opts: { forceApproval?: boolean; manual?: boolean } = {}) {
  const post = await prisma.post.findFirst({ where: { id: postId, projectId: project.id } });
  if (!post) throw notFound("Post");
  if (["published", "publishing", "scheduled"].includes(post.status)) throw badRequest(`Post is already ${post.status}`);
  const platforms = (input.platforms ?? post.platforms) as SocialPlatform[];
  if (!platforms.length) throw badRequest("Choose at least one platform");
  if (input.scheduledAt.getTime() < Date.now() - 60_000) throw badRequest("Scheduled time is in the past");

  if (actor.kind !== "user") {
    await guard(project, "schedule", actor);
  }
  // SocialPilot never posts to social networks: everything goes to the owner's Ready to post desk.
  opts = { ...opts, manual: true };
  const publishGate = { requiresApproval: false };

  const ownerId = project.ownerId;
  const report = await qualityCheck(ownerId, project, post.id);
  if (!report.ok) throw badRequest("Fix the quality check errors before scheduling", report.checks.filter((c) => c.level === "error"));

  const kinds = await mediaKinds(post);
  const op = requiredOperation(post, kinds);
  const targets: { platform: SocialPlatform; integrationId: string | null; status: string; lastError?: string }[] = [];
  for (const platform of platforms) {
    if (opts.manual) {
      targets.push({ platform, integrationId: null, status: "manual", lastError: "You publish this one yourself from Ready to post." });
      continue;
    }
    const integration = await prisma.integration.findFirst({ where: { projectId: project.id, provider: platform, status: { in: ["connected", "error"] } } });
    const unsupported = !CAPABILITY_REGISTRY[platform][op].supported;
    if (!integration || unsupported) {
      targets.push({
        platform,
        integrationId: integration?.id ?? null,
        status: "manual",
        lastError: unsupported ? explainUnavailable(platform, op, []) ?? "Unsupported" : `${platform} is not connected — manual handoff at the scheduled time.`,
      });
      continue;
    }
    const why = explainUnavailable(platform, op, integration.scopes);
    if (why) {
      targets.push({ platform, integrationId: integration.id, status: "manual", lastError: why });
      continue;
    }
    targets.push({ platform, integrationId: integration.id, status: "scheduled" });
  }

  const needsApproval = publishGate.requiresApproval || (!!opts.forceApproval && actor.kind !== "user");
  await prisma.$transaction(async (tx) => {
    await tx.postTarget.deleteMany({ where: { postId: post.id, status: { in: ["pending", "scheduled", "manual", "cancelled", "failed"] } } });
    for (const t of targets) {
      await tx.postTarget.create({
        data: {
          postId: post.id,
          integrationId: t.integrationId,
          platform: t.platform,
          status: needsApproval && t.status === "scheduled" ? "pending" : t.status,
          scheduledAt: input.scheduledAt,
          lastError: t.lastError,
          idempotencyKey: `${post.id}:${t.platform}:v${post.version}:${Date.now()}`,
        },
      });
    }
    await tx.post.update({
      where: { id: post.id },
      data: {
        scheduledAt: input.scheduledAt,
        timezone: input.timezone ?? project.timezone,
        platforms,
        status: needsApproval ? "in_review" : targets.every((t) => t.status === "manual") ? "manual_handoff" : "scheduled",
      },
    });
  });

  let approvalId: string | undefined;
  if (needsApproval) {
    const approval = await requestApproval(project, {
      type: "publish",
      title: `Publish “${post.title || post.body.slice(0, 50)}” on ${platforms.join(", ")}`,
      summary: `Scheduled for ${input.scheduledAt.toISOString()} (${input.timezone ?? project.timezone}).`,
      payload: { postId: post.id, version: post.version, scheduledAt: input.scheduledAt.toISOString() },
      requestedBy: actorLabel(actor),
      taskId: actor.kind === "agent" ? actor.taskId : undefined,
    });
    approvalId = approval.id;
    await prisma.post.update({ where: { id: post.id }, data: { approvalId } });
  }
  await audit({ userId: ownerId, projectId: project.id, actor: actorLabel(actor), action: "post.scheduled", target: post.id, details: { platforms, scheduledAt: input.scheduledAt, needsApproval } });
  await emit({ type: "post.updated", projectId: project.id, data: { id: post.id } });
  return { postId: post.id, needsApproval, approvalId, targets };
}

/** Called when a publish approval is granted: releases pending targets to the scheduler. */
export async function releaseApprovedPost(postId: string, version: number) {
  const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  if (post.version !== version) throw new PermanentError("The post was edited after approval was requested. Request approval again.");
  await prisma.postTarget.updateMany({ where: { postId, status: "pending" }, data: { status: "scheduled" } });
  const now = new Date();
  if (post.scheduledAt && post.scheduledAt < now) await prisma.postTarget.updateMany({ where: { postId, status: "scheduled" }, data: { scheduledAt: now } });
  await prisma.post.update({ where: { id: postId }, data: { status: "scheduled" } });
  await emit({ type: "post.updated", projectId: post.projectId, data: { id: postId } });
}

export async function unschedulePost(project: Project, postId: string, userId: string) {
  const post = await prisma.post.findFirst({ where: { id: postId, projectId: project.id } });
  if (!post) throw notFound("Post");
  const active = await prisma.postTarget.count({ where: { postId, status: "publishing" } });
  if (active) throw badRequest("Publishing is in progress and cannot be stopped");
  await prisma.postTarget.updateMany({ where: { postId, status: { in: ["pending", "scheduled", "manual"] } }, data: { status: "cancelled" } });
  await prisma.approval.updateMany({ where: { projectId: project.id, type: "publish", status: "pending", payload: { path: ["postId"], equals: postId } }, data: { status: "expired" } });
  const published = await prisma.postTarget.count({ where: { postId, status: "published" } });
  await prisma.post.update({ where: { id: postId }, data: { status: published ? "partially_published" : "draft", scheduledAt: published ? post.scheduledAt : null } });
  await audit({ userId, projectId: project.id, actor: "user", action: "post.unscheduled", target: postId });
  await emit({ type: "post.updated", projectId: project.id, data: { id: postId } });
}

export async function retryTarget(project: Project, targetId: string) {
  const t = await prisma.postTarget.findFirst({ where: { id: targetId, post: { projectId: project.id } } });
  if (!t) throw notFound("Publication");
  if (t.status !== "failed") throw badRequest("Only failed publications can be retried");
  await prisma.postTarget.update({ where: { id: t.id }, data: { status: "scheduled", scheduledAt: new Date(), lastError: null } });
  await enqueue("publish.target", { targetId: t.id }, { projectId: project.id, dedupeKey: `publish:${t.id}:${t.attempts}:retry` });
  await refreshPostStatus(t.postId);
}

export async function markManualPublished(project: Project, targetId: string, url: string | undefined, userId: string) {
  const t = await prisma.postTarget.findFirst({ where: { id: targetId, post: { projectId: project.id } } });
  if (!t) throw notFound("Publication");
  await prisma.postTarget.update({ where: { id: t.id }, data: { status: "published", publishedAt: new Date(), remoteUrl: url ?? null, lastError: null, providerState: { manual: true } } });
  await audit({ userId, projectId: project.id, actor: "user", action: "post.manual_published", target: t.id, details: { url } });
  await refreshPostStatus(t.postId);
}

export async function refreshPostStatus(postId: string) {
  const targets = await prisma.postTarget.findMany({ where: { postId, status: { not: "cancelled" } } });
  const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  if (!targets.length) return;
  const s = targets.map((t) => t.status);
  let status = post.status;
  if (s.every((x) => x === "published")) status = "published";
  else if (s.some((x) => x === "publishing")) status = "publishing";
  else if (s.some((x) => x === "published") && s.some((x) => x === "failed" || x === "manual")) status = "partially_published";
  else if (s.every((x) => x === "failed")) status = "failed";
  else if (s.every((x) => x === "manual")) status = "manual_handoff";
  else if (s.some((x) => x === "scheduled")) status = "scheduled";
  if (status !== post.status) await prisma.post.update({ where: { id: postId }, data: { status } });
  await emit({ type: "post.updated", projectId: post.projectId, data: { id: postId, status } });
}

async function publishedToday(projectId: string) {
  const d = new Date();
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return prisma.postTarget.count({ where: { status: "published", publishedAt: { gte: start }, post: { projectId } } });
}

function nextWindowStart(limits: { publishHours: { start: number } }, tz: string): Date {
  // Step forward in 15-minute increments until inside the publishing window (max 48h).
  const t = new Date();
  for (let i = 0; i < 192; i++) {
    t.setTime(t.getTime() + 15 * 60_000);
    if (isWithinPublishHours({ publishHours: { start: limits.publishHours.start, end: 24 } } as any, t, tz)) return t;
  }
  return new Date(Date.now() + 3600_000);
}

/** Job: publish one target. Claiming is atomic so a target can never be published twice concurrently. */
export async function publishTargetJob(payload: { targetId: string }, ctx: JobContext) {
  const claimed = await prisma.postTarget.updateMany({ where: { id: payload.targetId, status: "scheduled" }, data: { status: "publishing", attempts: { increment: 1 } } });
  if (!claimed.count) return { skipped: "not in scheduled state" };
  const target = await prisma.postTarget.findUniqueOrThrow({ where: { id: payload.targetId }, include: { post: { include: { campaign: true } }, integration: true } });
  const post = target.post;
  const project = await prisma.project.findUniqueOrThrow({ where: { id: post.projectId } });
  await emit({ type: "post.updated", projectId: project.id, data: { id: post.id } });
  const fail = async (message: string, retryable: boolean) => {
    const willRetry = retryable && ctx.attempt < ctx.maxAttempts;
    await prisma.postTarget.update({ where: { id: target.id }, data: { status: willRetry ? "scheduled" : "failed", lastError: redactString(message).slice(0, 1000) } });
    await refreshPostStatus(post.id);
    if (!willRetry) {
      await notify({ userId: project.ownerId, projectId: project.id, type: "publish.failed", title: `Publishing to ${target.platform} failed`, body: message.slice(0, 300), link: `/projects/${project.id}/calendar` });
      await audit({ userId: project.ownerId, projectId: project.id, actor: "system", action: "post.publish_failed", target: target.id, details: { platform: target.platform, error: message } });
    }
  };
  try {
    await assertNotStopped(project);
    const policy = normalizePolicy(project.policy);
    if (post.createdBy !== "user") {
      if ((await publishedToday(project.id)) >= policy.limits.dailyPosts) {
        await prisma.postTarget.update({ where: { id: target.id }, data: { status: "scheduled", scheduledAt: new Date(Date.now() + 6 * 3600_000), lastError: "Daily post limit reached — rescheduled." } });
        return { deferred: "daily limit" };
      }
      if (!isWithinPublishHours(policy.limits, new Date(), project.timezone)) {
        const at = nextWindowStart(policy.limits, project.timezone);
        await prisma.postTarget.update({ where: { id: target.id }, data: { status: "scheduled", scheduledAt: at, lastError: "Outside allowed publishing hours — rescheduled." } });
        return { deferred: "publishing hours" };
      }
    }
    if (!target.integration) throw new PermanentError(`${target.platform} is not connected`);
    const adapter = socialAdapter(target.platform);
    const actx = await adapterContext(target.integration);
    const assets = post.mediaAssetIds.length ? await prisma.asset.findMany({ where: { id: { in: post.mediaAssetIds } } }) : [];
    const media: PublishMedia[] = [];
    for (const id of post.mediaAssetIds) {
      const asset = assets.find((a) => a.id === id);
      if (!asset?.currentVersionId) throw new PermanentError(`Media ${id} is missing`);
      const v = await prisma.assetVersion.findUniqueOrThrow({ where: { id: asset.currentVersionId } });
      if (target.platform === "instagram" && v.mimeType !== "image/jpeg" && v.mimeType.startsWith("image/")) {
        throw new PermanentError("Instagram only accepts JPEG images. Convert the image (Workspace → Format → JPEG or a platform preset) and try again.");
      }
      media.push({ kind: asset.kind === "video" ? "video" : "image", mimeType: v.mimeType, sizeBytes: v.sizeBytes, publicUrl: signedPublicUrl(v.storageKey), load: () => getObject(v.storageKey) });
    }
    const rendered = renderPlatformText(post, target.platform as SocialPlatform, post.campaign?.slug);
    const tiktokDefault = (target.integration.config as any)?.defaultPrivacyLevel;
    const result = await adapter.publish(
      actx,
      {
        type: post.type as any,
        text: rendered.text,
        thread: rendered.thread,
        title: rendered.title ?? post.title,
        media,
        privacyLevel: rendered.privacyLevel ?? tiktokDefault,
      },
      (target.providerState ?? {}) as Record<string, unknown>,
      async (state) => {
        await prisma.postTarget.update({ where: { id: target.id }, data: { providerState: state as Prisma.InputJsonValue } });
      },
    );
    if (result.status === "processing") {
      await enqueue("publish.checkStatus", { targetId: target.id, checks: 0 }, { projectId: project.id, runAt: new Date(Date.now() + 20_000) });
      return { processing: true };
    }
    await prisma.postTarget.update({ where: { id: target.id }, data: { status: "published", publishedAt: new Date(), remoteId: result.remoteId, remoteUrl: result.remoteUrl, lastError: null } });
    await refreshPostStatus(post.id);
    await audit({ userId: project.ownerId, projectId: project.id, actor: post.createdBy === "user" ? "user" : post.createdBy, action: "post.published", target: target.id, details: { platform: target.platform, remoteId: result.remoteId, url: result.remoteUrl } });
    return { published: result.remoteId };
  } catch (err) {
    if ((err as AppError).code === "emergency_stop" || (err as AppError).code === "project_paused") {
      // Paused, not failed: put it back so it publishes once the stop is lifted.
      await prisma.postTarget.update({ where: { id: target.id }, data: { status: "scheduled", lastError: (err as Error).message } });
      await refreshPostStatus(post.id);
      return { deferred: "stopped" };
    }
    const retryable = err instanceof ProviderError ? err.retryable : !(err instanceof PermanentError || err instanceof AppError || err instanceof SetupRequiredError);
    log.warn(`publish ${target.id} failed`, { error: (err as Error).message });
    await fail((err as Error).message, retryable);
    if (retryable && ctx.attempt < ctx.maxAttempts) throw err;
    return { failed: (err as Error).message };
  }
}

/** Job: poll asynchronous publishing (TikTok) until it completes. */
export async function checkPublishStatusJob(payload: { targetId: string; checks: number }) {
  const target = await prisma.postTarget.findUniqueOrThrow({ where: { id: payload.targetId }, include: { integration: true, post: true } });
  if (target.status !== "publishing" || !target.integration) return { skipped: true };
  const adapter = socialAdapter(target.platform);
  if (!adapter.checkPublishStatus) return { skipped: true };
  const r = await adapter.checkPublishStatus(await adapterContext(target.integration), (target.providerState ?? {}) as Record<string, unknown>);
  if (r.failed) {
    await prisma.postTarget.update({ where: { id: target.id }, data: { status: "failed", lastError: r.failed } });
    await refreshPostStatus(target.postId);
    return { failed: r.failed };
  }
  if (r.status === "published") {
    await prisma.postTarget.update({ where: { id: target.id }, data: { status: "published", publishedAt: new Date(), remoteId: r.remoteId, remoteUrl: r.remoteUrl } });
    await refreshPostStatus(target.postId);
    return { published: r.remoteId };
  }
  if (payload.checks > 60) {
    await prisma.postTarget.update({ where: { id: target.id }, data: { status: "failed", lastError: "The platform did not confirm publication within 30 minutes. Check the account before retrying to avoid a duplicate." } });
    await refreshPostStatus(target.postId);
    return { failed: "timeout" };
  }
  await enqueue("publish.checkStatus", { targetId: target.id, checks: payload.checks + 1 }, { projectId: target.post.projectId, runAt: new Date(Date.now() + 30_000) });
  return { pending: true };
}

/** Scheduler tick: enqueue due targets and raise manual-handoff notifications. */
export async function dispatchDueTargets() {
  const due = await prisma.postTarget.findMany({
    where: { status: "scheduled", scheduledAt: { lte: new Date() }, post: { project: { paused: false, owner: { emergencyStop: false } } } },
    take: 100,
    include: { post: true },
  });
  // SocialPilot no longer posts via APIs: any legacy "scheduled" target becomes a manual Ready-to-post item.
  for (const t of due) {
    await prisma.postTarget.update({ where: { id: t.id }, data: { status: "manual", integrationId: null, lastError: "You publish this one yourself from Ready to post." } });
    await refreshPostStatus(t.postId);
  }
  const manual = await prisma.postTarget.findMany({ where: { status: "manual", scheduledAt: { lte: new Date() }, providerState: { equals: {} } }, take: 50, include: { post: { include: { project: true } } } });
  for (const t of manual) {
    await prisma.postTarget.update({ where: { id: t.id }, data: { providerState: { handoffNotified: new Date().toISOString() } } });
    await notify({
      userId: t.post.project.ownerId,
      projectId: t.post.projectId,
      type: "publish.manual",
      title: `Manual post due on ${t.platform}`,
      body: "It's on your Ready to post page with platform-ready media and the caption. After posting, paste the link there.",
      link: `/projects/${t.post.projectId}/ready`,
    });
  }
  return { enqueued: due.length, manual: manual.length };
}

export async function upcomingTargets(projectId: string, from: Date, to: Date) {
  return prisma.post.findMany({
    where: { projectId, OR: [{ scheduledAt: { gte: from, lte: to } }, { targets: { some: { OR: [{ scheduledAt: { gte: from, lte: to } }, { publishedAt: { gte: from, lte: to } }] } } }] },
    include: { targets: true, campaign: { select: { id: true, name: true } } },
    orderBy: { scheduledAt: "asc" },
  });
}

export type { PostTarget };
