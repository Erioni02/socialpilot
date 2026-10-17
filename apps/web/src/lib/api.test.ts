// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, setUnauthorizedHandler } from "./api";

const respond = (status: number, body?: unknown) =>
  vi.fn(async (_url: string, _init?: RequestInit) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("api", () => {
  beforeEach(() => {
    document.cookie = "sp_csrf=tok123; path=/";
    window.history.replaceState(null, "", "/projects/new");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends credentials, the CSRF header and JSON only when there is a body", async () => {
    const fetch = respond(200, { ok: true });
    vi.stubGlobal("fetch", fetch);
    await api("/projects", { method: "POST", body: { name: "VibeJudge" } });
    await api("/projects/p1/analyze", { method: "POST" });
    const [, withBody] = fetch.mock.calls[0]!;
    const [, withoutBody] = fetch.mock.calls[1]!;
    expect(withBody!.credentials).toBe("include");
    expect((withBody!.headers as Record<string, string>)["x-csrf-token"]).toBe("tok123");
    expect((withBody!.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(withBody!.body).toBe('{"name":"VibeJudge"}');
    expect((withoutBody!.headers as Record<string, string>)["content-type"]).toBeUndefined();
    expect(fetch.mock.calls[0]![0]).toBe("/api/projects");
  });

  it("calls the unauthorized handler with the current path on 401", async () => {
    vi.stubGlobal("fetch", respond(401, { error: { code: "unauthorized", message: "Please sign in" } }));
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    await expect(api("/auth/me")).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledWith("/login?next=%2Fprojects%2Fnew");
  });

  it("throws ApiError with the server's code and message", async () => {
    vi.stubGlobal("fetch", respond(400, { error: { code: "confirm_name_mismatch", message: "Type the project name" } }));
    const error = await api("/projects/p/policy", { method: "PUT", body: {} }).catch((e) => e);
    expect(error).toMatchObject({ status: 400, code: "confirm_name_mismatch", message: "Type the project name" });
  });

  it("returns undefined for 204", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await expect(api("/projects/p", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("explains a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(api("/projects")).rejects.toMatchObject({ code: "network" });
  });
});
