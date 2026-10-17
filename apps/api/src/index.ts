import "./env";
import { prisma } from "@sp/db";
import { closeEvents, registerCycle1Tools, stopBoss } from "@sp/tools";
import { registerApiRoutes } from "./routes";
import { buildServer } from "./server";

registerCycle1Tools();
const app = await buildServer({ registerRoutes: registerApiRoutes });
const port = Number(process.env.API_PORT ?? 4000);

try {
  await app.listen({ port, host: process.env.API_HOST ?? "127.0.0.1" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

const shutdown = async () => {
  await app.close();
  await Promise.allSettled([stopBoss(), closeEvents(), prisma.$disconnect()]);
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
