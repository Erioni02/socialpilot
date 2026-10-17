import { defineProject } from "vitest/config";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://sp:sp@localhost:5432/socialpilot_test";

export default defineProject({
  test: {
    env: { DATABASE_URL: TEST_DATABASE_URL },
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false
  }
});
