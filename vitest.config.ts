import { defineConfig } from "vitest/config";

const testDb = process.env.DATABASE_URL_TEST ?? "postgresql://socialpilot:socialpilot@localhost:5433/socialpilot_test";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/api/test/**/*.test.ts"],
    environment: "node",
    globalSetup: ["./scripts/test-global-setup.ts"],
    env: { DATABASE_URL: testDb, NODE_ENV: "test", STORAGE_DIR: ".data/test-storage", APP_URL: "http://localhost:5173", API_PUBLIC_URL: "http://localhost:4000", REDIS_URL: "" },
    testTimeout: 30000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
});
