import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, loadKey } from "./encrypt";

const key = randomBytes(32);

describe("encrypt/decrypt", () => {
  it("round-trips plaintext", () => {
    expect(decrypt(encrypt("sk-123", key), key)).toBe("sk-123");
  });
  it("uses a random IV so equal plaintexts differ", () => {
    expect(encrypt("same", key).equals(encrypt("same", key))).toBe(false);
  });
  it("writes key version 1 as the first byte", () => {
    expect(encrypt("x", key)[0]).toBe(1);
  });
  it("rejects tampered ciphertext", () => {
    const blob = encrypt("secret", key);
    blob[blob.length - 1] ^= 0xff;
    expect(() => decrypt(blob, key)).toThrow();
  });
  it("rejects the wrong key", () => {
    expect(() => decrypt(encrypt("secret", key), randomBytes(32))).toThrow();
  });
});

describe("loadKey", () => {
  it("accepts a 32-byte base64 key", () => {
    expect(loadKey({ ENCRYPTION_KEY: key.toString("base64") }).length).toBe(32);
  });
  it("throws on a 16-byte key", () => {
    expect(() => loadKey({ ENCRYPTION_KEY: randomBytes(16).toString("base64") })).toThrow(/32 bytes/);
  });
  it("throws when missing", () => {
    expect(() => loadKey({})).toThrow(/ENCRYPTION_KEY/);
  });
});

describe("sealJson/openJson", () => {
  it("round-trips JSON as DB-ready bytes", async () => {
    const { sealJson, openJson } = await import("./encrypt");
    const sealed = sealJson(["k1", "k2"], key);
    expect(sealed).toBeInstanceOf(Uint8Array);
    expect(openJson<string[]>(sealed, key)).toEqual(["k1", "k2"]);
  });
});
