import { defineProject } from "vitest/config";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://sp:sp@localhost:5432/socialpilot_test";

export default defineProject({
  test: {
    env: { DATABASE_URL: url, DIRECT_URL: url, ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=" },
    globalSetup: ["../../packages/db/test/global-setup.ts"]
  }
});
