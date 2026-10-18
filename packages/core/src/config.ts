import { z } from "zod";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

/** Minimal .env loader (no dependency). Real environment variables always win. */
function loadDotEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const file = path.join(dir, ".env");
    if (existsSync(file)) {
      for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
        if (!m || line.trim().startsWith("#")) continue;
        let value = m[2];
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        if (process.env[m[1]] === undefined) process.env[m[1]] = value;
      }
      return file;
    }
    dir = path.dirname(dir);
  }
  return null;
}
const envFile = loadDotEnv();
export const ROOT_DIR = envFile ? path.dirname(envFile) : process.cwd();

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().default("postgresql://socialpilot:socialpilot@localhost:5433/socialpilot"),
  REDIS_URL: z.string().optional(),
  API_PORT: z.coerce.number().default(4000),
  API_HOST: z.string().default("0.0.0.0"),
  /** Where the browser reaches the web app (used for OAuth redirects back to the UI). */
  APP_URL: z.string().default("http://localhost:5173"),
  /** Where OAuth providers reach the API (callback URLs). */
  API_PUBLIC_URL: z.string().default("http://localhost:4000"),
  /** Public HTTPS base URL that social platforms can fetch media from (Instagram/TikTok publishing). */
  PUBLIC_BASE_URL: z.string().optional(),
  ENCRYPTION_KEY: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  STORAGE_DIR: z.string().default(".data/storage"),
  MAX_UPLOAD_MB: z.coerce.number().default(200),
  ALLOW_REGISTRATION: z.enum(["true", "false"]).default("true"),
  /** Allow custom AI providers on localhost/private networks (Ollama, LM Studio). Defaults to on outside production. */
  ALLOW_LOCAL_AI_ENDPOINTS: z.enum(["true", "false"]).optional(),
  WORKER_CONCURRENCY: z.coerce.number().default(4),
  FFMPEG_PATH: z.string().optional(),
  FFPROBE_PATH: z.string().optional(),
  LOG_LEVEL: z.string().default("info"),
});

export const config = schema.parse(process.env);
export type Config = typeof config;

export const isProd = config.NODE_ENV === "production";
export const allowLocalAiEndpoints = config.ALLOW_LOCAL_AI_ENDPOINTS ? config.ALLOW_LOCAL_AI_ENDPOINTS === "true" : !isProd;

export function storageRoot(): string {
  return path.isAbsolute(config.STORAGE_DIR) ? config.STORAGE_DIR : path.join(ROOT_DIR, config.STORAGE_DIR);
}

export function oauthCallbackUrl(provider: string): string {
  return `${config.API_PUBLIC_URL.replace(/\/$/, "")}/api/oauth/${provider}/callback`;
}

export function requireSecrets() {
  if (isProd) {
    if (!config.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY is required in production");
    if (!config.SESSION_SECRET) throw new Error("SESSION_SECRET is required in production");
  }
}
