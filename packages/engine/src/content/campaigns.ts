import { prisma, Prisma, type Campaign, type Project } from "@socialpilot/db";
import { badRequest, notFound } from "@socialpilot/core";
import { slugify, SOCIAL_PLATFORMS, type Brand } from "@socialpilot/shared";
import { z } from "zod";
import { aiJson } from "../ai/service";
import { createPost } from "./service";
import { generateImages } from "../media/service";
import { emit } from "../infra/events";

export async function createCampaign(project: Project, input: any, createdBy = "user") {
  const base = slugify(input.name) || "campaign";
  let slug = base;
  for (let i = 2; await prisma.campaign.findFirst({ where: { projectId: project.id, slug } }); i++) slug = `${base}-${i}`;
  const c = await prisma.campaign.create({
    data: {
      projectId: project.id,
      name: input.name,
      slug,
      objective: input.objective ?? "",
      targetAudience: input.targetAudience ?? "",
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      platforms: input.platforms ?? [],
      pillars: (input.pillars ?? []) as Prisma.InputJsonValue,
      guidelines: input.guidelines ?? "",
      budgetUsd: input.budgetUsd ?? null,
      status: input.status ?? "planning",
      createdBy,
    },
  });
  await emit({ type: "campaign.updated", projectId: project.id, data: { id: c.id } });
  return c;
}

const planSchema = z.object({
  summary: z.string(),
  pillars: z.array(z.string()).default([]),
  kpis: z.array(z.string()).default([]),
  posts: z.array(
    z.object({
      day: z.number().int().min(1),
      time: z.string().default("10:00"),
      platforms: z.array(z.enum(SOCIAL_PLATFORMS)).min(1),
      type: z.enum(["text", "thread", "image", "carousel", "video", "reel"]),
      title: z.string(),
      body: z.string(),
      thread: z.array(z.string()).optional(),
      xText: z.string().optional(),
      hashtags: z.array(z.string()).default([]),
      cta: z.string().default(""),
      imagePrompt: z.string().optional(),
      pillar: z.string().optional(),
    }),
  ),
});
export type CampaignPlan = z.infer<typeof planSchema>;

/** AI campaign plan grounded in the brand profile; stored on the campaign. */
export async function generateCampaignPlan(userId: string, project: Project, campaignId: string, opts: { days?: number; postsPerDay?: number; extra?: string; taskId?: string } = {}) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, projectId: project.id } });
  if (!campaign) throw notFound("Campaign");
  const brand = (project.brand ?? {}) as Brand;
  const days = opts.days ?? (campaign.startDate && campaign.endDate ? Math.max(1, Math.round((+campaign.endDate - +campaign.startDate) / 86400_000) + 1) : 7);
  const platforms = campaign.platforms.length ? campaign.platforms : ["x", "instagram"];
  const r = await aiJson(
    { userId, projectId: project.id, taskId: opts.taskId },
    {
      system:
        "You are a senior social media strategist. Write original, specific, honest content. Respect platform norms: X ≤ 280 chars per post (use threads for longer), Instagram/TikTok need visuals (provide an imagePrompt), no fake statistics or testimonials.",
      prompt: `Brand: ${project.name} (${project.websiteUrl ?? "no site"})\nDescription: ${project.description}\nAudience: ${campaign.targetAudience || project.targetAudience}\nProducts: ${JSON.stringify(project.products)}\nVoice: ${brand.voice}; tone: ${(brand.tone ?? []).join(", ")}; avoid: ${(brand.doNotSay ?? []).join(", ")}\nGuidelines: ${brand.guidelines}\n\nCampaign: ${campaign.name}\nObjective: ${campaign.objective}\nPillars: ${JSON.stringify(campaign.pillars)}\nPlatforms: ${platforms.join(", ")}\nCampaign guidelines: ${campaign.guidelines}\n${opts.extra ? `Additional instructions: ${opts.extra}\n` : ""}\nCreate a ${days}-day plan with about ${opts.postsPerDay ?? 1} post(s) per day.`,
      schemaHint:
        '{"summary": string, "pillars": string[], "kpis": string[], "posts": [{"day": number, "time": "HH:MM", "platforms": ("x"|"instagram"|"tiktok")[], "type": "text"|"thread"|"image"|"carousel"|"video"|"reel", "title": string, "body": string (master caption), "thread"?: string[] (X thread parts), "xText"?: string (≤280 chars X version), "hashtags": string[], "cta": string, "imagePrompt"?: string, "pillar"?: string}]}',
      schema: planSchema,
      role: "reasoning",
      maxTokens: 12000,
    },
    project,
  );
  await prisma.campaign.update({ where: { id: campaign.id }, data: { plan: r.data as unknown as Prisma.InputJsonValue } });
  await emit({ type: "campaign.updated", projectId: project.id, data: { id: campaign.id } });
  return r.data;
}

/** Turns the stored plan into real draft posts and (optionally) real generated images. */
export async function materializePlan(userId: string, project: Project, campaign: Campaign, opts: { generateImages?: boolean; createdBy?: string; taskId?: string } = {}) {
  const plan = campaign.plan as CampaignPlan | null;
  if (!plan?.posts?.length) throw badRequest("This campaign has no plan yet");
  const createdBy = opts.createdBy ?? "user";
  const posts = [];
  const errors: string[] = [];
  for (const p of plan.posts) {
    const mediaAssetIds: string[] = [];
    if (opts.generateImages && p.imagePrompt && ["image", "carousel", "reel", "video"].includes(p.type)) {
      try {
        const assets = await generateImages(
          { userId, projectId: project.id, taskId: opts.taskId, project, createdBy },
          { prompt: p.imagePrompt, size: p.platforms.includes("instagram") || p.platforms.includes("tiktok") ? "1024x1536" : "1024x1024", folder: `/campaigns/${campaign.slug}`, campaignId: campaign.id, name: p.title },
        );
        mediaAssetIds.push(...assets.map((a) => a.id));
      } catch (e) {
        errors.push(`Image for “${p.title}”: ${(e as Error).message}`);
      }
    }
    const variants: Record<string, unknown> = {};
    if (p.platforms.includes("x")) variants.x = { text: p.xText ?? (p.body.length <= 280 ? p.body : ""), thread: p.thread };
    const post = await createPost(
      project,
      {
        title: p.title,
        type: mediaAssetIds.length ? (p.type === "text" || p.type === "thread" ? "image" : p.type) : p.type === "image" || p.type === "carousel" ? "text" : p.type,
        body: p.body,
        campaignId: campaign.id,
        platforms: p.platforms,
        variants: variants as any,
        hashtags: p.hashtags,
        cta: p.cta,
        link: project.websiteUrl,
        mediaAssetIds,
        notes: `Plan day ${p.day} at ${p.time}${p.pillar ? ` · pillar: ${p.pillar}` : ""}${p.imagePrompt && !mediaAssetIds.length ? `\nImage prompt: ${p.imagePrompt}` : ""}`,
      },
      createdBy,
    );
    posts.push(post);
  }
  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: campaign.status === "planning" ? "active" : campaign.status } });
  return { posts, errors };
}

/** Suggested schedule time for plan day N (campaign start or tomorrow). */
export function planSlot(campaign: Campaign, day: number, time: string, tz: string): Date {
  const start = campaign.startDate ?? new Date(Date.now() + 86400_000);
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + day - 1);
  const [h, m] = time.split(":").map(Number);
  const local = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h || 10, m || 0));
  const offset = tzOffsetMinutes(local, tz);
  return new Date(local.getTime() - offset * 60_000);
}

export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - date.getTime()) / 60_000);
}
