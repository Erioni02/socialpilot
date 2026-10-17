import { getProject } from "@sp/db";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { authOf } from "../auth/guard";

export const ProjectParams = z.object({ id: z.string().min(1).max(64) });

/** Resolves `:id` to a project the caller's workspace owns (404 otherwise). */
export async function projectScope(request: FastifyRequest) {
  const auth = authOf(request);
  const { id } = request.params as { id: string };
  const project = await getProject({ workspaceId: auth.workspaceId, projectId: id });
  return { auth, project, scope: { workspaceId: auth.workspaceId, projectId: project.id }, actor: { type: "user" as const, id: auth.userId } };
}
