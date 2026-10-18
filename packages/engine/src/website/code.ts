import { createTwoFilesPatch } from "diff";
import { prisma, Prisma, type Integration, type Project } from "@socialpilot/db";
import { AppError, badRequest, isSecretPath, notFound, SetupRequiredError, slugifyLite } from "./util";
import { GitHubClient, VercelClient } from "@socialpilot/integrations";
import { getCredentials } from "../integrations/service";
import { audit } from "../infra/audit";
import { emit } from "../infra/events";
import { guard, actorLabel, assertNotStopped, type Actor } from "../projects/context";
import { requestApproval } from "../approvals/service";

const BLOCKED_WRITE = [/^\.github\/workflows\//i, /(^|\/)\.env/i, /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i];

export async function repoIntegration(projectId: string): Promise<{ integration: Integration; client: GitHubClient; repo: string; baseBranch: string }> {
  const integration = await prisma.integration.findFirst({ where: { projectId, provider: "github", status: { in: ["connected", "error"] } } });
  if (!integration) throw new SetupRequiredError("Connect a GitHub repository on the Integrations page first.", { kind: "integration", provider: "github" });
  const cfg = integration.config as Record<string, any>;
  if (!cfg.repo) throw new SetupRequiredError("Choose which repository belongs to this project (Integrations → GitHub → Repository).", { kind: "integration_config", provider: "github" });
  const creds = await getCredentials(integration);
  return { integration, client: new GitHubClient(creds.accessToken!), repo: cfg.repo, baseBranch: cfg.baseBranch || "main" };
}

export async function listRepoFiles(projectId: string, prefix = "") {
  const { client, repo, baseBranch } = await repoIntegration(projectId);
  const { files, truncated } = await client.tree(repo, baseBranch);
  return {
    repo,
    branch: baseBranch,
    truncated,
    files: files
      .filter((f) => f.type === "blob" && !isSecretPath(f.path) && !f.path.includes("node_modules/") && f.path.startsWith(prefix))
      .map((f) => ({ path: f.path, size: f.size ?? 0 }))
      .slice(0, 3000),
  };
}

export async function readRepoFile(projectId: string, path: string) {
  if (isSecretPath(path)) throw new AppError(403, "This file looks like it contains secrets and cannot be read.", "secret_path");
  const { client, repo, baseBranch } = await repoIntegration(projectId);
  const f = await client.readFile(repo, path, baseBranch);
  if (!f) throw notFound(`File ${path}`);
  return { path, content: f.content, size: f.size };
}

function validateWritePath(path: string) {
  const clean = path.replace(/^\/+/, "");
  if (!clean || clean.includes("..") || clean.includes("\\")) throw badRequest(`Invalid path ${path}`);
  if (isSecretPath(clean) || BLOCKED_WRITE.some((r) => r.test(clean))) throw new AppError(403, `Changes to ${clean} are not allowed (secrets, CI workflows and lockfiles are protected).`, "protected_path");
  return clean;
}

/** Creates a reviewable change set with a unified diff. Nothing is written to GitHub yet. */
export async function proposeCodeChange(
  project: Project,
  input: { title: string; description: string; files: { path: string; content: string | null }[] },
  actor: Actor,
) {
  if (actor.kind !== "user") await guard(project, "editCode", actor);
  if (!input.files.length) throw badRequest("No file changes");
  if (input.files.length > 30) throw badRequest("Too many files in one change (max 30)");
  const { integration, client, repo, baseBranch } = await repoIntegration(project.id);
  const baseSha = await client.branchSha(repo, baseBranch);
  const files = [];
  let diff = "";
  for (const f of input.files) {
    const path = validateWritePath(f.path);
    const before = await client.readFile(repo, path, baseSha);
    const action = f.content === null ? "delete" : before ? "modify" : "create";
    if (action === "delete" && !before) throw badRequest(`${path} does not exist`);
    files.push({ path, action, before: before?.content ?? null, after: f.content });
    diff += createTwoFilesPatch(before ? `a/${path}` : "/dev/null", f.content === null ? "/dev/null" : `b/${path}`, before?.content ?? "", f.content ?? "", "", "", { context: 3 });
  }
  const change = await prisma.codeChange.create({
    data: {
      projectId: project.id,
      integrationId: integration.id,
      taskId: actor.kind === "agent" ? actor.taskId : null,
      title: input.title.slice(0, 200),
      description: input.description.slice(0, 10000),
      repo,
      baseBranch,
      baseSha,
      branch: `socialpilot/${slugifyLite(input.title)}-${Date.now().toString(36)}`,
      files: files as unknown as Prisma.InputJsonValue,
      diff,
      createdBy: actorLabel(actor),
    },
  });
  await audit({ userId: project.ownerId, projectId: project.id, actor: actorLabel(actor), action: "code.change_proposed", target: change.id, details: { repo, files: files.map((f) => `${f.action} ${f.path}`) } });
  await emit({ type: "code.updated", projectId: project.id, data: { id: change.id } });
  return change;
}

/** Pushes the change to a NEW branch and opens a pull request. Never touches the base branch. */
export async function pushCodeChange(codeChangeId: string) {
  const change = await prisma.codeChange.findUniqueOrThrow({ where: { id: codeChangeId } });
  if (change.status !== "draft" && change.status !== "failed") return { prUrl: change.prUrl };
  const project = await prisma.project.findUniqueOrThrow({ where: { id: change.projectId } });
  await assertNotStopped(project);
  const { client } = await repoIntegration(change.projectId);
  try {
    const files = change.files as { path: string; after: string | null }[];
    try {
      await client.createBranch(change.repo, change.branch, change.baseSha!);
    } catch (e) {
      if (!String((e as Error).message).includes("Reference already exists")) throw e;
    }
    const headSha = await client.commitFiles(change.repo, change.branch, change.baseSha!, files.map((f) => ({ path: f.path, content: f.after })), `${change.title}\n\n${change.description}\n\nProposed via SocialPilot (${change.createdBy}).`);
    const pr = await client.createPullRequest(change.repo, {
      title: change.title,
      head: change.branch,
      base: change.baseBranch,
      body: `${change.description}\n\n---\nCreated by SocialPilot on behalf of the project owner (${change.createdBy}). Review the diff and checks before merging. Rollback: revert this PR's merge commit.`,
    });
    const updated = await prisma.codeChange.update({ where: { id: change.id }, data: { status: "pr_open", headSha, prNumber: pr.number, prUrl: pr.html_url, error: null } });
    await audit({ userId: project.ownerId, projectId: project.id, actor: change.createdBy, action: "code.pr_opened", target: change.id, details: { pr: pr.html_url } });
    await emit({ type: "code.updated", projectId: project.id, data: { id: change.id } });
    return { prUrl: updated.prUrl, prNumber: updated.prNumber };
  } catch (err) {
    await prisma.codeChange.update({ where: { id: change.id }, data: { status: "failed", error: (err as Error).message.slice(0, 1000) } });
    await emit({ type: "code.updated", projectId: project.id, data: { id: change.id } });
    throw err;
  }
}

export async function submitCodeChange(project: Project, codeChangeId: string, actor: Actor) {
  const change = await prisma.codeChange.findFirst({ where: { id: codeChangeId, projectId: project.id } });
  if (!change) throw notFound("Code change");
  if (actor.kind !== "user") await guard(project, "editCode", actor);
  return pushCodeChange(change.id);
}

export async function refreshChecks(project: Project, codeChangeId: string) {
  const change = await prisma.codeChange.findFirst({ where: { id: codeChangeId, projectId: project.id } });
  if (!change) throw notFound("Code change");
  if (!change.prNumber) return change;
  const { client } = await repoIntegration(project.id);
  const pr = await client.getPullRequest(change.repo, change.prNumber);
  const checks = await client.checks(change.repo, pr.head.sha);
  let previewUrl = change.previewUrl ?? (await client.previewUrl(change.repo, pr.head.sha).catch(() => null));
  if (!previewUrl) {
    const vercel = await prisma.integration.findFirst({ where: { projectId: project.id, provider: "vercel", status: "connected" } });
    if (vercel) {
      const creds = await getCredentials(vercel);
      const cfg = vercel.config as any;
      const deps = await new VercelClient(creds.token!, cfg.teamId ?? undefined).listDeployments(cfg.projectId, 20).catch(() => []);
      previewUrl = deps.find((d: any) => d.branch === change.branch && d.state === "READY")?.url ?? null;
    }
  }
  const status = pr.merged ? "merged" : pr.state === "closed" ? "closed" : change.status;
  const updated = await prisma.codeChange.update({ where: { id: change.id }, data: { checks: checks as unknown as Prisma.InputJsonValue, previewUrl, headSha: pr.head.sha, status } });
  await emit({ type: "code.updated", projectId: project.id, data: { id: change.id } });
  return updated;
}

export async function requestMerge(project: Project, codeChangeId: string, actor: Actor) {
  const change = await prisma.codeChange.findFirst({ where: { id: codeChangeId, projectId: project.id } });
  if (!change) throw notFound("Code change");
  if (change.status !== "pr_open") throw badRequest("Only open pull requests can be merged");
  const gate = await guard(project, "mergeCode", actor, { outbound: true });
  if (gate.requiresApproval) {
    const a = await requestApproval(project, {
      type: "merge",
      title: `Merge PR #${change.prNumber}: ${change.title}`,
      summary: `${change.repo} ${change.branch} → ${change.baseBranch}. ${change.prUrl}`,
      payload: { codeChangeId: change.id },
      requestedBy: actorLabel(actor),
      taskId: actor.kind === "agent" ? actor.taskId : undefined,
    });
    return { pendingApproval: a.id };
  }
  return mergeCodeChange(change.id, actor.kind === "user" ? "user" : actorLabel(actor));
}

export async function mergeCodeChange(codeChangeId: string, by = "approval") {
  const change = await prisma.codeChange.findUniqueOrThrow({ where: { id: codeChangeId } });
  const project = await prisma.project.findUniqueOrThrow({ where: { id: change.projectId } });
  await assertNotStopped(project);
  const { client } = await repoIntegration(change.projectId);
  const pr = await client.getPullRequest(change.repo, change.prNumber!);
  if (pr.merged) {
    await prisma.codeChange.update({ where: { id: change.id }, data: { status: "merged" } });
    return { alreadyMerged: true };
  }
  const checks = await client.checks(change.repo, pr.head.sha);
  if (checks.summary === "failure") throw badRequest("Checks are failing on this pull request. Fix them before merging.");
  if (checks.summary === "pending") throw badRequest("Checks are still running. Try again when they finish.");
  const r = await client.mergePullRequest(change.repo, change.prNumber!, pr.head.sha);
  await prisma.codeChange.update({ where: { id: change.id }, data: { status: "merged", checks: checks as unknown as Prisma.InputJsonValue } });
  await audit({ userId: project.ownerId, projectId: project.id, actor: by, action: "code.merged", target: change.id, details: { pr: change.prUrl, sha: r.sha } });
  await emit({ type: "code.updated", projectId: project.id, data: { id: change.id } });
  return { merged: true, sha: r.sha, rollback: `Revert commit ${r.sha} (GitHub → PR #${change.prNumber} → Revert) to roll back.` };
}

export async function closeCodeChange(project: Project, codeChangeId: string, userId: string) {
  const change = await prisma.codeChange.findFirst({ where: { id: codeChangeId, projectId: project.id } });
  if (!change) throw notFound("Code change");
  if (change.prNumber && change.status === "pr_open") {
    const { client } = await repoIntegration(project.id);
    await client.closePullRequest(change.repo, change.prNumber);
  }
  await prisma.codeChange.update({ where: { id: change.id }, data: { status: change.prNumber ? "closed" : "rejected" } });
  await audit({ userId, projectId: project.id, actor: "user", action: "code.closed", target: change.id });
  await emit({ type: "code.updated", projectId: project.id, data: { id: change.id } });
}

// ───────────── Deployments (Vercel) ─────────────

async function vercelFor(projectId: string) {
  const integration = await prisma.integration.findFirst({ where: { projectId, provider: "vercel", status: { in: ["connected", "error"] } } });
  if (!integration) throw new SetupRequiredError("Connect Vercel on the Integrations page to manage deployments.", { kind: "integration", provider: "vercel" });
  const creds = await getCredentials(integration);
  const cfg = integration.config as any;
  return { integration, client: new VercelClient(creds.token!, cfg.teamId ?? undefined), vercelProjectId: cfg.projectId as string };
}

export async function listDeployments(projectId: string) {
  const { client, vercelProjectId } = await vercelFor(projectId);
  return client.listDeployments(vercelProjectId, 25);
}

export async function deploymentLogs(projectId: string, deploymentId: string) {
  const { client } = await vercelFor(projectId);
  return client.buildLogs(deploymentId);
}

export async function requestPromotion(project: Project, deploymentId: string, mode: "promote" | "rollback", actor: Actor) {
  const gate = await guard(project, "deploy", actor, { outbound: true });
  const { client } = await vercelFor(project.id);
  const dep = await client.getDeployment(deploymentId);
  if ((dep.readyState ?? dep.state) !== "READY") throw badRequest("Only READY deployments can be promoted");
  if (gate.requiresApproval) {
    const a = await requestApproval(project, {
      type: "deploy",
      title: `${mode === "rollback" ? "Roll back production to" : "Promote to production"}: ${dep.url}`,
      summary: `Branch ${dep.meta?.githubCommitRef ?? "?"} · commit ${String(dep.meta?.githubCommitSha ?? "").slice(0, 7)} · ${dep.meta?.githubCommitMessage ?? ""}`,
      payload: { deploymentId, mode },
      requestedBy: actorLabel(actor),
      taskId: actor.kind === "agent" ? actor.taskId : undefined,
    });
    return { pendingApproval: a.id };
  }
  return promoteDeployment(project.id, deploymentId, mode, actor.kind === "user" ? "user" : actorLabel(actor));
}

export async function promoteDeployment(projectId: string, deploymentId: string, mode: "promote" | "rollback" = "promote", by = "approval") {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  await assertNotStopped(project);
  const { client, vercelProjectId } = await vercelFor(projectId);
  const previous = (await client.listDeployments(vercelProjectId, 20)).find((d: any) => d.target === "production" && d.state === "READY");
  if (mode === "rollback") await client.rollback(vercelProjectId, deploymentId);
  else await client.promote(vercelProjectId, deploymentId);
  await audit({ userId: project.ownerId, projectId, actor: by, action: `deploy.${mode}`, target: deploymentId, details: { previousProduction: previous?.id } });
  await emit({ type: "deploy.updated", projectId, data: { deploymentId } });
  return { ok: true, previousProduction: previous ?? null, rollback: previous ? `To undo, roll back to deployment ${previous.id} (${previous.url}).` : null };
}
