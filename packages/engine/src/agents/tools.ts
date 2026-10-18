import { prisma, Prisma, type Project, type Task } from "@socialpilot/db";
import { badRequest, notFound, redact, safeFetch } from "@socialpilot/core";
import * as cheerio from "cheerio";
import {
  effectiveCapabilities,
  imageOpSchema,
  INTEGRATION_CATALOG,
  normalizePolicy,
  postSchema,
  postUpdateSchema,
  SOCIAL_PLATFORMS,
  videoOpSchema,
  type Permission,
  type SocialPlatform,
} from "@socialpilot/shared";
import { socialAdapter } from "@socialpilot/social";
import { z } from "zod";
import type { ToolDef } from "@socialpilot/ai";
import { guard, type Actor } from "../projects/context";
import { budgetStatus } from "../ai/service";
import { campaignPerformance, socialAnalytics, webAnalytics } from "../analytics/service";
import { adapterContext } from "../integrations/service";
import { createPost, qualityCheck, updatePost } from "../content/service";
import { schedulePost } from "../content/publishing";
import { createCampaign, generateCampaignPlan, materializePlan } from "../content/campaigns";
import { applyImageOp, applyVideoOp, createAsset, generateImages, generateVideo, normalizeFolder, restoreVersion } from "../media/service";
import { draftReply, feedbackSummary, sendReply } from "../inbox/service";
import { generateOpportunities, listDiscoverItems, refreshDiscover } from "../discover/service";
import { listPulse } from "../intel/pulse";
import { getSkill, SKILLS } from "./skills";
import { listDeployments, listRepoFiles, proposeCodeChange, readRepoFile, requestMerge, requestPromotion, submitCodeChange } from "../website/code";
import { runWebsiteAudit } from "../website/audit";
import { analyzeMedia } from "../media/vision";
import { listFiles, moveFile, readFile, trashFile, writeFile } from "../media/files";
import { notify } from "../infra/audit";
import { emit } from "../infra/events";

export interface ToolContext {
  project: Project;
  task: Task;
  actor: Actor & { kind: "agent" };
  userId: string;
}

export interface AgentTool {
  name: string;
  description: string;
  permission: Permission | null;
  /** Paid tools additionally require spendMoney. */
  paid?: boolean;
  /** Output contains third-party content that must be treated as untrusted data. */
  untrusted?: boolean;
  schema: z.ZodTypeAny;
  jsonSchema: Record<string, unknown>;
  run(args: any, ctx: ToolContext): Promise<unknown>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const bool = (description: string) => ({ type: "boolean", description });
const arr = (items: unknown, description: string) => ({ type: "array", items, description });
const platformEnum = { type: "string", enum: [...SOCIAL_PLATFORMS] };

const postProps = {
  title: str("Internal title"),
  type: { type: "string", enum: ["text", "thread", "image", "carousel", "video", "reel"] },
  body: str("Master caption / post text"),
  campaignId: str("Campaign id (optional)"),
  platforms: arr(platformEnum, "Target platforms"),
  variants: { type: "object", description: "Per-platform overrides, e.g. {\"x\": {\"text\": \"…\", \"thread\": [\"…\"]}, \"tiktok\": {\"privacyLevel\": \"PUBLIC_TO_EVERYONE\"}}" },
  hashtags: arr({ type: "string" }, "Hashtags without #"),
  cta: str("Call to action"),
  link: str("Link to include (UTM parameters are added automatically)"),
  mediaAssetIds: arr({ type: "string" }, "Asset ids to attach (images/videos)"),
  notes: str("Notes for the reviewer"),
};

async function ownedAsset(projectId: string, assetId: string) {
  const a = await prisma.asset.findFirst({ where: { id: assetId, projectId } });
  if (!a) throw notFound("Asset");
  return a;
}

function assetView(a: any) {
  return { id: a.id, name: a.name, kind: a.kind, folder: a.folder, status: a.status, campaignId: a.campaignId, currentVersionId: a.currentVersionId };
}

export const TOOLS: AgentTool[] = [
  // ───── Planning & meta ─────
  {
    name: "update_plan",
    description: "Create or update the visible task plan. Call first with your steps, then update statuses as you go.",
    permission: null,
    schema: z.object({ steps: z.array(z.object({ title: z.string(), status: z.enum(["pending", "in_progress", "done", "skipped", "blocked"]), note: z.string().optional() })).min(1).max(30) }),
    jsonSchema: obj({ steps: arr(obj({ title: str("Step"), status: { type: "string", enum: ["pending", "in_progress", "done", "skipped", "blocked"] }, note: str("Optional note") }, ["title", "status"]), "Ordered steps") }, ["steps"]),
    async run(args, ctx) {
      await prisma.task.update({ where: { id: ctx.task.id }, data: { plan: args.steps as Prisma.InputJsonValue, status: "running" } });
      await emit({ type: "task.updated", projectId: ctx.project.id, data: { id: ctx.task.id } });
      return { ok: true };
    },
  },
  {
    name: "finish",
    description: "End the task with a summary of completed work, links to created items and any outstanding approvals or setup the user must do.",
    permission: null,
    schema: z.object({ summary: z.string(), completed: z.array(z.string()).default([]), outstanding: z.array(z.string()).default([]) }),
    jsonSchema: obj({ summary: str("What was done"), completed: arr({ type: "string" }, "Completed items"), outstanding: arr({ type: "string" }, "Approvals pending, setup needed, follow-ups") }, ["summary"]),
    async run(args) {
      return { finished: true, ...args };
    },
  },
  {
    name: "notify_user",
    description: "Send the project owner an in-app notification.",
    permission: null,
    schema: z.object({ title: z.string().max(200), body: z.string().max(2000).default("") }),
    jsonSchema: obj({ title: str("Title"), body: str("Body") }, ["title"]),
    async run(args, ctx) {
      await notify({ userId: ctx.userId, projectId: ctx.project.id, type: "agent.message", title: args.title, body: args.body, link: `/projects/${ctx.project.id}/agents?task=${ctx.task.id}` });
      return { ok: true };
    },
  },
  {
    name: "add_note",
    description: "Save a business note to the project's persistent context (findings, decisions, learnings).",
    permission: "createContent",
    schema: z.object({ title: z.string().max(200), body: z.string().max(20000) }),
    jsonSchema: obj({ title: str("Title"), body: str("Markdown body") }, ["title", "body"]),
    async run(args, ctx) {
      const n = await prisma.note.create({ data: { projectId: ctx.project.id, title: args.title, body: args.body, author: `agent:${ctx.actor.agentType}` } });
      return { noteId: n.id };
    },
  },
  // ───── Project context ─────
  {
    name: "get_project_profile",
    description: "Read the project's business profile, brand guidelines, objectives, autonomy level, limits and setup readiness.",
    permission: null,
    schema: z.object({}),
    jsonSchema: obj({}),
    async run(_a, ctx) {
      const p = ctx.project;
      const notes = await prisma.note.findMany({ where: { projectId: p.id }, orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }], take: 10, select: { title: true, body: true } });
      const policy = normalizePolicy(p.policy);
      return {
        name: p.name,
        websiteUrl: p.websiteUrl,
        description: p.description,
        targetAudience: p.targetAudience,
        industry: p.industry,
        products: p.products,
        objectives: p.objectives,
        brand: p.brand,
        keywords: p.keywords,
        competitors: p.competitors,
        timezone: p.timezone,
        autonomyLevel: policy.autonomyLevel,
        permissions: policy.permissions,
        approvals: policy.approvals,
        limits: policy.limits,
        notes: notes.map((n) => ({ title: n.title, body: n.body.slice(0, 1500) })),
      };
    },
  },
  {
    name: "get_integrations",
    description: "List connected integrations with their real, tested capabilities and errors.",
    permission: null,
    schema: z.object({}),
    jsonSchema: obj({}),
    async run(_a, ctx) {
      const list = await prisma.integration.findMany({ where: { projectId: ctx.project.id, status: { not: "disconnected" } } });
      return list.map((i) => ({
        provider: i.provider,
        name: INTEGRATION_CATALOG[i.provider as keyof typeof INTEGRATION_CATALOG]?.name,
        status: i.status,
        account: i.accountHandle ?? i.accountName,
        lastSyncAt: i.lastSyncAt,
        lastError: i.lastError,
        tests: i.testResults,
        config: i.provider === "github" ? { repo: (i.config as any).repo, baseBranch: (i.config as any).baseBranch } : undefined,
        capabilities: (SOCIAL_PLATFORMS as readonly string[]).includes(i.provider)
          ? effectiveCapabilities(i.provider as SocialPlatform, i.scopes).map((c) => ({ op: c.operation, available: c.available, note: c.available ? c.notes : c.alternative ?? c.notes }))
          : undefined,
      }));
    },
  },
  {
    name: "get_budget_status",
    description: "Current AI spend today/this month against the project's limits.",
    permission: null,
    schema: z.object({}),
    jsonSchema: obj({}),
    async run(_a, ctx) {
      const b = await budgetStatus(ctx.project);
      const t = await prisma.task.findUniqueOrThrow({ where: { id: ctx.task.id }, select: { costUsd: true } });
      return { ...b, thisTaskSoFar: t.costUsd };
    },
  },
  // ───── Analytics ─────
  {
    name: "get_social_metrics",
    description: "Measured social metrics (followers, reach, recent posts with engagement) for connected accounts.",
    permission: "readAccountData",
    schema: z.object({}),
    jsonSchema: obj({}),
    async run(_a, ctx) {
      const r = await socialAnalytics(ctx.project);
      return r.accounts.map((a: any) => ({ ...a, followersSeries: a.followersSeries?.slice(-14), topPosts: a.topPosts?.slice(0, 5).map((p: any) => ({ id: p.id, text: p.text.slice(0, 200), url: p.url, metrics: p.metrics, createdAt: p.createdAt })) }));
    },
  },
  {
    name: "get_website_analytics",
    description: "Measured website analytics (sessions, users, conversions, referrers, UTM campaigns) from GA4 or Plausible.",
    permission: "readAccountData",
    schema: z.object({ days: z.number().int().min(1).max(90).default(28) }),
    jsonSchema: obj({ days: num("Days, default 28") }),
    async run(args, ctx) {
      return webAnalytics(ctx.project, args.days);
    },
  },
  {
    name: "get_campaign_performance",
    description: "Per-campaign published posts, social totals and attributed website sessions (UTM).",
    permission: "readAccountData",
    schema: z.object({}),
    jsonSchema: obj({}),
    async run(_a, ctx) {
      return campaignPerformance(ctx.project);
    },
  },
  {
    name: "list_remote_posts",
    description: "Read recent posts from a connected social account (live from the platform API).",
    permission: "readAccountData",
    untrusted: true,
    schema: z.object({ platform: z.enum(SOCIAL_PLATFORMS), limit: z.number().int().min(1).max(25).default(10) }),
    jsonSchema: obj({ platform: platformEnum, limit: num("Max 25") }, ["platform"]),
    async run(args, ctx) {
      const i = await prisma.integration.findFirst({ where: { projectId: ctx.project.id, provider: args.platform, status: "connected" } });
      if (!i) throw badRequest(`${args.platform} is not connected`);
      const posts = await socialAdapter(args.platform).listPosts(await adapterContext(i), { limit: args.limit });
      return posts.map((p) => ({ ...p, text: p.text.slice(0, 500) }));
    },
  },
  // ───── Research ─────
  {
    name: "research_trends",
    description: "Search real, recently fetched news/launches/repos (Hacker News, GitHub, RSS, NewsAPI, Product Hunt). Every item has a source URL and publication time. Refreshes sources if stale.",
    permission: null,
    untrusted: true,
    schema: z.object({ query: z.string().optional(), category: z.enum(["all", "ai", "devtools", "startup", "social", "business", "tech"]).default("all"), hours: z.number().int().min(1).max(336).default(72), limit: z.number().int().min(1).max(60).default(30) }),
    jsonSchema: obj({ query: str("Keyword filter"), category: { type: "string", enum: ["all", "ai", "devtools", "startup", "social", "business", "tech"] }, hours: num("Lookback hours"), limit: num("Max items") }),
    async run(args) {
      const latest = await prisma.discoverSource.findFirst({ orderBy: { lastFetchAt: "desc" } });
      if (!latest?.lastFetchAt || Date.now() - latest.lastFetchAt.getTime() > 2 * 3600_000) await refreshDiscover();
      const items = await listDiscoverItems({ q: args.query, category: args.category, hours: args.hours, limit: args.limit });
      return items.map((i) => ({ itemId: i.id, title: i.title, url: i.url, source: i.sourceName, publishedAt: i.publishedAt, points: i.score, comments: i.comments, category: i.category, summary: i.summary.slice(0, 300) }));
    },
  },
  {
    name: "get_social_pulse",
    description: "What is rising on social media right now (Bluesky, Mastodon, Google Trends; TikTok/Instagram trending if the owner enabled paid crawling). Crawled every 20 minutes. Ranked by momentum and relevance to this project; every item has a source URL.",
    permission: null,
    untrusted: true,
    schema: z.object({ platform: z.enum(["all", "bluesky", "mastodon", "google_trends", "tiktok", "instagram"]).default("all"), hours: z.number().int().min(1).max(168).default(24), limit: z.number().int().min(1).max(50).default(25), relevantOnly: z.boolean().default(false) }),
    jsonSchema: obj({ platform: { type: "string", enum: ["all", "bluesky", "mastodon", "google_trends", "tiktok", "instagram"] }, hours: num("Lookback hours"), limit: num("Max items"), relevantOnly: { type: "boolean", description: "Only items matching project keywords" } }),
    async run(args, ctx) {
      const r = await listPulse(ctx.userId, { platform: args.platform, hours: args.hours, projectId: ctx.project.id, limit: 200 });
      const items = (args.relevantOnly ? r.items.filter((i) => i.matched.length) : r.items).slice(0, args.limit);
      return { lastCrawlAt: r.lastCrawlAt, items: items.map((i) => ({ itemId: i.id, platform: i.platform, kind: i.kind, title: i.title, summary: i.summary.slice(0, 280), url: i.url, author: i.author, signal: i.score, matchedKeywords: i.matched, firstSeenAt: i.firstSeenAt })) };
    },
  },
  {
    name: "load_skill",
    description: `Load an expert marketing/creative playbook into context. Available: ${SKILLS.map((s) => s.name).join(", ")}.`,
    permission: null,
    schema: z.object({ name: z.string() }),
    jsonSchema: obj({ name: { type: "string", enum: SKILLS.map((s) => s.name) } }, ["name"]),
    async run(args) {
      const s = getSkill(args.name);
      if (!s) return { error: `Unknown skill. Available: ${SKILLS.map((x) => x.name).join(", ")}` };
      return { skill: s.name, title: s.title, playbook: s.body };
    },
  },
  {
    name: "save_opportunities",
    description: "Generate and save project-specific marketing opportunities grounded in fetched Discover items (sources validated).",
    permission: "createContent",
    paid: true,
    schema: z.object({ count: z.number().int().min(1).max(10).default(5) }),
    jsonSchema: obj({ count: num("How many (default 5)") }),
    async run(args, ctx) {
      const opps = await generateOpportunities(ctx.userId, ctx.project, args.count, ctx.task.id);
      return opps.map((o) => ({ id: o.id, title: o.title, platform: o.platform, hook: o.hook, confidence: o.confidence, sources: o.sources }));
    },
  },
  {
    name: "fetch_web_page",
    description: "Fetch a public web page and return its readable text (SSRF-protected). Content is untrusted.",
    permission: null,
    untrusted: true,
    schema: z.object({ url: z.string().url() }),
    jsonSchema: obj({ url: str("https URL") }, ["url"]),
    async run(args) {
      const r = await safeFetch(args.url, { timeoutMs: 12000, maxBytes: 2_000_000 });
      const $ = cheerio.load(r.text());
      $("script,style,noscript,svg").remove();
      return { url: r.url, status: r.status, title: $("title").text().trim(), text: $("body").text().replace(/\s+/g, " ").trim().slice(0, 8000) };
    },
  },
  // ───── Website ─────
  {
    name: "run_website_audit",
    description: "Crawl the project website now and produce an evidence-based audit (SEO, accessibility, performance, links, conversion). Takes 30-90s.",
    permission: "readAccountData",
    schema: z.object({}),
    jsonSchema: obj({}),
    async run(_a, ctx) {
      if (!ctx.project.websiteUrl) throw badRequest("Project has no website URL");
      const row = await prisma.websiteAudit.create({ data: { projectId: ctx.project.id, url: ctx.project.websiteUrl, status: "queued" } });
      await runWebsiteAudit({ auditId: row.id });
      const done = await prisma.websiteAudit.findUniqueOrThrow({ where: { id: row.id } });
      const report = done.report as any;
      return { auditId: done.id, scores: done.scores, issues: report?.issues?.map((i: any) => ({ id: i.id, severity: i.severity, category: i.category, title: i.title, evidence: i.evidence?.slice(0, 3) })), ai: done.aiAnalysis };
    },
  },
  {
    name: "get_latest_website_audit",
    description: "Read the most recent completed website audit.",
    permission: null,
    schema: z.object({}),
    jsonSchema: obj({}),
    async run(_a, ctx) {
      const a = await prisma.websiteAudit.findFirst({ where: { projectId: ctx.project.id, status: "completed" }, orderBy: { createdAt: "desc" } });
      if (!a) return { none: true };
      const report = a.report as any;
      return { auditId: a.id, at: a.createdAt, url: a.url, scores: a.scores, issues: report?.issues?.map((i: any) => ({ id: i.id, severity: i.severity, category: i.category, title: i.title, recommendation: i.recommendation, evidence: i.evidence?.slice(0, 3) })), ai: a.aiAnalysis };
    },
  },
  {
    name: "repo_list_files",
    description: "List files in the connected GitHub repository (secret files are hidden).",
    permission: "readAccountData",
    schema: z.object({ prefix: z.string().default("") }),
    jsonSchema: obj({ prefix: str("Path prefix filter, e.g. src/") }),
    async run(args, ctx) {
      const r = await listRepoFiles(ctx.project.id, args.prefix);
      return { ...r, files: r.files.slice(0, 500) };
    },
  },
  {
    name: "repo_read_file",
    description: "Read a text file from the repository's base branch. Secret-looking files are refused.",
    permission: "readAccountData",
    untrusted: true,
    schema: z.object({ path: z.string() }),
    jsonSchema: obj({ path: str("File path") }, ["path"]),
    async run(args, ctx) {
      const f = await readRepoFile(ctx.project.id, args.path);
      return { path: f.path, size: f.size, content: f.content.slice(0, 40000), truncated: f.content.length > 40000 };
    },
  },
  {
    name: "propose_code_change",
    description: "Propose website code changes as full new file contents. Creates a reviewable diff (nothing is pushed yet). Protected: secrets, CI workflows, lockfiles.",
    permission: "editCode",
    schema: z.object({ title: z.string().max(150), description: z.string().max(8000), files: z.array(z.object({ path: z.string(), content: z.string().nullable() })).min(1).max(20) }),
    jsonSchema: obj(
      { title: str("PR title"), description: str("What and why, with evidence"), files: arr(obj({ path: str("Path"), content: { type: ["string", "null"], description: "Full new content, or null to delete" } }, ["path", "content"]), "Changed files") },
      ["title", "description", "files"],
    ),
    async run(args, ctx) {
      const c = await proposeCodeChange(ctx.project, args, ctx.actor);
      return { codeChangeId: c.id, branch: c.branch, diffPreview: c.diff.slice(0, 4000) };
    },
  },
  {
    name: "open_pull_request",
    description: "Push a proposed change to a new branch and open a pull request (never touches the base branch). Checks and preview deployments run on the PR.",
    permission: "editCode",
    schema: z.object({ codeChangeId: z.string() }),
    jsonSchema: obj({ codeChangeId: str("Id from propose_code_change") }, ["codeChangeId"]),
    async run(args, ctx) {
      return submitCodeChange(ctx.project, args.codeChangeId, ctx.actor);
    },
  },
  {
    name: "request_merge",
    description: "Ask to merge an open pull request. Goes to the approval queue unless the policy explicitly allows autonomous merges.",
    permission: "mergeCode",
    schema: z.object({ codeChangeId: z.string() }),
    jsonSchema: obj({ codeChangeId: str("Code change id") }, ["codeChangeId"]),
    async run(args, ctx) {
      return requestMerge(ctx.project, args.codeChangeId, ctx.actor);
    },
  },
  {
    name: "list_deployments",
    description: "List recent Vercel deployments (preview and production) with status.",
    permission: "readAccountData",
    schema: z.object({}),
    jsonSchema: obj({}),
    async run(_a, ctx) {
      return listDeployments(ctx.project.id);
    },
  },
  {
    name: "request_production_deploy",
    description: "Ask to promote a READY deployment to production. Requires approval by default.",
    permission: "deploy",
    schema: z.object({ deploymentId: z.string() }),
    jsonSchema: obj({ deploymentId: str("Vercel deployment id") }, ["deploymentId"]),
    async run(args, ctx) {
      return requestPromotion(ctx.project, args.deploymentId, "promote", ctx.actor);
    },
  },
  // ───── Content ─────
  {
    name: "list_content",
    description: "List posts in the content library.",
    permission: null,
    schema: z.object({ status: z.string().optional(), campaignId: z.string().optional(), limit: z.number().int().min(1).max(100).default(30) }),
    jsonSchema: obj({ status: str("Filter by status"), campaignId: str("Filter by campaign"), limit: num("Max") }),
    async run(args, ctx) {
      const posts = await prisma.post.findMany({
        where: { projectId: ctx.project.id, ...(args.status ? { status: args.status } : {}), ...(args.campaignId ? { campaignId: args.campaignId } : {}) },
        orderBy: { updatedAt: "desc" },
        take: args.limit,
        include: { targets: { select: { platform: true, status: true, remoteUrl: true, scheduledAt: true } } },
      });
      return posts.map((p) => ({ id: p.id, title: p.title, type: p.type, status: p.status, platforms: p.platforms, body: p.body.slice(0, 300), scheduledAt: p.scheduledAt, targets: p.targets, mediaAssetIds: p.mediaAssetIds }));
    },
  },
  {
    name: "get_post",
    description: "Read one post with variants, versions count, quality report and publication targets.",
    permission: null,
    schema: z.object({ postId: z.string() }),
    jsonSchema: obj({ postId: str("Post id") }, ["postId"]),
    async run(args, ctx) {
      const p = await prisma.post.findFirst({ where: { id: args.postId, projectId: ctx.project.id }, include: { targets: true } });
      if (!p) throw notFound("Post");
      return p;
    },
  },
  {
    name: "create_post_draft",
    description: "Create a draft post (multi-platform). Use variants for platform-specific text (e.g. X ≤280 chars or a thread).",
    permission: "createContent",
    schema: postSchema,
    jsonSchema: obj(postProps, ["body", "platforms"]),
    async run(args, ctx) {
      const p = await createPost(ctx.project, postSchema.parse(args), `agent:${ctx.actor.agentType}`);
      return { postId: p.id, status: p.status };
    },
  },
  {
    name: "update_post_draft",
    description: "Edit a draft post. Creates a new version (history is preserved).",
    permission: "createContent",
    schema: postUpdateSchema.extend({ postId: z.string() }),
    jsonSchema: obj({ postId: str("Post id"), ...postProps }, ["postId"]),
    async run(args, ctx) {
      const { postId, ...patch } = args;
      const p = await updatePost(ctx.project, postId, postUpdateSchema.parse(patch), `agent:${ctx.actor.agentType}`);
      return { postId: p.id, version: p.version };
    },
  },
  {
    name: "check_post_quality",
    description: "Run platform limit, media and brand-safety checks on a post (optionally an AI editorial review).",
    permission: null,
    schema: z.object({ postId: z.string(), aiReview: z.boolean().default(false) }),
    jsonSchema: obj({ postId: str("Post id"), aiReview: bool("Also run AI brand review") }, ["postId"]),
    async run(args, ctx) {
      return qualityCheck(ctx.userId, ctx.project, args.postId, { ai: args.aiReview });
    },
  },
  {
    name: "schedule_post",
    description: "Schedule a post for publishing at an ISO time. Publishing requires human approval unless the project policy explicitly allows autonomous publishing.",
    permission: "schedule",
    schema: z.object({ postId: z.string(), scheduledAt: z.string(), platforms: z.array(z.enum(SOCIAL_PLATFORMS)).optional() }),
    jsonSchema: obj({ postId: str("Post id"), scheduledAt: str("ISO 8601 date-time"), platforms: arr(platformEnum, "Subset of platforms") }, ["postId", "scheduledAt"]),
    async run(args, ctx) {
      const at = new Date(args.scheduledAt);
      if (isNaN(at.getTime())) throw badRequest("Invalid scheduledAt");
      return schedulePost(ctx.project, args.postId, { scheduledAt: at, platforms: args.platforms }, ctx.actor);
    },
  },
  {
    name: "get_publish_status",
    description: "Check publication status, URLs and errors for a post.",
    permission: null,
    schema: z.object({ postId: z.string() }),
    jsonSchema: obj({ postId: str("Post id") }, ["postId"]),
    async run(args, ctx) {
      const p = await prisma.post.findFirst({ where: { id: args.postId, projectId: ctx.project.id }, include: { targets: true } });
      if (!p) throw notFound("Post");
      return { status: p.status, targets: p.targets.map((t) => ({ platform: t.platform, status: t.status, url: t.remoteUrl, error: t.lastError, scheduledAt: t.scheduledAt, publishedAt: t.publishedAt })) };
    },
  },
  {
    name: "list_campaigns",
    description: "List campaigns.",
    permission: null,
    schema: z.object({}),
    jsonSchema: obj({}),
    async run(_a, ctx) {
      const cs = await prisma.campaign.findMany({ where: { projectId: ctx.project.id }, orderBy: { createdAt: "desc" }, take: 30, include: { _count: { select: { posts: true, assets: true } } } });
      return cs.map((c) => ({ id: c.id, name: c.name, status: c.status, objective: c.objective, platforms: c.platforms, start: c.startDate, end: c.endDate, posts: c._count.posts, assets: c._count.assets, hasPlan: !!c.plan }));
    },
  },
  {
    name: "create_campaign",
    description: "Create a campaign.",
    permission: "createContent",
    schema: z.object({
      name: z.string(),
      objective: z.string().default(""),
      targetAudience: z.string().default(""),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      platforms: z.array(z.enum(SOCIAL_PLATFORMS)).default([]),
      pillars: z.array(z.string()).default([]),
      guidelines: z.string().default(""),
    }),
    jsonSchema: obj(
      { name: str("Name"), objective: str("Objective"), targetAudience: str("Audience"), startDate: str("ISO date"), endDate: str("ISO date"), platforms: arr(platformEnum, "Platforms"), pillars: arr({ type: "string" }, "Content pillars"), guidelines: str("Guidelines") },
      ["name"],
    ),
    async run(args, ctx) {
      const c = await createCampaign(ctx.project, { ...args, startDate: args.startDate ? new Date(args.startDate) : null, endDate: args.endDate ? new Date(args.endDate) : null }, `agent:${ctx.actor.agentType}`);
      return { campaignId: c.id, slug: c.slug };
    },
  },
  {
    name: "generate_campaign_plan",
    description: "Generate a day-by-day content plan for a campaign (stored on the campaign).",
    permission: "createContent",
    paid: true,
    schema: z.object({ campaignId: z.string(), days: z.number().int().min(1).max(31).default(7), postsPerDay: z.number().min(0.2).max(5).default(1), extra: z.string().optional() }),
    jsonSchema: obj({ campaignId: str("Campaign id"), days: num("Days"), postsPerDay: num("Posts per day"), extra: str("Extra instructions") }, ["campaignId"]),
    async run(args, ctx) {
      const plan = await generateCampaignPlan(ctx.userId, ctx.project, args.campaignId, { ...args, taskId: ctx.task.id });
      return { summary: plan.summary, posts: plan.posts.length, preview: plan.posts.slice(0, 3) };
    },
  },
  {
    name: "materialize_campaign_plan",
    description: "Create draft posts from the campaign plan and optionally generate real images for visual posts.",
    permission: "createContent",
    schema: z.object({ campaignId: z.string(), generateImages: z.boolean().default(false) }),
    jsonSchema: obj({ campaignId: str("Campaign id"), generateImages: bool("Generate images (paid)") }, ["campaignId"]),
    async run(args, ctx) {
      if (args.generateImages) {
        await guard(ctx.project, "editAssets", ctx.actor);
        await guard(ctx.project, "spendMoney", ctx.actor);
      }
      const c = await prisma.campaign.findFirst({ where: { id: args.campaignId, projectId: ctx.project.id } });
      if (!c) throw notFound("Campaign");
      const r = await materializePlan(ctx.userId, ctx.project, c, { generateImages: args.generateImages, createdBy: `agent:${ctx.actor.agentType}`, taskId: ctx.task.id });
      return { postIds: r.posts.map((p) => p.id), errors: r.errors };
    },
  },
  // ───── Media ─────
  {
    name: "list_assets",
    description: "List media assets.",
    permission: null,
    schema: z.object({ folder: z.string().optional(), kind: z.string().optional(), campaignId: z.string().optional(), limit: z.number().int().min(1).max(100).default(40) }),
    jsonSchema: obj({ folder: str("Folder"), kind: str("image|video|document"), campaignId: str("Campaign"), limit: num("Max") }),
    async run(args, ctx) {
      const list = await prisma.asset.findMany({
        where: { projectId: ctx.project.id, ...(args.folder ? { folder: args.folder } : {}), ...(args.kind ? { kind: args.kind } : {}), ...(args.campaignId ? { campaignId: args.campaignId } : {}) },
        orderBy: { updatedAt: "desc" },
        take: args.limit,
      });
      return list.map(assetView);
    },
  },
  {
    name: "generate_image",
    description: "Generate images with the configured image model (ByteDance Seedream by default). Your brief is upgraded by a creative-director pass (brand + creative skills) for clean, professional, converting results. Real files are saved to the media library; returns asset ids.",
    permission: "editAssets",
    paid: true,
    schema: z.object({ prompt: z.string().min(3), size: z.enum(["1024x1024", "1024x1536", "1536x1024"]).default("1024x1024"), n: z.number().int().min(1).max(4).default(1), folder: z.string().default("/"), campaignId: z.string().optional(), name: z.string().optional(), enhance: z.boolean().default(true) }),
    jsonSchema: obj({ prompt: str("Creative brief: subject, purpose, audience, format, exact on-image text in quotes"), enhance: { type: "boolean", description: "Run the creative-director pass (default true). Set false only when the prompt is already final." }, size: { type: "string", enum: ["1024x1024", "1024x1536", "1536x1024"] }, n: num("1-4"), folder: str("Folder path"), campaignId: str("Campaign id"), name: str("Asset name") }, ["prompt"]),
    async run(args, ctx) {
      const assets = await generateImages({ userId: ctx.userId, projectId: ctx.project.id, taskId: ctx.task.id, project: ctx.project, createdBy: `agent:${ctx.actor.agentType}` }, args);
      return assets.map(assetView);
    },
  },
  {
    name: "edit_image",
    description:
      "Edit an image asset and save a new version. ops: crop{left,top,width,height} | resize{width,height,fit} | preset{preset: instagram_square|instagram_portrait|story_9_16|x_landscape|tiktok_9_16} | format{format: jpeg|png|webp} | brand{overlayText,textPosition,color,logoAssetId,border} | ai_edit{instruction} | remove_background{} | variations{n,instruction}.",
    permission: "editAssets",
    schema: z.object({ assetId: z.string(), operation: imageOpSchema }),
    jsonSchema: obj({ assetId: str("Image asset id"), operation: { type: "object", description: "Operation object with an 'op' field and its parameters" } }, ["assetId", "operation"]),
    async run(args, ctx) {
      if (["ai_edit", "remove_background", "variations"].includes(args.operation.op)) await guard(ctx.project, "spendMoney", ctx.actor);
      await ownedAsset(ctx.project.id, args.assetId);
      const r = await applyImageOp({ userId: ctx.userId, projectId: ctx.project.id, taskId: ctx.task.id, project: ctx.project, createdBy: `agent:${ctx.actor.agentType}` }, args.assetId, args.operation);
      return { newVersions: r.versions.map((v) => ({ versionId: v.id, version: v.version, width: v.width, height: v.height })), createdAssets: (r.createdAssets ?? []).map(assetView) };
    },
  },
  // ───── The AI's own workspace (/workspace) ─────
  {
    name: "list_files",
    description: "List text files in your persistent project workspace (default /workspace). Use it to find your notes, plans, drafts and journal from earlier tasks.",
    permission: null,
    schema: z.object({ prefix: z.string().max(300).default("/workspace") }),
    jsonSchema: obj({ prefix: str("Folder, e.g. /workspace or /workspace/drafts") }),
    async run(args, ctx) {
      return listFiles(ctx.project.id, args.prefix);
    },
  },
  {
    name: "read_file",
    description: "Read a text file from the workspace (or any text document asset by path).",
    permission: null,
    schema: z.object({ path: z.string().max(300) }),
    jsonSchema: obj({ path: str("e.g. /workspace/plan.md") }, ["path"]),
    async run(args, ctx) {
      const f = await readFile(ctx.project.id, args.path);
      return { ...f, content: f.content.slice(0, 60000), truncated: f.content.length > 60000 };
    },
  },
  {
    name: "write_file",
    description:
      "Create or update a text file in your workspace (markdown, txt, json, csv, html drafts, scripts, briefs). Every write is saved as a new version the owner can see and restore. Use mode=append for logs/journals.",
    permission: "createContent",
    schema: z.object({ path: z.string().max(300), content: z.string().max(2_000_000), mode: z.enum(["overwrite", "append"]).default("overwrite") }),
    jsonSchema: obj({ path: str("Relative paths go under /workspace, e.g. drafts/launch-thread.md"), content: str("Full file content (or text to append)"), mode: { type: "string", enum: ["overwrite", "append"] } }, ["path", "content"]),
    async run(args, ctx) {
      return writeFile(ctx.project, args.path, args.content, `agent:${ctx.actor.agentType}`, args.mode);
    },
  },
  {
    name: "move_file",
    description: "Rename or move a workspace file.",
    permission: "createContent",
    schema: z.object({ from: z.string().max(300), to: z.string().max(300) }),
    jsonSchema: obj({ from: str("Current path"), to: str("New path") }, ["from", "to"]),
    async run(args, ctx) {
      return moveFile(ctx.project.id, args.from, args.to);
    },
  },
  {
    name: "delete_file",
    description: "Move a workspace file to /trash (recoverable; versions are kept).",
    permission: "createContent",
    schema: z.object({ path: z.string().max(300) }),
    jsonSchema: obj({ path: str("File path") }, ["path"]),
    async run(args, ctx) {
      return trashFile(ctx.project.id, args.path);
    },
  },
  {
    name: "schedule_followup_task",
    description:
      "Schedule another autonomous task for yourself later (e.g. 'check how yesterday's posts performed and adjust'). Limited to 5 pending follow-ups per project; all normal permissions, budgets and approvals still apply.",
    permission: "createContent",
    schema: z.object({ instruction: z.string().min(10).max(4000), runInHours: z.number().min(0.25).max(24 * 14), agentType: z.string().max(40).default("general") }),
    jsonSchema: obj({ instruction: str("What the future task should do (include context; write details to a workspace file and reference it)"), runInHours: num("Delay in hours (0.25 to 336)"), agentType: str("Agent role, default general") }, ["instruction", "runInHours"]),
    async run(args, ctx) {
      const pending = await prisma.task.count({ where: { projectId: ctx.project.id, status: "queued", createdBy: { startsWith: "agent:" } } });
      if (pending >= 5) throw badRequest("There are already 5 pending follow-up tasks for this project.");
      const { createTask } = await import("./runner");
      const t = await createTask(
        ctx.project,
        { instruction: args.instruction, agentType: args.agentType as any, autonomous: true, context: { scheduledBy: ctx.task.id } },
        `agent:${ctx.actor.agentType}`,
        { runAt: new Date(Date.now() + args.runInHours * 3600_000) },
      );
      return { taskId: t.id, runsAt: new Date(Date.now() + args.runInHours * 3600_000).toISOString() };
    },
  },
  {
    name: "analyze_media",
    description: "Look at an image or video asset with the vision model and answer a question about it (videos are sampled into frames). Use before editing, captioning or judging media.",
    permission: null,
    paid: true,
    schema: z.object({ assetId: z.string(), question: z.string().max(2000).optional(), frames: z.number().int().min(2).max(10).default(6) }),
    jsonSchema: obj({ assetId: str("Image or video asset id"), question: str("What to look for (optional)"), frames: num("Frames to sample from videos (2-10)") }, ["assetId"]),
    async run(args, ctx) {
      return analyzeMedia({ userId: ctx.userId, projectId: ctx.project.id, taskId: ctx.task.id, project: ctx.project }, args.assetId, args.question, args.frames);
    },
  },
  {
    name: "create_storyboard",
    description: "Save a video storyboard (scenes with visuals, captions, durations) as a document asset in the media library.",
    permission: "createContent",
    schema: z.object({ title: z.string(), campaignId: z.string().optional(), aspect: z.enum(["9:16", "16:9", "1:1"]).default("9:16"), scenes: z.array(z.object({ description: z.string(), visualPrompt: z.string(), caption: z.string().default(""), voiceover: z.string().default(""), durationSec: z.number().min(1).max(20).default(3) })).min(1).max(20) }),
    jsonSchema: obj(
      { title: str("Title"), campaignId: str("Campaign"), aspect: { type: "string", enum: ["9:16", "16:9", "1:1"] }, scenes: arr(obj({ description: str("What happens"), visualPrompt: str("Visual prompt"), caption: str("On-screen text"), voiceover: str("Voiceover"), durationSec: num("Seconds") }, ["description", "visualPrompt"]), "Scenes") },
      ["title", "scenes"],
    ),
    async run(args, ctx) {
      const md = `# ${args.title}\n\nAspect ${args.aspect} · ${args.scenes.reduce((s: number, x: any) => s + x.durationSec, 0)}s\n\n${args.scenes
        .map((s: any, i: number) => `## Scene ${i + 1} (${s.durationSec}s)\n${s.description}\n\n**Visual:** ${s.visualPrompt}\n\n**Caption:** ${s.caption}\n\n**Voiceover:** ${s.voiceover}`)
        .join("\n\n")}`;
      const r = await createAsset(ctx.project.id, { name: `Storyboard — ${args.title}`, kind: "document", folder: "/storyboards", campaignId: args.campaignId, source: "agent", createdBy: `agent:${ctx.actor.agentType}` }, Buffer.from(md, "utf8"), "text/markdown", {
        operation: "storyboard",
        params: { scenes: args.scenes, aspect: args.aspect },
        createdBy: `agent:${ctx.actor.agentType}`,
      });
      return { assetId: r.asset.id };
    },
  },
  {
    name: "generate_video",
    description: "Generate a short video clip with the configured video model (optionally from a first-frame image asset). Saves a real MP4 asset. Can take several minutes.",
    permission: "editAssets",
    paid: true,
    schema: z.object({ prompt: z.string().min(3), aspect: z.enum(["9:16", "16:9", "1:1"]).default("9:16"), durationSec: z.number().int().min(2).max(10).default(5), imageAssetId: z.string().optional(), folder: z.string().default("/videos"), campaignId: z.string().optional(), enhance: z.boolean().default(true) }),
    jsonSchema: obj({ prompt: str("Shot brief: subject + action, camera, setting, mood"), enhance: { type: "boolean", description: "Run the creative-director pass (default true)" }, aspect: { type: "string", enum: ["9:16", "16:9", "1:1"] }, durationSec: num("Seconds"), imageAssetId: str("First-frame image asset"), folder: str("Folder"), campaignId: str("Campaign") }, ["prompt"]),
    async run(args, ctx) {
      if (args.imageAssetId) await ownedAsset(ctx.project.id, args.imageAssetId);
      const a = await generateVideo({ userId: ctx.userId, projectId: ctx.project.id, taskId: ctx.task.id, project: ctx.project, createdBy: `agent:${ctx.actor.agentType}` }, args);
      return assetView(a);
    },
  },
  {
    name: "edit_video",
    description: "Process a video with FFmpeg and save the result. ops: trim{start,end} | aspect{aspect: 9:16|1:1|16:9|4:5, mode: crop|pad} | subtitles{srt? , autoTranscribe?} | concat{assetIds} | thumbnail{at} | compress{crf}.",
    permission: "editAssets",
    schema: z.object({ assetId: z.string(), operation: videoOpSchema }),
    jsonSchema: obj({ assetId: str("Video asset id"), operation: { type: "object", description: "Operation object with an 'op' field" } }, ["assetId", "operation"]),
    async run(args, ctx) {
      await ownedAsset(ctx.project.id, args.assetId);
      if (args.operation.op === "subtitles" && args.operation.autoTranscribe) await guard(ctx.project, "spendMoney", ctx.actor);
      const r = await applyVideoOp({ userId: ctx.userId, projectId: ctx.project.id, taskId: ctx.task.id, project: ctx.project, createdBy: `agent:${ctx.actor.agentType}` }, args.assetId, args.operation);
      return { newVersions: r.versions.map((v) => ({ versionId: v.id, version: v.version, durationSec: v.durationSec })), createdAssets: (r.createdAssets ?? []).map(assetView) };
    },
  },
  {
    name: "restore_asset_version",
    description: "Restore a previous version of an asset (saved as a new version).",
    permission: "editAssets",
    schema: z.object({ assetId: z.string(), versionId: z.string() }),
    jsonSchema: obj({ assetId: str("Asset"), versionId: str("Version to restore") }, ["assetId", "versionId"]),
    async run(args, ctx) {
      await ownedAsset(ctx.project.id, args.assetId);
      const v = await restoreVersion(args.assetId, args.versionId, `agent:${ctx.actor.agentType}`);
      return { versionId: v.id, version: v.version };
    },
  },
  {
    name: "organize_asset",
    description: "Rename, move to a folder, tag, or attach an asset to a campaign.",
    permission: "editAssets",
    schema: z.object({ assetId: z.string(), name: z.string().optional(), folder: z.string().optional(), campaignId: z.string().nullable().optional(), tags: z.array(z.string()).optional() }),
    jsonSchema: obj({ assetId: str("Asset"), name: str("Name"), folder: str("Folder"), campaignId: { type: ["string", "null"] }, tags: arr({ type: "string" }, "Tags") }, ["assetId"]),
    async run(args, ctx) {
      await ownedAsset(ctx.project.id, args.assetId);
      if (args.campaignId) {
        const c = await prisma.campaign.findFirst({ where: { id: args.campaignId, projectId: ctx.project.id } });
        if (!c) throw notFound("Campaign");
      }
      const a = await prisma.asset.update({
        where: { id: args.assetId },
        data: { ...(args.name && { name: args.name }), ...(args.folder && { folder: normalizeFolder(args.folder) }), ...(args.campaignId !== undefined && { campaignId: args.campaignId }), ...(args.tags && { tags: args.tags }) },
      });
      return assetView(a);
    },
  },
  // ───── Inbox ─────
  {
    name: "list_inbox",
    description: "List comments/mentions in the social inbox with classification and drafts.",
    permission: "readAccountData",
    untrusted: true,
    schema: z.object({ status: z.string().optional(), limit: z.number().int().min(1).max(100).default(30) }),
    jsonSchema: obj({ status: str("new|drafted|replied|escalated|pending_approval"), limit: num("Max") }),
    async run(args, ctx) {
      const items = await prisma.inboxItem.findMany({ where: { projectId: ctx.project.id, ...(args.status ? { status: args.status } : {}) }, orderBy: { receivedAt: "desc" }, take: args.limit });
      return items.map((i) => ({ id: i.id, platform: i.platform, author: i.authorHandle, text: i.text.slice(0, 500), classification: i.classification, status: i.status, draftReply: i.draftReply, receivedAt: i.receivedAt }));
    },
  },
  {
    name: "summarize_feedback",
    description: "Summarize recurring customer feedback, FAQs and content ideas from the inbox.",
    permission: "readAccountData",
    paid: true,
    schema: z.object({}),
    jsonSchema: obj({}),
    async run(_a, ctx) {
      return feedbackSummary(ctx.userId, ctx.project);
    },
  },
  {
    name: "draft_inbox_reply",
    description: "Save a draft reply to an inbox item (AI-written if text is omitted). Does not send.",
    permission: "createContent",
    schema: z.object({ itemId: z.string(), text: z.string().max(2000).optional() }),
    jsonSchema: obj({ itemId: str("Inbox item"), text: str("Reply text (optional)") }, ["itemId"]),
    async run(args, ctx) {
      if (args.text) {
        const r = await prisma.inboxItem.updateMany({ where: { id: args.itemId, projectId: ctx.project.id }, data: { draftReply: args.text, status: "drafted" } });
        if (!r.count) throw notFound("Inbox item");
        return { draft: args.text };
      }
      return { draft: await draftReply(ctx.userId, ctx.project, args.itemId) };
    },
  },
  {
    name: "send_inbox_reply",
    description: "Send a reply to a comment/mention. Requires approval unless the policy allows autonomous replies.",
    permission: "reply",
    schema: z.object({ itemId: z.string(), text: z.string().min(1).max(2000) }),
    jsonSchema: obj({ itemId: str("Inbox item"), text: str("Reply") }, ["itemId", "text"]),
    async run(args, ctx) {
      return sendReply(ctx.project, args.itemId, args.text, ctx.actor);
    },
  },
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

export function toolDefs(): ToolDef[] {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.jsonSchema }));
}

/** Executes a tool with schema validation and server-side permission checks. Output is redacted. */
export async function executeTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<{ ok: boolean; output: unknown; untrusted: boolean }> {
  const tool = TOOL_MAP.get(name);
  if (!tool) return { ok: false, output: { error: `Unknown tool ${name}` }, untrusted: false };
  const parsed = tool.schema.safeParse(rawArgs ?? {});
  if (!parsed.success) return { ok: false, output: { error: "Invalid arguments", issues: parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`) }, untrusted: false };
  // Re-read the project so permission changes (and emergency stop) apply immediately mid-task.
  const fresh = await prisma.project.findUniqueOrThrow({ where: { id: ctx.project.id } });
  ctx.project = fresh;
  if (tool.permission) await guard(fresh, tool.permission, ctx.actor);
  if (tool.paid) await guard(fresh, "spendMoney", ctx.actor);
  const output = await tool.run(parsed.data, ctx);
  return { ok: true, output: redact(output), untrusted: !!tool.untrusted };
}
