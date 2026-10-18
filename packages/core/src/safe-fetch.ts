import { lookup } from "node:dns/promises";
import net from "node:net";

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v) || v.startsWith("64:ff9b:") || v.startsWith("2001:db8");
  }
  return true;
}

export interface SafeFetchOptions extends Omit<RequestInit, "redirect"> {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Allow non-HTTPS (http) URLs. Defaults to true; private networks are still blocked. */
  allowHttp?: boolean;
}

export interface SafeResponse {
  url: string;
  status: number;
  ok: boolean;
  headers: Headers;
  body: Buffer;
  text(): string;
  json<T = unknown>(): T;
  timingMs: number;
}

export async function assertPublicUrl(raw: string, allowHttp = true): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) throw new SsrfError(`Blocked protocol ${url.protocol}`);
  if (url.username || url.password) throw new SsrfError("Credentials in URLs are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new SsrfError(`Blocked host ${host}`);
  }
  const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length) throw new SsrfError(`Could not resolve ${host}`);
  for (const a of addresses) {
    if (isPrivateIp(a.address)) throw new SsrfError(`Blocked private address for ${host}`);
  }
  return url;
}

export const USER_AGENT = "SocialPilotBot/1.0 (+https://github.com/socialpilot; website analysis on behalf of the site owner)";

/**
 * Fetch for untrusted, user-supplied URLs: validates scheme, resolves DNS and rejects private/reserved ranges on every hop,
 * follows redirects manually, and enforces a timeout and a response size cap.
 */
export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const { timeoutMs = 15000, maxBytes = 5 * 1024 * 1024, maxRedirects = 5, allowHttp = true, ...init } = opts;
  let current = raw;
  const started = Date.now();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicUrl(current, allowHttp);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, ...(init.headers as Record<string, string> | undefined) },
      });
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === "AbortError") throw new Error(`Timed out after ${timeoutMs}ms fetching ${url.href}`);
      throw err;
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      clearTimeout(timer);
      current = new URL(res.headers.get("location")!, url).href;
      continue;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    if (res.body) {
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            controller.abort();
            break;
          }
          chunks.push(Buffer.from(value));
        }
      } catch (err) {
        if (size <= maxBytes) throw err;
      }
    }
    clearTimeout(timer);
    const body = Buffer.concat(chunks);
    return {
      url: url.href,
      status: res.status,
      ok: res.ok,
      headers: res.headers,
      body,
      text: () => body.toString("utf8"),
      json: <T>() => JSON.parse(body.toString("utf8")) as T,
      timingMs: Date.now() - started,
    };
  }
  throw new Error(`Too many redirects for ${raw}`);
}
