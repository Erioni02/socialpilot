import { prisma } from "@sp/db";
import { BrandProfileInputSchema } from "@sp/shared";
import { executeTool, toProfileDTO } from "@sp/tools";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { ProjectParams, projectScope } from "./scope";

export const brandRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/projects/:id/brand-profile", { schema: { tags: ["brand"], params: ProjectParams } }, async (request) => {
    const { project } = await projectScope(request);
    const latest = await prisma.brandProfile.findFirst({ where: { projectId: project.id }, orderBy: { version: "desc" } });
    return latest ? toProfileDTO(latest) : null;
  });

  app.get("/projects/:id/brand-profile/versions", { schema: { tags: ["brand"], params: ProjectParams } }, async (request) => {
    const { project } = await projectScope(request);
    const rows = await prisma.brandProfile.findMany({ where: { projectId: project.id }, orderBy: { version: "desc" }, take: 50 });
    return rows.map(toProfileDTO);
  });

  app.put(
    "/projects/:id/brand-profile",
    { schema: { tags: ["brand"], params: ProjectParams, body: BrandProfileInputSchema.extend({ confirm: z.boolean().optional() }) } },
    async (request) => {
      const { scope, actor } = await projectScope(request);
      await executeTool({ ...scope, actor }, "brand.updateProfile", request.body);
      const latest = await prisma.brandProfile.findFirstOrThrow({ where: { projectId: scope.projectId }, orderBy: { version: "desc" } });
      return toProfileDTO(latest);
    }
  );
};
