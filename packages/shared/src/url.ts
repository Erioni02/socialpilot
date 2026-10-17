import ipaddr from "ipaddr.js";

export class InvalidUrlError extends Error {
  override name = "InvalidUrlError";
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const HOST_WITH_PORT = /^[^:/]+:\d+(\/|$)/;
const INTERNAL_HOST = /(^|\.)(localhost|local|internal|lan|home\.arpa)$/i;

/**
 * Turns what a person types ("vibejudge.app", "https://site.com/pricing") into a crawlable site.
 * Rejects non-web schemes, private/loopback IP literals and internal hostnames.
 */
export function normalizeSiteUrl(input: string): { origin: string; startUrl: string } {
  const raw = input.trim();
  if (!raw) throw new InvalidUrlError("Enter a website URL.");
  const withScheme = SCHEME.test(raw) && !HOST_WITH_PORT.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new InvalidUrlError("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new InvalidUrlError("Only http and https websites are supported.");
  if (url.username || url.password) throw new InvalidUrlError("URLs with credentials are not allowed.");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (ipaddr.isValid(host)) {
    if (!isPublicIp(host)) throw new InvalidUrlError("Private or local addresses can't be analyzed.");
  } else if (!host.includes(".") || INTERNAL_HOST.test(host)) {
    throw new InvalidUrlError("Enter a public website domain, like example.com.");
  }

  url.hash = "";
  return { origin: url.origin, startUrl: url.href };
}

/** True only for globally routable unicast addresses. IPv4-mapped IPv6 is judged as IPv4. */
export function isPublicIp(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  return ipaddr.process(ip).range() === "unicast";
}
