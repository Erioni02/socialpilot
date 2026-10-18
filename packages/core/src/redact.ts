const SECRET_KEYS = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential|private[-_]?key|client_secret|refresh/i;

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_\-]{16,}/g, // OpenAI / Anthropic style
  /sk-ant-[A-Za-z0-9_\-]{16,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /r8_[A-Za-z0-9]{20,}/g, // Replicate
  /AIza[0-9A-Za-z_\-]{30,}/g, // Google
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /Bearer\s+[A-Za-z0-9._\-]{16,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
];

export function redactString(input: string): string {
  let out = input;
  for (const p of SECRET_PATTERNS) out = out.replace(p, "[REDACTED]");
  return out;
}

/** Deep-redacts secrets from any value before it is logged, stored in audit logs, or shown to an AI model. */
export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return value;
  if (typeof value === "string") return redactString(value) as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) && v != null && v !== "" ? "[REDACTED]" : redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

/** Paths that must never be read by an AI from a repository. */
export function isSecretPath(p: string): boolean {
  const lower = p.toLowerCase();
  return (
    /(^|\/)\.env(\.|$)/.test(lower) && !lower.endsWith(".example") && !lower.endsWith(".sample") ||
    /(^|\/)(id_rsa|id_ed25519|.*\.pem|.*\.key|.*\.p12|.*\.pfx|credentials\.json|service-account.*\.json|\.npmrc|\.pypirc|\.netrc)$/.test(lower) ||
    lower.includes("/secrets/")
  );
}
