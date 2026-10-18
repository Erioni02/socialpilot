import { execSync } from "node:child_process";
import path from "node:path";

/** Applies all migrations to the dedicated test database (never the development database). Tests create uniquely named data, so no reset is needed. */
export default function setup() {
  const url = process.env.DATABASE_URL_TEST ?? "postgresql://socialpilot:socialpilot@localhost:5433/socialpilot_test";
  execSync("npx prisma migrate deploy", {
    cwd: path.resolve(__dirname, "../packages/db"),
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    stdio: "pipe",
  });
}
