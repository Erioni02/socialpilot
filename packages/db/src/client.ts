import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as typeof globalThis & { __spPrisma?: PrismaClient };

export const prisma = (globalForPrisma.__spPrisma ??= new PrismaClient());
