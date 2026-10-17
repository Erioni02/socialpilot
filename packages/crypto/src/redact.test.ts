import { describe, expect, it } from "vitest";
import { lastFour, redact } from "./redact";

describe("redact", () => {
  it("redacts values under sensitive keys, deeply", () => {
    expect(redact({ apiKey: "x", nested: { Authorization: "Bearer y" }, ok: 1 })).toEqual({
      apiKey: "[REDACTED]",
      nested: { Authorization: "[REDACTED]" },
      ok: 1
    });
  });
  it("redacts credential-shaped strings under any key", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlLXZhbHVl";
    expect(redact({ note: "sk-abc123", a: ["nvapi-zzz", "ghp_123", "xoxb-1", "xoxp-2", jwt, "hello"] })).toEqual({
      note: "[REDACTED]",
      a: ["[REDACTED]", "[REDACTED]", "[REDACTED]", "[REDACTED]", "[REDACTED]", "hello"]
    });
  });
  it("does not mutate its input", () => {
    const input = { password: "p", list: [{ token: "t" }] };
    redact(input);
    expect(input).toEqual({ password: "p", list: [{ token: "t" }] });
  });
  it("leaves non-sensitive data alone", () => {
    expect(redact({ url: "https://vibejudge.app", count: 3, flag: null })).toEqual({ url: "https://vibejudge.app", count: 3, flag: null });
  });
});

describe("lastFour", () => {
  it("masks all but the last four characters", () => {
    expect(lastFour("nvapi-abcdef1234")).toBe("••••1234");
  });
  it("fully masks short secrets", () => {
    expect(lastFour("abc")).toBe("••••");
  });
});
