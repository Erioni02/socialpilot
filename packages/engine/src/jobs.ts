import type { JobHandler } from "./infra/queue";
import { runBrandAnalysis } from "./projects/service";
import { runWebsiteAudit } from "./website/audit";
import { publishTargetJob, checkPublishStatusJob } from "./content/publishing";
import { syncIntegration } from "./analytics/service";
import { syncInbox } from "./inbox/service";
import { refreshDiscover, generateOpportunities, getBriefing } from "./discover/service";
import { runAgentTask } from "./agents/runner";
import { runAutomation } from "./automation/service";
import { executeApprovalJob } from "./approvals/service";
import { applyImageOp, applyVideoOp, generateImages, generateVideo } from "./media/service";
import { generateCampaignPlan, materializePlan } from "./content/campaigns";
import { prisma } from "@socialpilot/db";
import { emit } from "./infra/events";
import { runTrafficReportJob, refreshWatchedIntel } from "./intel/service";

async function opCtx(projectId: string, createdBy = "user") {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  return { userId: project.ownerId, projectId, project, createdBy };
}

async function markAssetFailed(assetId: string | undefined, err: unknown) {
  if (!assetId) return;
  const a = await prisma.asset.update({ where: { id: assetId }, data: { status: "failed", error: (err as Error).message.slice(0, 500) } }).catch(() => null);
  if (a) await emit({ type: "asset.updated", projectId: a.projectId, data: { id: a.id } });
}

/** Ops that create new assets (variations, concat, thumbnail) leave the source untouched — release its lock. */
async function releaseAsset(projectId: string, assetId: string) {
  const r = await prisma.asset.updateMany({ where: { id: assetId, status: "processing" }, data: { status: "ready" } });
  if (r.count) await emit({ type: "asset.updated", projectId, data: { id: assetId } });
}

/** Every background job the worker can run. */
export const JOB_HANDLERS: Record<string, JobHandler> = {
  "brand.analyze": (p) => runBrandAnalysis(p),
  "audit.website": (p) => runWebsiteAudit(p),
  "publish.target": (p, ctx) => publishTargetJob(p, ctx),
  "publish.checkStatus": (p) => checkPublishStatusJob(p),
  "sync.integration": (p) => syncIntegration(p.integrationId),
  "inbox.sync": (p) => syncInbox(p.integrationId),
  "discover.refresh": () => refreshDiscover(),
  "discover.opportunities": async (p) => {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: p.projectId } });
    return (await generateOpportunities(project.ownerId, project, p.count ?? 5)).length;
  },
  "discover.briefing": async (p) => {
    const project = p.projectId ? await prisma.project.findUniqueOrThrow({ where: { id: p.projectId } }) : null;
    const b = await getBriefing(p.userId, project, { regenerate: true });
    return { id: (b as any).id };
  },
  "agent.run": (p) => runAgentTask(p),
  "traffic.report": (p) => runTrafficReportJob(p),
  "intel.refresh": () => refreshWatchedIntel(),
  "automation.run": (p) => runAutomation(p),
  "approval.execute": (p) => executeApprovalJob(p),
  "media.generateImage": async (p) => {
    try {
      const assets = await generateImages(await opCtx(p.projectId, p.createdBy), p.input);
      if (p.placeholderId) await prisma.asset.delete({ where: { id: p.placeholderId } }).catch(() => {});
      return { assetIds: assets.map((a) => a.id) };
    } catch (e) {
      await markAssetFailed(p.placeholderId, e);
      throw e;
    }
  },
  "media.generateVideo": async (p) => {
    try {
      const a = await generateVideo(await opCtx(p.projectId, p.createdBy), { ...p.input, assetId: p.placeholderId });
      return { assetId: a.id };
    } catch (e) {
      await markAssetFailed(p.placeholderId, e);
      throw e;
    }
  },
  "media.imageOp": async (p) => {
    try {
      const r = await applyImageOp(await opCtx(p.projectId, p.createdBy), p.assetId, p.op);
      await releaseAsset(p.projectId, p.assetId);
      return { versions: r.versions.map((v) => v.id), created: (r.createdAssets ?? []).map((a) => a.id) };
    } catch (e) {
      await prisma.asset.update({ where: { id: p.assetId }, data: { status: "ready", error: (e as Error).message.slice(0, 500) } }).catch(() => {});
      await emit({ type: "asset.updated", projectId: p.projectId, data: { id: p.assetId } });
      throw e;
    }
  },
  "media.videoOp": async (p) => {
    try {
      const r = await applyVideoOp(await opCtx(p.projectId, p.createdBy), p.assetId, p.op);
      await releaseAsset(p.projectId, p.assetId);
      return { versions: r.versions.map((v) => v.id), created: (r.createdAssets ?? []).map((a) => a.id) };
    } catch (e) {
      await prisma.asset.update({ where: { id: p.assetId }, data: { status: "ready", error: (e as Error).message.slice(0, 500) } }).catch(() => {});
      await emit({ type: "asset.updated", projectId: p.projectId, data: { id: p.assetId } });
      throw e;
    }
  },
  "campaign.plan": async (p) => {
    const ctx = await opCtx(p.projectId);
    const plan = await generateCampaignPlan(ctx.userId, ctx.project, p.campaignId, p.options ?? {});
    if (p.materialize) {
      const c = await prisma.campaign.findUniqueOrThrow({ where: { id: p.campaignId } });
      const r = await materializePlan(ctx.userId, ctx.project, c, { generateImages: !!p.generateImages });
      return { posts: r.posts.length, errors: r.errors };
    }
    return { posts: plan.posts.length };
  },
  "campaign.materialize": async (p) => {
    const ctx = await opCtx(p.projectId);
    const c = await prisma.campaign.findUniqueOrThrow({ where: { id: p.campaignId } });
    const r = await materializePlan(ctx.userId, ctx.project, c, { generateImages: !!p.generateImages });
    return { posts: r.posts.length, errors: r.errors };
  },
};
