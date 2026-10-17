import type { Project } from "@prisma/client";
import { prisma } from "./client";

export class NotFoundError extends Error {
  override name = "NotFoundError";
}

export type Scope = { workspaceId: string; projectId?: string };
export type ProjectScope = { workspaceId: string; projectId: string };

/** The only way to address a project: always constrained to the caller's workspace. */
export function projectWhere(scope: ProjectScope) {
  return { id: scope.projectId, workspaceId: scope.workspaceId };
}

export async function getProject(scope: ProjectScope): Promise<Project> {
  const project = await prisma.project.findFirst({ where: projectWhere(scope) });
  if (!project) throw new NotFoundError("Project not found");
  return project;
}
