import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Layout: [version:1][iv:12][tag:16][ciphertext]
const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function loadKey(env: Record<string, string | undefined> = process.env): Buffer {
  const raw = env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error(`ENCRYPTION_KEY must be 32 bytes (base64), got ${key.length}`);
  return key;
}

export function encrypt(plaintext: string, key: Buffer = loadKey()): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext]);
}

export function decrypt(blob: Buffer, key: Buffer = loadKey()): string {
  if (blob[0] !== VERSION) throw new Error(`Unsupported ciphertext version ${blob[0]}`);
  const iv = blob.subarray(1, 1 + IV_BYTES);
  const tag = blob.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(1 + IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
}

/** Encrypts a JSON value into bytes ready for a Prisma `Bytes` column. */
export function sealJson(value: unknown, key: Buffer = loadKey()): Uint8Array<ArrayBuffer> {
  return new Uint8Array(encrypt(JSON.stringify(value), key));
}

export function openJson<T>(bytes: Uint8Array, key: Buffer = loadKey()): T {
  return JSON.parse(decrypt(Buffer.from(bytes), key)) as T;
}
