import { describe, expect, it } from "vitest";
import { assertPublicUrl, decrypt, encrypt, encryptJson, decryptJson, isPrivateIp, isSecretPath, pkcePair, redact, redactString, sign, verifySignature } from "../src";

describe("encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encrypt("token-123");
    const b = encrypt("token-123");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("token-123");
    expect(decryptJson(encryptJson({ accessToken: "x" }))).toEqual({ accessToken: "x" });
  });
  it("rejects tampered ciphertext", () => {
    const parts = encrypt("secret").split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("signs and verifies", () => {
    const s = sign("key:123");
    expect(verifySignature("key:123", s)).toBe(true);
    expect(verifySignature("key:124", s)).toBe(false);
  });
  it("creates valid PKCE pairs", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("SSRF protection", () => {
  it("classifies private and reserved addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.5.5", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "::ffff:127.0.0.1", "100.64.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPrivateIp(ip), ip).toBe(false);
  });
  it("blocks localhost, metadata endpoints, credentials and non-http schemes", async () => {
    await expect(assertPublicUrl("http://localhost:4000/api")).rejects.toThrow(/Blocked/);
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/Blocked/);
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(/Blocked protocol/);
    await expect(assertPublicUrl("https://user:pass@example.com")).rejects.toThrow(/Credentials/);
    await expect(assertPublicUrl("http://[::1]/")).rejects.toThrow(/Blocked/);
  });
});

describe("secret redaction", () => {
  it("redacts secret-looking keys and token patterns deeply", () => {
    const out = redact({ apiKey: "abc", nested: { refresh_token: "r", note: "use sk-ant-abcdefghijklmnopqrstuvwxyz please" }, list: ["ghp_abcdefghijklmnopqrstuvwxyz0123"] });
    expect(out.apiKey).toBe("[REDACTED]");
    expect(out.nested.refresh_token).toBe("[REDACTED]");
    expect(out.nested.note).not.toContain("sk-ant-");
    expect(out.list[0]).toBe("[REDACTED]");
    expect(redactString("Authorization: Bearer abcdefghijklmnopqrstu")).toContain("[REDACTED]");
  });
  it("identifies secret file paths", () => {
    expect(isSecretPath(".env")).toBe(true);
    expect(isSecretPath("apps/web/.env.production")).toBe(true);
    expect(isSecretPath(".env.example")).toBe(false);
    expect(isSecretPath("config/service-account-prod.json")).toBe(true);
    expect(isSecretPath("src/index.ts")).toBe(false);
  });
});
