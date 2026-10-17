import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/guard";
import { aiProviderRoutes } from "./aiProviders";
import { brandRoutes } from "./brand";
import { eventRoutes } from "./events";
import { governanceRoutes } from "./governance";
import { projectRoutes } from "./projects";
import { taskRoutes } from "./tasks";

/** Every project-domain route requires a signed-in session. */
export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (authed) => {
    authed.addHook("preHandler", requireAuth);
    await authed.register(projectRoutes);
    await authed.register(brandRoutes);
    await authed.register(taskRoutes);
    await authed.register(governanceRoutes);
    await authed.register(aiProviderRoutes);
    await authed.register(eventRoutes);
  });
}
