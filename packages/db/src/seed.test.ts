import argon2 from "argon2";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { seed } from "./seed";
import { resetDatabase } from "./testing";

describe("seed", () => {
  beforeEach(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it("creates the owner, a workspace and membership, idempotently", async () => {
    const env = { OWNER_EMAIL: "Owner@Test.dev", OWNER_PASSWORD: "correct horse battery" };
    await seed(env);
    await seed(env);
    const users = await prisma.user.findMany({ include: { memberships: true } });
    expect(users).toHaveLength(1);
    expect(users[0]!.email).toBe("owner@test.dev");
    expect(users[0]!.memberships).toHaveLength(1);
    expect(await argon2.verify(users[0]!.passwordHash, "correct horse battery")).toBe(true);
    expect(await prisma.workspace.count()).toBe(1);
    expect(await prisma.project.count()).toBe(0);
  });

  it("refuses a short password", async () => {
    await expect(seed({ OWNER_EMAIL: "o@test.dev", OWNER_PASSWORD: "short" })).rejects.toThrow(/at least 12/);
  });
});
