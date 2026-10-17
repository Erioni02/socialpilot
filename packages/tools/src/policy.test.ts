import { defaultPolicy } from "@sp/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { decide } from "./policy";
import type { Actor, ToolDef } from "./types";

const tool = (overrides: Partial<ToolDef<unknown, unknown>>): ToolDef<unknown, unknown> => ({
  name: "t",
  description: "",
  input: z.unknown(),
  output: z.unknown(),
  capability: "brand.write",
  minAutonomy: 1,
  approval: "never",
  runMode: "inline",
  run: async () => null,
  ...overrides
});
const agent: Actor = { type: "agent", id: "a" };
const user: Actor = { type: "user", id: "u" };

describe("decide", () => {
  it("denies an agent below the tool's autonomy level", () => {
    expect(decide(defaultPolicy(), tool({ minAutonomy: 2 }), agent)).toMatchObject({ decision: "deny", reason: "autonomy" });
  });

  it("lets the user act regardless of autonomy level", () => {
    expect(decide(defaultPolicy(), tool({ minAutonomy: 4 }), user).decision).toBe("allow");
  });

  it("asks for approval when the tool always requires it and an agent calls", () => {
    expect(decide({ ...defaultPolicy(), autonomyLevel: 4 }, tool({ approval: "always" }), agent).decision).toBe("approve");
  });

  it("follows the policy's approve setting for policy-approval tools", () => {
    const policy = { ...defaultPolicy(), autonomyLevel: 4 as const };
    expect(decide(policy, tool({ approval: "policy", capability: "social.publish" }), agent).decision).toBe("approve");
    expect(decide(policy, tool({ approval: "policy", capability: "brand.write" }), agent).decision).toBe("allow");
  });

  it("denies a denied capability for the user too", () => {
    const policy = defaultPolicy();
    policy.permissions["brand.write"] = "deny";
    expect(decide(policy, tool({}), user)).toMatchObject({ decision: "deny", reason: "permission" });
  });

  it("defaults publishing and replies to approval", () => {
    const { permissions } = defaultPolicy();
    expect(permissions["social.publish"]).toBe("approve");
    expect(permissions["social.reply"]).toBe("approve");
    expect(permissions["website.read"]).toBe("allow");
  });
});
