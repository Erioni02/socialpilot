import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { getProject, NotFoundError, projectWhere } from "./scope";
import { resetDatabase } from "./testing";

async function workspaceWithProject(label: string) {
  const user = await prisma.user.create({ data: { email: `${label}@test.dev`, passwordHash: "x" } });
  const workspace = await prisma.workspace.create({ data: { name: label, ownerId: user.id } });
  const project = await prisma.project.create({ data: { workspaceId: workspace.id, name: label, slug: label } });
  return { workspace, project };
}

describe("project scoping", () => {
  beforeEach(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it("returns a project inside the caller's workspace", async () => {
    const a = await workspaceWithProject("a");
    await expect(getProject({ workspaceId: a.workspace.id, projectId: a.project.id })).resolves.toMatchObject({ id: a.project.id });
  });

  it("refuses a project from another workspace", async () => {
    const a = await workspaceWithProject("a");
    const b = await workspaceWithProject("b");
    await expect(getProject({ workspaceId: a.workspace.id, projectId: b.project.id })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("builds a where clause that always includes the workspace", () => {
    expect(projectWhere({ workspaceId: "w", projectId: "p" })).toEqual({ id: "p", workspaceId: "w" });
  });
});
