import { config, createLogger, requireSecrets } from "@socialpilot/core";
import { prisma, seedDiscoverSources } from "@socialpilot/db";
import { buildApp } from "./app";
import { startEventListener, stopEventListener } from "./routes/events";

const log = createLogger("api");

requireSecrets();
const app = await buildApp({ logger: config.NODE_ENV === "production" });
await seedDiscoverSources(prisma);
await startEventListener();
await app.listen({ port: config.API_PORT, host: config.API_HOST });
log.info(`API listening on http://localhost:${config.API_PORT} (public: ${config.API_PUBLIC_URL})`);

const shutdown = async () => {
  log.info("shutting down");
  await app.close();
  await stopEventListener();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
