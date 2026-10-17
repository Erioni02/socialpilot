import { describe, expect, it } from "vitest";
import { InvalidUrlError, normalizeSiteUrl } from "./url";

describe("normalizeSiteUrl", () => {
  it("adds https to a bare domain", () => {
    expect(normalizeSiteUrl("vibejudge.app")).toEqual({ origin: "https://vibejudge.app", startUrl: "https://vibejudge.app/" });
  });
  it("keeps a path as the start page", () => {
    expect(normalizeSiteUrl("https://vibejudge.app/pricing")).toEqual({ origin: "https://vibejudge.app", startUrl: "https://vibejudge.app/pricing" });
  });
  it("trims whitespace and drops the hash", () => {
    expect(normalizeSiteUrl("  https://vibejudge.app/#top ").startUrl).toBe("https://vibejudge.app/");
  });
  it("accepts a bare domain with a port", () => {
    expect(normalizeSiteUrl("example.com:8080").origin).toBe("https://example.com:8080");
  });
  it.each(["javascript:alert(1)", "ftp://x.com", "http://127.0.0.1", "http://[::1]", "http://10.0.0.5", "", "http://localhost:3000", "not a url", "data:text/html,hi"])(
    "rejects %s",
    (input) => {
      expect(() => normalizeSiteUrl(input)).toThrow(InvalidUrlError);
    }
  );
});
