import { redact } from "./redact";

type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = order[(process.env.LOG_LEVEL as Level) ?? "info"] ?? 20;

function emit(level: Level, scope: string, msg: string, data?: unknown) {
  if (order[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  const payload = data === undefined ? "" : " " + JSON.stringify(redact(data));
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line + payload);
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, data?: unknown) => emit("debug", scope, msg, data),
    info: (msg: string, data?: unknown) => emit("info", scope, msg, data),
    warn: (msg: string, data?: unknown) => emit("warn", scope, msg, data),
    error: (msg: string, data?: unknown) => emit("error", scope, msg, data),
  };
}
export type Logger = ReturnType<typeof createLogger>;
