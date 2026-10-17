import { config } from "dotenv";
import { resolve } from "node:path";
import { prisma } from "./client";
import { seed } from "./seed";

config({ path: resolve(import.meta.dirname, "../../../.env") });

seed()
  .then((user) => console.log(`Owner ready: ${user.email}`))
  .catch((error: Error) => {
    console.error(`Seed failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
