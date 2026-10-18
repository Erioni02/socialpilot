import { prisma, Prisma, type Approval, type Project } from "@socialpilot/db";
import { badRequest, conflict, notFound, redactString } from "@socialpilot/core";
import { audit, notify } from "../infra/audit";
import { emit } from "../infra/events";
import { enqueue } from "../infra/queue";

export async function requestApproval(
  project: Project,
  input: { type: string; title: string; summary?: string; payload: Record<string, unknown>; requestedBy: string; taskId?: string },
): Promise<Approval> {
  const approval = await prisma.approval.create({
    data: {
      projectId: project.id,
      taskId: input.taskId ?? null,
      type: input.type,
      title: input.title.slice(0, 300),
      summary: (input.summary ?? "").slice(0, 4000),
      payload: input.payload as Prisma.InputJsonValue,
      requestedBy: input.requestedBy,
    },
  });
  await notify({ userId: project.ownerId, projectId: project.id, type: "approval.requested", title: `Approval needed: ${approval.title}`, body: approval.summary, link: `/projects/${project.id}/approvals` });
  await emit({ type: "approval.updated", projectId: project.id, data: { id: approval.id, status: "pending" } });
  return approval;
}

/** Human decision. Approved actions are executed by a worker job so they get retries and an audit trail. */
export async function decideApproval(userId: string, project: Project, approvalId: string, decision: "approve" | "reject", note?: string) {
  const a = await prisma.approval.findFirst({ where: { id: approvalId, projectId: project.id } });
  if (!a) throw notFound("Approval");
  if (a.status !== "pending") throw conflict(`Approval is already ${a.status}`);
  const updated = await prisma.approval.update({
    where: { id: a.id },
    data: { status: decision === "approve" ? "approved" : "rejected", decidedBy: userId, decidedAt: new Date(), result: note ? { note } : undefined },
  });
  await audit({ userId, projectId: project.id, actor: "user", action: `approval.${decision}d`, target: a.id, details: { type: a.type, title: a.title, note } });
  if (decision === "approve") {
    await enqueue("approval.execute", { approvalId: a.id }, { projectId: project.id, dedupeKey: `approval:${a.id}`, maxAttempts: 3 });
  } else {
    await onRejected(a);
  }
  await emit({ type: "approval.updated", projectId: project.id, data: { id: a.id, status: updated.status } });
  return updated;
}

async function onRejected(a: Approval) {
  const p = a.payload as Record<string, any>;
  if (a.type === "publish" && p.postId) {
    await prisma.postTarget.updateMany({ where: { postId: p.postId, status: "pending" }, data: { status: "cancelled" } });
    await prisma.post.update({ where: { id: p.postId }, data: { status: "draft", scheduledAt: null } }).catch(() => {});
  }
  if (a.type === "reply" && p.inboxItemId) {
    await prisma.inboxItem.update({ where: { id: p.inboxItemId }, data: { status: "drafted" } }).catch(() => {});
  }
}

/** Job: run the action behind an approved request. Handlers live with their domains. */
export async function executeApprovalJob(payload: { approvalId: string }) {
  const a = await prisma.approval.findUniqueOrThrow({ where: { id: payload.approvalId } });
  if (a.status !== "approved") return { skipped: a.status };
  const p = a.payload as Record<string, any>;
  try {
    let result: unknown;
    switch (a.type) {
      case "publish": {
        const { releaseApprovedPost } = await import("../content/publishing");
        await releaseApprovedPost(p.postId, p.version);
        result = { released: true };
        break;
      }
      case "reply": {
        const { executeReply } = await import("../inbox/service");
        result = await executeReply(p.inboxItemId, p.text, a.requestedBy);
        break;
      }
      case "merge": {
        const { mergeCodeChange } = await import("../website/code");
        result = await mergeCodeChange(p.codeChangeId);
        break;
      }
      case "deploy": {
        const { promoteDeployment } = await import("../website/code");
        result = await promoteDeployment(a.projectId, p.deploymentId, p.mode ?? "promote");
        break;
      }
      case "code_change": {
        const { pushCodeChange } = await import("../website/code");
        result = await pushCodeChange(p.codeChangeId);
        break;
      }
      default:
        throw badRequest(`Unknown approval type ${a.type}`);
    }
    await prisma.approval.update({ where: { id: a.id }, data: { status: "executed", result: { ...(a.result as object | null), output: result } as Prisma.InputJsonValue } });
    await emit({ type: "approval.updated", projectId: a.projectId, data: { id: a.id, status: "executed" } });
    return result;
  } catch (err) {
    const msg = redactString((err as Error).message);
    await prisma.approval.update({ where: { id: a.id }, data: { status: "failed", result: { ...(a.result as object | null), error: msg } as Prisma.InputJsonValue } });
    await emit({ type: "approval.updated", projectId: a.projectId, data: { id: a.id, status: "failed" } });
    const project = await prisma.project.findUniqueOrThrow({ where: { id: a.projectId } });
    await notify({ userId: project.ownerId, projectId: project.id, type: "approval.failed", title: `Approved action failed: ${a.title}`, body: msg.slice(0, 300), link: `/projects/${project.id}/approvals` });
    throw err;
  }
}
