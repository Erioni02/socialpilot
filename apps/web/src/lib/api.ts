/** Typed-enough fetch wrapper. All mutations send the CSRF header the API requires; cookies carry the session. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: any,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers: {
      ...(method !== "GET" ? { "x-socialpilot-csrf": "1" } : {}),
      ...(body !== undefined && !isForm ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    ...init,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.code, data?.details);
  return data as T;
}

export const api = {
  get: <T = any>(path: string) => request<T>("GET", path),
  post: <T = any>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  put: <T = any>(path: string, body: unknown = {}) => request<T>("PUT", path, body),
  patch: <T = any>(path: string, body: unknown = {}) => request<T>("PATCH", path, body),
  del: <T = any>(path: string, body?: unknown) => request<T>("DELETE", path, body),
  upload: <T = any>(path: string, form: FormData) => request<T>("POST", path, form),
};

/** Project-scoped path helper: p(id, "/posts") → /projects/:id/posts */
export const p = (projectId: string, rest = "") => `/projects/${projectId}${rest}`;

export function assetUrl(projectId: string, assetId: string, versionId?: string, download = false) {
  const q = new URLSearchParams();
  if (versionId) q.set("version", versionId);
  if (download) q.set("download", "1");
  const s = q.toString();
  return `/api/projects/${projectId}/assets/${assetId}/file${s ? `?${s}` : ""}`;
}
