export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

let onUnauthorized: (loginPath: string) => void = (path) => window.location.assign(path);
export function setUnauthorizedHandler(handler: (loginPath: string) => void) {
  onUnauthorized = handler;
}

function csrfToken(): string {
  return document.cookie.match(/(?:^|;\s*)sp_csrf=([^;]+)/)?.[1] ?? "";
}

type Options = { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; formData?: FormData };

/** Calls the SocialPilot API (`/api` + path). Throws ApiError; on 401 hands control to the login redirect. */
export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { accept: "application/json" };
  if (method !== "GET") headers["x-csrf-token"] = csrfToken();
  let body: BodyInit | undefined;
  if (opts.formData) body = opts.formData;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body, credentials: "include" });
  } catch {
    throw new ApiError(0, "network", "Can't reach the SocialPilot API. Is the backend running (npm run dev)?");
  }

  if (res.status === 204) return undefined as T;
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    if (res.status === 401 && !path.startsWith("/auth/login")) {
      onUnauthorized(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
    throw new ApiError(res.status, error?.code ?? "http_error", error?.message ?? `Request failed (HTTP ${res.status})`);
  }
  return payload as T;
}
