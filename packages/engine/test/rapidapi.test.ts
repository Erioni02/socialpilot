import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@socialpilot/db";
import { assertRapidBudget, dueRapidMilestone, rapidStatus, recordRapidUse, saveCredential, saveRapidSettings } from "../src";

afterAll(async () => prisma.$disconnect());
const user = () => prisma.user.create({ data: { email: `rapid-${Date.now()}-${Math.random()}@example.test`, name: "R", passwordHash: "x" } });

describe("RapidAPI budget guard", () => {
  it("uses the provider's quota headers and stops at the monthly budget, keeping a reserve for automatic use", async () => {
    const u = await user();
    await saveCredential(u.id, "rapidapi", { apiKey: "rapid-test-key" });
    await saveRapidSettings(u.id, { monthlyBudget: 10, autoTracking: true });
    await recordRapidUse(u.id, { limit: 50, remaining: 43, resetInSec: 3600, hardLimit: true }, "test");
    let s = await rapidStatus(u.id);
    expect([s.used, s.budgetLeft, s.hardLimit]).toEqual([7, 3, true]);
    await expect(assertRapidBudget(u.id, 1, true)).rejects.toThrow(/paused/); // 3 left < reserve of 5
    await expect(assertRapidBudget(u.id, 1)).resolves.toBeTruthy(); // manual lookups may use the reserve
    await recordRapidUse(u.id, { limit: 50, remaining: 40, resetInSec: 3500, hardLimit: true }, "test");
    s = await rapidStatus(u.id);
    expect(s.budgetLeft).toBe(0);
    await expect(assertRapidBudget(u.id, 1)).rejects.toThrow(/used up/);
  });

  it("never exceeds the plan's remaining requests even with a larger budget", async () => {
    const u = await user();
    await saveCredential(u.id, "rapidapi", { apiKey: "rapid-test-key-2" });
    await saveRapidSettings(u.id, { monthlyBudget: 1000, autoTracking: true });
    await recordRapidUse(u.id, { limit: 50, remaining: 2, resetInSec: 3600, hardLimit: true }, "test");
    expect((await rapidStatus(u.id)).budgetLeft).toBe(2);
  });

  it("schedules post snapshots at 1, 3 and 7 days", () => {
    const now = Date.now();
    const at = (h: number) => new Date(now - h * 3600_000);
    expect(dueRapidMilestone(at(5), [], now)).toBeNull();
    expect(dueRapidMilestone(at(30), [], now)).toBe(24);
    expect(dueRapidMilestone(at(80), [24], now)).toBe(72);
    expect(dueRapidMilestone(at(200), [24, 72, 168], now)).toBeNull();
  });
});
