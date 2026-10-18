import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config, sign, storageRoot, verifySignature } from "@socialpilot/core";

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "application/json": "json",
  "text/markdown": "md",
  "text/plain": "txt",
  "application/x-subrip": "srt",
};

export function extFor(mime: string): string {
  return EXT[mime] ?? "bin";
}

/** Storage keys are generated server-side only: <projectId>/<yyyy-mm>/<uuid>.<ext>. Never derived from user input. */
export function newKey(projectId: string, mimeType: string): string {
  if (!/^[a-z0-9]+$/i.test(projectId)) throw new Error("invalid project id");
  const month = new Date().toISOString().slice(0, 7);
  return `${projectId}/${month}/${randomUUID()}.${extFor(mimeType)}`;
}

export function keyPath(key: string): string {
  const root = path.resolve(storageRoot());
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("invalid storage key");
  return full;
}

export async function putObject(key: string, data: Buffer): Promise<void> {
  const p = keyPath(key);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, data);
}

export async function getObject(key: string): Promise<Buffer> {
  return readFile(keyPath(key));
}

export function streamObject(key: string) {
  return createReadStream(keyPath(key));
}

export async function objectSize(key: string): Promise<number> {
  return (await stat(keyPath(key))).size;
}

export async function deleteObject(key: string): Promise<void> {
  await rm(keyPath(key), { force: true });
}

/**
 * Time-limited public URL for a stored file, used only when a platform must download media (Instagram, TikTok).
 * Requires PUBLIC_BASE_URL. The HMAC covers key + expiry.
 */
export function signedPublicUrl(key: string, ttlSeconds = 6 * 3600): string | undefined {
  if (!config.PUBLIC_BASE_URL) return undefined;
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = sign(`${key}:${exp}`);
  return `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}/public/media/${key}?exp=${exp}&sig=${sig}`;
}

export function verifyPublicUrl(key: string, exp: string, sig: string): boolean {
  const e = Number(exp);
  if (!Number.isFinite(e) || e < Date.now() / 1000) return false;
  return verifySignature(`${key}:${e}`, sig);
}
