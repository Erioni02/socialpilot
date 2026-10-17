import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(import.meta.dirname, "../.env") });

/**
 * End-to-end: real web app, API, worker and database (start `npm run db:local` first when not using Supabase),
 * real network fetch of vibejudge.app. `npm run dev` is reused if already running.
 */
export default defineConfig({
  testDir: ".",
  timeout: 360_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "../playwright-report" }]],
  outputDir: "../test-results",
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: { command: "npm run dev", cwd: "..", url: "http://localhost:5173/api/health", reuseExistingServer: true, timeout: 120_000 }
});
