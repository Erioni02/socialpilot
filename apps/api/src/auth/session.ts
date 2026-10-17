import { prisma } from "@sp/db";
import argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE = "sp_session";
export const CSRF_COOKIE = "sp_csrf";
export const SESSION_DAYS = 30;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

// Verified when the email is unknown so both failure paths take the same time.
const DUMMY_HASH = argon2.hash("not-a-real-password-placeholder", { type: argon2.argon2id });

export async function verifyLogin(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  const ok = await argon2.verify(user?.passwordHash ?? (await DUMMY_HASH), password).catch(() => false);
  return ok && user ? user : null;
}

export async function createSession(userId: string, meta: { ip?: string; userAgent?: string }) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) } });
  return { token, expiresAt };
}

/** The signed-in user and their workspace for a session token, or null if missing/expired. */
export async function resolveSession(token: string | undefined) {
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session || session.expiresAt <= new Date()) return null;
  const member = await prisma.workspaceMember.findFirst({ where: { userId: session.userId }, orderBy: { createdAt: "asc" } });
  if (!member) return null;
  return { sessionId: session.id, userId: session.userId, workspaceId: member.workspaceId };
}

export async function destroySession(token: string | undefined) {
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}
