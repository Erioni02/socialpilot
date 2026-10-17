import { execSync } from "node:child_process";
import { resolve } from "node:path";

/** Applies migrations to the test database once per run. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://sp:sp@localhost:5432/socialpilot_test";
  execSync("npx prisma migrate deploy", { cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: "pipe" });
}
