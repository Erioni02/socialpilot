import { defineConfig } from "vitest/config";

// Database-backed test files share one test database, so files run one at a time.
export default defineConfig({ test: { fileParallelism: false } });
