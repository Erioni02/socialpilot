import type { SocialPlatform } from "@socialpilot/shared";
import { instagramAdapter } from "./instagram";
import { tiktokAdapter } from "./tiktok";
import { xAdapter } from "./x";
import type { SocialAdapter } from "./types";

export * from "./types";
export { instagramAdapter, tiktokAdapter, xAdapter };

export const SOCIAL_ADAPTERS: Record<SocialPlatform, SocialAdapter> = {
  instagram: instagramAdapter,
  tiktok: tiktokAdapter,
  x: xAdapter,
};

export function socialAdapter(platform: string): SocialAdapter {
  const a = SOCIAL_ADAPTERS[platform as SocialPlatform];
  if (!a) throw new Error(`Unknown social platform: ${platform}`);
  return a;
}

/** Parses a public profile URL into platform + handle. A public URL never grants API access. */
export function parseProfileUrl(raw: string): { platform: SocialPlatform; handle: string; url: string } | null {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const seg = u.pathname.split("/").filter(Boolean);
  if (host === "instagram.com" && seg[0] && !["p", "reel", "explore", "stories"].includes(seg[0])) {
    return { platform: "instagram", handle: seg[0], url: `https://www.instagram.com/${seg[0]}/` };
  }
  if (host === "tiktok.com" && seg[0]?.startsWith("@")) {
    return { platform: "tiktok", handle: seg[0].slice(1), url: `https://www.tiktok.com/${seg[0]}` };
  }
  if ((host === "x.com" || host === "twitter.com") && seg[0] && !["i", "home", "search", "intent"].includes(seg[0])) {
    return { platform: "x", handle: seg[0], url: `https://x.com/${seg[0]}` };
  }
  return null;
}
