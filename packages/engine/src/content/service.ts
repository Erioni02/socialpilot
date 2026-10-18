import { prisma, Prisma, type Post, type Project } from "@socialpilot/db";
import { badRequest, conflict, notFound } from "@socialpilot/core";
import {
  CAPABILITY_REGISTRY,
  normalizePolicy,
  PLATFORM_LIMITS,
  withUtm,
  type Brand,
  type PostInput,
  type SocialOperation,
  type SocialPlatform,
} from "@socialpilot/shared";
import { z } from "zod";
import { aiJson, hasTextAI } from "../ai/service";
import { emit } from "../infra/events";
import { audit } from "../infra/audit";

type Variants = Partial<Record<SocialPlatform, { text?: string; thread?: string[]; title?: string; privacyLevel?: string }>>;

function snapshot(p: Post) {
  return {
    title: p.title,
    type: p.type,
    body: p.body,
    platforms: p.platforms,
    variants: p.variants,
    hashtags: p.hashtags,
    cta: p.cta,
    link: p.link,
    mediaAssetIds: p.mediaAssetIds,
    notes: p.notes,
    campaignId: p.campaignId,
  };
}

async function validateRefs(projectId: string, input: Partial<PostInput>) {
  if (input.campaignId) {
    const c = await prisma.campaign.findFirst({ where: { id: input.campaignId, projectId } });
    if (!c) throw badRequest("Campaign not found in this project");
  }
  if (input.mediaAssetIds?.length) {
    const n = await prisma.asset.count({ where: { id: { in: input.mediaAssetIds }, projectId } });
    if (n !== new Set(input.mediaAssetIds).size) throw badRequest("One or more media assets do not belong to this project");
  }
}

export async function createPost(project: Project, input: PostInput, createdBy: string) {
  await validateRefs(project.id, input);
  const post = await prisma.post.create({
    data: {
      projectId: project.id,
      campaignId: input.campaignId ?? null,
      title: input.title,
      type: input.type,
      body: input.body,
      platforms: input.platforms,
      variants: input.variants as Prisma.InputJsonValue,
      hashtags: input.hashtags.map((h) => h.replace(/^#/, "")),
      cta: input.cta,
      link: input.link ?? null,
      mediaAssetIds: input.mediaAssetIds,
      notes: input.notes,
      createdBy,
      timezone: project.timezone,
    },
  });
  await prisma.postVersion.create({ data: { postId: post.id, version: 1, snapshot: snapshot(post) as Prisma.InputJsonValue, createdBy } });
  await emit({ type: "post.updated", projectId: project.id, data: { id: post.id } });
  return post;
}

const EDITABLE = ["draft", "in_review", "approved", "failed", "cancelled", "manual_handoff"];

export async function updatePost(project: Project, postId: string, patch: Partial<PostInput>, by: string) {
  const post = await prisma.post.findFirst({ where: { id: postId, projectId: project.id } });
  if (!post) throw notFound("Post");
  if (!EDITABLE.includes(post.status)) throw conflict(`A ${post.status} post cannot be edited. Unschedule it first.`);
  await validateRefs(project.id, patch);
  const updated = await prisma.post.update({
    where: { id: post.id },
    data: {
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.type !== undefined && { type: patch.type }),
      ...(patch.body !== undefined && { body: patch.body }),
      ...(patch.platforms !== undefined && { platforms: patch.platforms }),
      ...(patch.variants !== undefined && { variants: patch.variants as Prisma.InputJsonValue }),
      ...(patch.hashtags !== undefined && { hashtags: patch.hashtags.map((h) => h.replace(/^#/, "")) }),
      ...(patch.cta !== undefined && { cta: patch.cta }),
      ...(patch.link !== undefined && { link: patch.link }),
      ...(patch.mediaAssetIds !== undefined && { mediaAssetIds: patch.mediaAssetIds }),
      ...(patch.notes !== undefined && { notes: patch.notes }),
      ...(patch.campaignId !== undefined && { campaignId: patch.campaignId }),
      // Content changed after approval → needs review again.
      status: post.status === "approved" ? "draft" : post.status === "cancelled" || post.status === "failed" ? "draft" : post.status,
      version: { increment: 1 },
      qualityReport: Prisma.DbNull,
    },
  });
  await prisma.postVersion.create({ data: { postId: post.id, version: updated.version, snapshot: snapshot(updated) as Prisma.InputJsonValue, createdBy: by } });
  await emit({ type: "post.updated", projectId: project.id, data: { id: post.id } });
  return updated;
}

export async function restorePostVersion(project: Project, postId: string, version: number, by: string) {
  const v = await prisma.postVersion.findFirst({ where: { postId, version, post: { projectId: project.id } } });
  if (!v) throw notFound("Version");
  const s = v.snapshot as Record<string, any>;
  return updatePost(project, postId, { ...s, link: s.link ?? null } as Partial<PostInput>, by);
}

/** The exact text that will be published on a platform (variant or master copy + hashtags + tracked link). */
export function renderPlatformText(post: Post, platform: SocialPlatform, campaignSlug?: string | null): { text: string; thread?: string[]; title?: string; privacyLevel?: string } {
  const v = ((post.variants ?? {}) as Variants)[platform] ?? {};
  const base = (v.text?.trim() || post.body).trim();
  const tags = post.hashtags.length && !/#\w/.test(base) ? "\n\n" + post.hashtags.map((h) => `#${h}`).join(" ") : "";
  const link = post.link ? withUtm(post.link, { source: platform, medium: "social", campaign: campaignSlug ?? undefined, content: post.id }) : "";
  let text = base;
  if (post.cta && !base.includes(post.cta)) text += `\n\n${post.cta}`;
  // Instagram/TikTok captions don't render clickable links; X does.
  if (link && platform === "x") text += `\n${link}`;
  text += tags;
  const thread = v.thread?.length ? v.thread.map((t, i) => (i === v.thread!.length - 1 && link && platform === "x" && !t.includes(link) ? `${t}\n${link}` : t)) : undefined;
  return { text: text.trim(), thread, title: v.title, privacyLevel: v.privacyLevel };
}

export function requiredOperation(post: Pick<Post, "type" | "mediaAssetIds">, mediaKinds: string[]): SocialOperation {
  if (mediaKinds.includes("video") || post.type === "video" || post.type === "reel") return "publish_video";
  if (mediaKinds.length > 1 || post.type === "carousel") return "publish_carousel";
  if (mediaKinds.length === 1 || post.type === "image") return "publish_image";
  if (post.type === "thread") return "publish_thread";
  return "publish_text";
}

export interface QualityCheck {
  id: string;
  platform?: string;
  level: "error" | "warning" | "pass";
  message: string;
}

/** Deterministic content checks (+ optional AI brand review) before scheduling. */
export async function qualityCheck(userId: string, project: Project, postId: string, opts: { ai?: boolean } = {}) {
  const post = await prisma.post.findFirst({ where: { id: postId, projectId: project.id }, include: { campaign: true } });
  if (!post) throw notFound("Post");
  const assets = post.mediaAssetIds.length ? await prisma.asset.findMany({ where: { id: { in: post.mediaAssetIds } } }) : [];
  const kinds = assets.map((a) => a.kind);
  const checks: QualityCheck[] = [];
  const brand = (project.brand ?? {}) as Brand;
  const limits = normalizePolicy(project.policy).limits;
  if (!post.platforms.length) checks.push({ id: "platforms", level: "error", message: "Select at least one platform." });
  if (!post.body.trim() && !Object.values((post.variants ?? {}) as Variants).some((v) => v?.text?.trim())) checks.push({ id: "empty", level: "error", message: "The post has no text." });
  if (assets.some((a) => a.status !== "ready")) checks.push({ id: "media-ready", level: "error", message: "Some attached media is still processing or failed." });
  for (const platform of post.platforms as SocialPlatform[]) {
    const rendered = renderPlatformText(post, platform, post.campaign?.slug);
    const lim = PLATFORM_LIMITS[platform];
    const op = requiredOperation(post, kinds);
    const cap = CAPABILITY_REGISTRY[platform][op];
    if (!cap.supported) checks.push({ id: `unsupported-${platform}`, platform, level: "warning", message: `${platform}: ${op.replace("_", " ")} is not supported by the API — it will be a manual handoff. ${cap.alternative ?? ""}`.trim() });
    const parts = rendered.thread ?? [rendered.text];
    parts.forEach((p, i) => {
      if (p.length > lim.maxChars) checks.push({ id: `length-${platform}-${i}`, platform, level: "error", message: `${platform}${parts.length > 1 ? ` part ${i + 1}` : ""}: ${p.length}/${lim.maxChars} characters.` });
    });
    const tagCount = (rendered.text.match(/#\w+/g) ?? []).length;
    if (tagCount > lim.maxHashtags) checks.push({ id: `hashtags-${platform}`, platform, level: "error", message: `${platform}: ${tagCount} hashtags (max ${lim.maxHashtags}).` });
    if (kinds.filter((k) => k === "image").length > lim.maxImages) checks.push({ id: `images-${platform}`, platform, level: "error", message: `${platform}: max ${lim.maxImages} images.` });
    if ((platform === "instagram" || platform === "tiktok") && !kinds.length) checks.push({ id: `media-${platform}`, platform, level: "error", message: `${platform} requires an image or video.` });
    if (platform === "tiktok" && kinds.includes("image") && !kinds.includes("video")) checks.push({ id: "tiktok-photo", platform, level: "warning", message: "TikTok photo posts need PUBLIC_BASE_URL on a verified domain." });
    if (platform === "instagram" && post.link) checks.push({ id: "ig-link", platform, level: "warning", message: "Links in Instagram captions are not clickable — mention “link in bio”." });
  }
  const hay = `${post.body} ${Object.values((post.variants ?? {}) as Variants).map((v) => v?.text ?? "").join(" ")}`.toLowerCase();
  for (const w of [...(brand.doNotSay ?? []), ...limits.blockedTopics]) {
    if (w && hay.includes(w.toLowerCase())) checks.push({ id: `blocked-${w}`, level: "error", message: `Contains a blocked word/topic: “${w}”.` });
  }
  if (!post.cta && !/\b(link|try|sign up|join|download|check|visit|get)\b/i.test(hay)) checks.push({ id: "cta", level: "warning", message: "No clear call to action." });
  if (!checks.some((c) => c.level !== "pass")) checks.push({ id: "all", level: "pass", message: "All checks passed." });

  let ai: unknown = null;
  if (opts.ai && (await hasTextAI(userId, project))) {
    const schema = z.object({
      score: z.number().min(0).max(10),
      onBrand: z.boolean(),
      issues: z.array(z.string()).default([]),
      suggestions: z.array(z.string()).default([]),
      risk: z.enum(["low", "medium", "high"]).default("low"),
    });
    const r = await aiJson(
      { userId, projectId: project.id },
      {
        system: "You are a strict social media editor and brand-safety reviewer. Be concise and specific.",
        prompt: `Brand: ${project.name}. Voice: ${brand.voice || "n/a"}. Tone: ${(brand.tone ?? []).join(", ") || "n/a"}. Guidelines: ${brand.guidelines || "n/a"}.\nReview this draft for ${post.platforms.join(", ")}:\n"""${post.body}"""\nVariants: ${JSON.stringify(post.variants)}`,
        schemaHint: '{"score": number 0-10, "onBrand": boolean, "issues": string[], "suggestions": string[], "risk": "low"|"medium"|"high"}',
        schema,
        maxTokens: 1500,
      },
      project,
    );
    ai = r.data;
  }
  const report = { checks, ai, checkedAt: new Date().toISOString(), version: post.version, ok: !checks.some((c) => c.level === "error") };
  await prisma.post.update({ where: { id: post.id }, data: { qualityReport: report as unknown as Prisma.InputJsonValue } });
  return report;
}

export async function setPostStatus(project: Project, postId: string, status: "draft" | "in_review" | "approved" | "cancelled", userId: string) {
  const post = await prisma.post.findFirst({ where: { id: postId, projectId: project.id } });
  if (!post) throw notFound("Post");
  if (["published", "publishing"].includes(post.status)) throw conflict(`Post is ${post.status}`);
  if (status === "cancelled") {
    await prisma.postTarget.updateMany({ where: { postId, status: { in: ["pending", "scheduled", "manual"] } }, data: { status: "cancelled" } });
  }
  const updated = await prisma.post.update({ where: { id: postId }, data: { status, ...(status === "cancelled" ? { scheduledAt: null } : {}) } });
  await audit({ userId, projectId: project.id, actor: "user", action: `post.${status}`, target: postId });
  await emit({ type: "post.updated", projectId: project.id, data: { id: postId } });
  return updated;
}

export async function duplicatePost(project: Project, postId: string, by: string) {
  const post = await prisma.post.findFirst({ where: { id: postId, projectId: project.id } });
  if (!post) throw notFound("Post");
  const s = snapshot(post) as any;
  return createPost(project, { ...s, title: `${post.title || "Untitled"} (copy)`, link: post.link ?? null, variants: post.variants as any }, by);
}
