import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __socialpilotPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.__socialpilotPrisma ??
  new PrismaClient({ log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["warn", "error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.__socialpilotPrisma = prisma;

export { Prisma, PrismaClient };
export type * from "@prisma/client";

export { DEFAULT_DISCOVER_SOURCES, seedDiscoverSources } from "./seed-data";
