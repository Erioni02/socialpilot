const SENSITIVE_KEY = /token|secret|key|password|authorization|cookie/i;
const CREDENTIAL_VALUE = /^(sk-|nvapi-|ghp_|github_pat_|xox[bp]-)|^Bearer\s|^eyJ[\w-]+\.[\w-]+\.[\w-]+$/;
const MASK = "[REDACTED]";

/** Deep copy of `value` with secrets replaced by "[REDACTED]". Safe for logs, audit entries and error bodies. */
export function redact<T>(value: T): T {
  return walk(value, false) as T;
}

function walk(value: unknown, sensitive: boolean): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sensitive || CREDENTIAL_VALUE.test(value) ? MASK : value;
  if (Array.isArray(value)) return value.map((item) => walk(item, sensitive));
  if (value instanceof Date) return new Date(value);
  if (Buffer.isBuffer(value)) return MASK;
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, sensitive || SENSITIVE_KEY.test(k) ? maskAny(v) : walk(v, false)])
    );
  }
  return sensitive ? MASK : value;
}

function maskAny(value: unknown): unknown {
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return MASK;
  return walk(value, true);
}

export function lastFour(secret: string): string {
  return secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`;
}
