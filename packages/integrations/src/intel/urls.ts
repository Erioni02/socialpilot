import { safeFetch } from "@socialpilot/core";

export type IntelPlatform = "tiktok" | "instagram" | "x";
export type IntelKind = "profile" | "post";

export interface ParsedSocialUrl {
  platform: IntelPlatform;
  kind: IntelKind;
  /** Post id for posts, lowercase handle for profiles. */
  externalId: string;
  handle?: string;
  /** Canonical public URL. */
  url: string;
  /** Instagram post subtype or TikTok post type when known. */
  subtype?: "reel" | "post" | "video" | "photo" | "status";
}

export class SocialUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocialUrlError";
  }
}

const HANDLE = /^[A-Za-z0-9._]{1,30}$/;
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const X_RESERVED = new Set(["i", "home", "search", "explore", "notifications", "messages", "settings", "intent", "share", "hashtag", "compose", "login", "signup", "tos", "privacy"]);
const IG_RESERVED = new Set(["explore", "accounts", "direct", "stories", "about", "legal", "developer", "web", "challenge", "graphql", "api", "tv"]);

/**
 * Detects platform + URL type and validates it. Pure function (no network) — short links are handled by resolveShortUrl.
 */
export function parseSocialUrl(raw: string): ParsedSocialUrl {
  const input = raw.trim();
  if (!input) throw new SocialUrlError("Enter a TikTok, Instagram or X URL.");
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new SocialUrlError("That doesn't look like a URL.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new SocialUrlError("Only http(s) URLs are supported.");
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|mobile\.)/, "");
  const seg = u.pathname.split("/").filter(Boolean);

  if (host === "tiktok.com") {
    const at = seg[0];
    if (!at?.startsWith("@")) throw new SocialUrlError("TikTok URLs must look like tiktok.com/@user or tiktok.com/@user/video/123.");
    const handle = at.slice(1).toLowerCase();
    if (!HANDLE.test(handle)) throw new SocialUrlError("Invalid TikTok username.");
    if ((seg[1] === "video" || seg[1] === "photo") && seg[2]) {
      if (!/^\d{8,25}$/.test(seg[2])) throw new SocialUrlError("Invalid TikTok video id.");
      return { platform: "tiktok", kind: "post", externalId: seg[2], handle, url: `https://www.tiktok.com/@${handle}/${seg[1]}/${seg[2]}`, subtype: seg[1] === "photo" ? "photo" : "video" };
    }
    if (seg.length > 1) throw new SocialUrlError("Unsupported TikTok URL. Use a profile or video link.");
    return { platform: "tiktok", kind: "profile", externalId: handle, handle, url: `https://www.tiktok.com/@${handle}` };
  }

  if (host === "instagram.com" || host === "instagr.am") {
    if (!seg[0]) throw new SocialUrlError("Add a profile, post or Reel to the Instagram URL.");
    const type = seg[0].toLowerCase();
    if (["p", "reel", "reels", "tv"].includes(type)) {
      const code = seg[1];
      if (!code || !/^[A-Za-z0-9_-]{5,40}$/.test(code)) throw new SocialUrlError("Invalid Instagram post code.");
      const subtype = type === "p" ? "post" : "reel";
      return { platform: "instagram", kind: "post", externalId: code, url: `https://www.instagram.com/${type === "p" ? "p" : "reel"}/${code}/`, subtype };
    }
    if (seg[1] && ["p", "reel"].includes(seg[1])) {
      // instagram.com/<user>/p/<code>/ and /<user>/reel/<code>/ variants
      const code = seg[2];
      if (!code || !/^[A-Za-z0-9_-]{5,40}$/.test(code)) throw new SocialUrlError("Invalid Instagram post code.");
      return { platform: "instagram", kind: "post", externalId: code, handle: seg[0].toLowerCase(), url: `https://www.instagram.com/${seg[1]}/${code}/`, subtype: seg[1] === "p" ? "post" : "reel" };
    }
    const handle = seg[0].toLowerCase();
    if (IG_RESERVED.has(handle) || !HANDLE.test(handle)) throw new SocialUrlError("Unsupported Instagram URL. Use a profile, post or Reel link.");
    return { platform: "instagram", kind: "profile", externalId: handle, handle, url: `https://www.instagram.com/${handle}/` };
  }

  if (host === "x.com" || host === "twitter.com") {
    const handle = seg[0];
    if (!handle || X_RESERVED.has(handle.toLowerCase())) {
      if (handle === "i" && seg[1] === "web" && seg[2] === "status" && /^\d{1,25}$/.test(seg[3] ?? "")) {
        return { platform: "x", kind: "post", externalId: seg[3], url: `https://x.com/i/web/status/${seg[3]}`, subtype: "status" };
      }
      throw new SocialUrlError("Use an X profile (x.com/user) or post (x.com/user/status/123) URL.");
    }
    if (!X_HANDLE.test(handle)) throw new SocialUrlError("Invalid X username.");
    if (seg[1] === "status" && seg[2]) {
      if (!/^\d{1,25}$/.test(seg[2])) throw new SocialUrlError("Invalid X post id.");
      return { platform: "x", kind: "post", externalId: seg[2], handle: handle.toLowerCase(), url: `https://x.com/${handle}/status/${seg[2]}`, subtype: "status" };
    }
    if (seg.length > 1) throw new SocialUrlError("Unsupported X URL. Use a profile or post link.");
    return { platform: "x", kind: "profile", externalId: handle.toLowerCase(), handle: handle.toLowerCase(), url: `https://x.com/${handle}` };
  }

  throw new SocialUrlError("Only TikTok, Instagram and X URLs are supported.");
}

const SHORT_HOSTS = new Set(["vm.tiktok.com", "vt.tiktok.com", "t.co"]);

/** Resolves official short links (vm.tiktok.com, t.co) by following redirects (SSRF-safe), then parses. */
export async function resolveAndParse(raw: string): Promise<ParsedSocialUrl> {
  let host = "";
  try {
    host = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`).hostname.toLowerCase();
  } catch {
    /* parse below reports the error */
  }
  if (SHORT_HOSTS.has(host)) {
    const r = await safeFetch(raw.trim(), { timeoutMs: 10000, maxBytes: 200_000, method: "GET" });
    return parseSocialUrl(r.url);
  }
  return parseSocialUrl(raw);
}
