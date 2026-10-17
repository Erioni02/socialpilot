import { config } from "dotenv";
import { resolve } from "node:path";

// Imported first: loads the repo-root .env before any package reads process.env.
config({ path: resolve(import.meta.dirname, "../../../.env") });
