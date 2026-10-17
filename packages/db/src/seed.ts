import argon2 from "argon2";
import { prisma } from "./client";

/** Creates (or updates the password of) the single owner account and their workspace. Never creates projects. */
export async function seed(env: Record<string, string | undefined> = process.env) {
  const email = env.OWNER_EMAIL?.trim().toLowerCase();
  const password = env.OWNER_PASSWORD ?? "";
  if (!email) throw new Error("OWNER_EMAIL is not set");
  if (password.length < 12) throw new Error("OWNER_PASSWORD must be at least 12 characters");

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, passwordHash, name: email.split("@")[0]! },
    update: { passwordHash }
  });

  const existing = await prisma.workspaceMember.findFirst({ where: { userId: user.id } });
  if (!existing) {
    const workspace = await prisma.workspace.create({ data: { name: "My workspace", ownerId: user.id } });
    await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, role: "owner" } });
  }
  return user;
}
