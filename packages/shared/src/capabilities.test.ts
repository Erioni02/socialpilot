import { describe, expect, it } from "vitest";
import { CAPABILITIES, READ_ONLY_CAPABILITIES } from "./capabilities";

describe("capabilities", () => {
  it("lists the 15 spec capabilities", () => {
    expect(CAPABILITIES).toContain("social.publish");
    expect(CAPABILITIES).toHaveLength(15);
  });
  it("marks only read capabilities as read-only", () => {
    expect(READ_ONLY_CAPABILITIES.has("website.read")).toBe(true);
    expect(READ_ONLY_CAPABILITIES.has("brand.write")).toBe(false);
  });
});
