import { describe, expect, it } from "vitest";
import {
  autonomyConfirmationPhrase,
  checkPermission,
  effectiveCapabilities,
  explainUnavailable,
  isWithinPublishHours,
  normalizePolicy,
  withUtm,
  estimateTextCost,
} from "../src";

describe("permission policy", () => {
  it("defaults to Creator with approvals on and outbound permissions off", () => {
    const p = normalizePolicy({});
    expect(p.autonomyLevel).toBe(2);
    expect(p.approvals.publish).toBe(true);
    expect(checkPermission(p, "createContent").allowed).toBe(true);
    expect(checkPermission(p, "publish").allowed).toBe(false);
  });

  it("level 1 can only read", () => {
    const p = normalizePolicy({ autonomyLevel: 1 });
    expect(checkPermission(p, "readAccountData").allowed).toBe(true);
    expect(checkPermission(p, "createContent").allowed).toBe(false);
    expect(checkPermission(p, "editAssets").allowed).toBe(false);
  });

  it("granular toggle narrows what the level allows", () => {
    const p = normalizePolicy({ autonomyLevel: 3, permissions: { publish: false } });
    const d = checkPermission(p, "publish");
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toMatch(/disabled/);
  });

  it("below level 4 outbound actions always require approval even if approvals are switched off", () => {
    const p = normalizePolicy({ autonomyLevel: 3, permissions: { publish: true, reply: true }, approvals: { publish: false, reply: false } });
    expect(checkPermission(p, "publish")).toEqual({ allowed: true, requiresApproval: true });
    expect(checkPermission(p, "reply")).toEqual({ allowed: true, requiresApproval: true });
  });

  it("level 4 respects explicit approval settings", () => {
    const on = normalizePolicy({ autonomyLevel: 4, permissions: { publish: true } });
    expect(checkPermission(on, "publish").requiresApproval).toBe(true);
    const off = normalizePolicy({ autonomyLevel: 4, permissions: { publish: true }, approvals: { publish: false } });
    expect(checkPermission(off, "publish").requiresApproval).toBe(false);
  });

  it("merge and deploy are never available below level 4", () => {
    const p = normalizePolicy({ autonomyLevel: 3, permissions: { mergeCode: true, deploy: true } });
    expect(checkPermission(p, "mergeCode").allowed).toBe(false);
    expect(checkPermission(p, "deploy").allowed).toBe(false);
  });

  it("confirmation phrase is level specific", () => {
    expect(autonomyConfirmationPhrase(4)).toBe("ENABLE LEVEL 4");
  });

  it("publish hours are evaluated in the project timezone", () => {
    const limits = normalizePolicy({}).limits; // 8–21
    const noonUtc = new Date("2026-10-18T12:00:00Z");
    expect(isWithinPublishHours(limits, noonUtc, "UTC")).toBe(true);
    expect(isWithinPublishHours(limits, noonUtc, "Pacific/Auckland")).toBe(false); // 01:00 next day
  });
});

describe("capability registry", () => {
  it("instagram cannot publish text-only posts and explains the alternative", () => {
    const msg = explainUnavailable("instagram", "publish_text", []);
    expect(msg).toMatch(/image or video/);
    expect(msg).toMatch(/Alternative/);
  });
  it("tiktok has no comments API", () => {
    const caps = effectiveCapabilities("tiktok", ["user.info.basic", "video.list"]);
    expect(caps.find((c) => c.operation === "list_comments")?.available).toBe(false);
    expect(caps.find((c) => c.operation === "list_posts")?.available).toBe(true);
  });
  it("missing scopes make supported operations unavailable", () => {
    const msg = explainUnavailable("x", "publish_image", ["tweet.write"]);
    expect(msg).toMatch(/media\.write/);
  });
});

describe("utm + pricing", () => {
  it("adds campaign tracking parameters without overriding existing ones", () => {
    const u = new URL(withUtm("https://vibejudge.app/?utm_source=keep", { source: "x", campaign: "Launch Week!" }));
    expect(u.searchParams.get("utm_source")).toBe("keep");
    expect(u.searchParams.get("utm_medium")).toBe("social");
    expect(u.searchParams.get("utm_campaign")).toBe("launch-week");
  });
  it("estimates text costs by model", () => {
    expect(estimateTextCost("claude-opus-5-5", 1_000_000, 0)).toBeCloseTo(4);
    expect(estimateTextCost("gpt-4.1-mini", 0, 1_000_000)).toBeCloseTo(1.6);
  });
});
