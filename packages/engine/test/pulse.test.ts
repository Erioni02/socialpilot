import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@socialpilot/db";
import { createProject, getPulseSettings, savePulseSettings, pulseCreditsToday, runSocialPulse, getSkill, SKILLS, saveCredential } from "../src";

afterAll(async () => prisma.$disconnect());
afterEach(() => vi.unstubAllGlobals());

const user = () => prisma.user.create({ data: { email: `pulse-${Date.now()}-${Math.random()}@example.test`, name: "P", passwordHash: "x" } });

describe("Social Pulse", () => {
  it("defaults to free-only and refuses paid crawling without a SocialCrawl key", async () => {
    const u = await user();
    const s = await getPulseSettings(u.id);
    expect(s.paid.enabled).toBe(false);
    const prev = process.env.SOCIALCRAWL_API_KEY;
    delete process.env.SOCIALCRAWL_API_KEY;
    await expect(savePulseSettings(u.id, { paid: { enabled: true } })).rejects.toThrow(/SocialCrawl/);
    if (prev) process.env.SOCIALCRAWL_API_KEY = prev;
  });

  it("never spends past the daily credit cap", async () => {
    const u = await user();
    await createProject(u.id, { name: "Pulse test" });
    const key = `sc_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await saveCredential(u.id, "socialcrawl", { apiKey: key });
    await savePulseSettings(u.id, { paid: { enabled: true, platforms: ["tiktok", "instagram"], dailyCreditCap: 5, everyMinutes: 20 } });
    const paidCalls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const u2 = String(url);
      if (u2.includes("socialcrawl")) {
        if ((init.headers as Record<string, string>)?.["x-api-key"] === key) paidCalls.push(u2);
        return new Response(JSON.stringify({ success: true, data: { items: [] }, credits_used: 5 }), { headers: { "content-type": "application/json" } });
      }
      if (u2.includes("trends.google")) return new Response("<rss><channel></channel></rss>");
      return new Response(JSON.stringify(u2.includes("bsky") ? { topics: [] } : []), { headers: { "content-type": "application/json" } });
    });
    await runSocialPulse();
    expect(paidCalls.length).toBe(1); // tiktok (5) fits the cap of 5; instagram would exceed it
    expect((await pulseCreditsToday(u.id)).credits).toBe(5);
    await runSocialPulse();
    expect(paidCalls.length).toBe(1); // cap reached (and interval not elapsed): nothing more is spent
  });
});

describe("skills", () => {
  it("exposes marketing and creative playbooks", () => {
    expect(SKILLS.length).toBeGreaterThanOrEqual(10);
    expect(getSkill("image-creative-direction")?.body).toMatch(/Seedream/);
    expect(getSkill("video-creative-direction")?.body).toMatch(/Seedance/);
  });
});
