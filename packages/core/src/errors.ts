export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code = "error",
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what = "Resource") => new AppError(404, `${what} not found`, "not_found");
export const forbidden = (msg = "Forbidden") => new AppError(403, msg, "forbidden");
export const badRequest = (msg: string, details?: unknown) => new AppError(400, msg, "bad_request", details);
export const conflict = (msg: string) => new AppError(409, msg, "conflict");

/** Raised when an operation needs configuration the user has not provided yet (missing key, missing integration). */
export class SetupRequiredError extends AppError {
  constructor(message: string, public setup: { kind: string; provider?: string; link?: string }) {
    super(412, message, "setup_required", setup);
    this.name = "SetupRequiredError";
  }
}

/** Error from a third-party API, with the provider's message preserved (secrets redacted by callers). */
export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public status?: number,
    public body?: unknown,
    public retryable = false,
  ) {
    super(`${provider}: ${message}`);
    this.name = "ProviderError";
  }
}

export async function providerFetch<T = any>(
  provider: string,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 60000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { ...rest, signal: controller.signal });
  } catch (err) {
    throw new ProviderError(provider, (err as Error).name === "AbortError" ? "request timed out" : (err as Error).message, undefined, undefined, true);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  if (!res.ok) {
    const msg =
      body?.error?.message ??
      body?.error_description ??
      body?.message ??
      body?.detail ??
      body?.errors?.[0]?.message ??
      body?.title ??
      (typeof body?.error === "string" ? body.error : undefined) ??
      (typeof body === "string" ? body.slice(0, 300) : `HTTP ${res.status}`);
    throw new ProviderError(provider, `${msg} (HTTP ${res.status})`, res.status, body, res.status === 429 || res.status >= 500);
  }
  return body as T;
}
