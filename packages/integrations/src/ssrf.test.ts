import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BlockedUrlError, isPublicAddress, safeFetch, type Transport, type TransportResponse } from "./fetcher";

describe("isPublicAddress", () => {
  it.each(["127.0.0.1", "10.1.1.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"])(
    "%s is not public",
    (ip) => expect(isPublicAddress(ip)).toBe(false)
  );
  it.each(["8.8.8.8", "2606:4700::1111"])("%s is public", (ip) => expect(isPublicAddress(ip)).toBe(true));
});

describe("safeFetch", () => {
  let port = 0;
  const server = createServer((_req, res) => res.end("internal"));
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => server.close());

  it("refuses a server on loopback", async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("refuses a hostname that resolves to a private address", async () => {
    const lookup = async () => [{ address: "127.0.0.1", family: 4 }];
    await expect(safeFetch("http://evil.test/", { lookup })).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("re-checks every redirect hop", async () => {
    const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
    const hops: string[] = [];
    const transport: Transport = async (url) => {
      hops.push(url.href);
      return { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" }, body: "", truncated: false };
    };
    await expect(safeFetch("http://ok.test/", { lookup, transport })).rejects.toBeInstanceOf(BlockedUrlError);
    expect(hops).toEqual(["http://ok.test/"]);
  });

  it("follows at most 5 redirects", async () => {
    const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
    let n = 0;
    const transport: Transport = async () => ({ status: 301, headers: { location: `/r${++n}` }, body: "", truncated: false });
    await expect(safeFetch("http://ok.test/", { lookup, transport })).rejects.toThrow(/redirects/);
    expect(n).toBe(6);
  });

  it("pins the checked address for the connection and returns the final response", async () => {
    const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
    const pinned: string[] = [];
    const transport: Transport = async (url, address): Promise<TransportResponse> => {
      pinned.push(address.address);
      return url.pathname === "/"
        ? { status: 302, headers: { location: "/home" }, body: "", truncated: false }
        : { status: 200, headers: { "content-type": "text/html" }, body: "<h1>hi</h1>", truncated: false };
    };
    const res = await safeFetch("http://ok.test/", { lookup, transport });
    expect(res.status).toBe(200);
    expect(res.url).toBe("http://ok.test/home");
    expect(res.redirects).toEqual(["http://ok.test/home"]);
    expect(res.body).toBe("<h1>hi</h1>");
    expect(pinned).toEqual(["93.184.216.34", "93.184.216.34"]);
  });

  it("refuses non-http schemes", async () => {
    await expect(safeFetch("file:///etc/passwd")).rejects.toBeInstanceOf(BlockedUrlError);
  });
});
