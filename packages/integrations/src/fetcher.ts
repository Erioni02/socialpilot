import { lookup as dnsLookup } from "node:dns/promises";
import { Agent, request } from "undici";
import { isPublicAddress } from "./ssrf";

export { isPublicAddress };

export class BlockedUrlError extends Error {
  override name = "BlockedUrlError";
}
export class FetchError extends Error {
  override name = "FetchError";
}

export type ResolvedAddress = { address: string; family: number };
export type Lookup = (hostname: string) => Promise<ResolvedAddress[]>;
export type TransportResponse = { status: number; headers: Record<string, string>; body: string; truncated: boolean };
export type Transport = (
  url: URL,
  address: ResolvedAddress,
  opts: { method: "GET" | "HEAD"; maxBytes: number; signal: AbortSignal; accept: string }
) => Promise<TransportResponse>;

export type SafeFetchOptions = {
  method?: "GET" | "HEAD";
  maxBytes?: number;
  timeoutMs?: number;
  accept?: string;
  lookup?: Lookup;
  transport?: Transport;
};

export type SafeFetchResult = {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  responseMs: number;
  redirects: string[];
};

export const USER_AGENT = "SocialPilotBot/0.1 (+https://socialpilot.local/bot)";
const MAX_REDIRECTS = 5;

const defaultLookup: Lookup = (hostname) => dnsLookup(hostname, { all: true });

/** Connects to exactly the address we validated, so DNS can't be swapped between check and connect. */
const undiciTransport: Transport = async (url, address, { method, maxBytes, signal, accept }) => {
  const dispatcher = new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        if ((options as { all?: boolean }).all) callback(null, [address] as never);
        else callback(null, address.address, address.family);
      }
    }
  });
  try {
    const res = await request(url, {
      method,
      dispatcher,
      signal,
      headers: { "user-agent": USER_AGENT, accept }
    });
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(", ") : v;

    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    for await (const chunk of res.body) {
      const buf = Buffer.from(chunk as Uint8Array);
      if (size + buf.length > maxBytes) {
        chunks.push(buf.subarray(0, maxBytes - size));
        truncated = true;
        res.body.destroy();
        break;
      }
      chunks.push(buf);
      size += buf.length;
    }
    return { status: res.statusCode, headers, body: Buffer.concat(chunks).toString("utf8"), truncated };
  } finally {
    void dispatcher.close();
  }
};

async function resolvePublic(url: URL, lookup: Lookup): Promise<ResolvedAddress> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedUrlError(`Blocked scheme ${url.protocol}`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: ResolvedAddress[];
  try {
    addresses = /^[\d.]+$|:/.test(host) ? [{ address: host, family: host.includes(":") ? 6 : 4 }] : await lookup(host);
  } catch (error) {
    throw new FetchError(`DNS lookup failed for ${host}: ${(error as Error).message}`);
  }
  if (!addresses.length) throw new FetchError(`No addresses for ${host}`);
  const blocked = addresses.find((a) => !isPublicAddress(a.address));
  if (blocked) throw new BlockedUrlError(`${host} resolves to a non-public address (${blocked.address})`);
  return addresses[0]!;
}

/**
 * Fetches a public URL with SSRF protection: http(s) only, every hop resolved and checked against
 * private/loopback/link-local/metadata ranges, the checked IP pinned for the connection,
 * at most 5 redirects, a timeout and a body size cap.
 */
export async function safeFetch(input: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const { method = "GET", maxBytes = 3 * 1024 * 1024, timeoutMs = 10_000, accept = "text/html,application/xhtml+xml,*/*;q=0.8" } = opts;
  const lookup = opts.lookup ?? defaultLookup;
  const transport = opts.transport ?? undiciTransport;
  const started = Date.now();
  const signal = AbortSignal.timeout(timeoutMs);
  const redirects: string[] = [];

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new BlockedUrlError(`Invalid URL: ${input}`);
  }

  for (let hop = 0; ; hop++) {
    const address = await resolvePublic(url, lookup);
    let res: TransportResponse;
    try {
      res = await transport(url, address, { method, maxBytes, signal, accept });
    } catch (error) {
      if (signal.aborted) throw new FetchError(`Timed out after ${timeoutMs} ms fetching ${url.href}`);
      throw new FetchError(`Request to ${url.href} failed: ${(error as Error).message}`);
    }
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= MAX_REDIRECTS) throw new FetchError(`Too many redirects (more than ${MAX_REDIRECTS})`);
      url = new URL(location, url);
      redirects.push(url.href);
      continue;
    }
    return { url: url.href, status: res.status, headers: res.headers, body: res.body, responseMs: Date.now() - started, redirects };
  }
}
