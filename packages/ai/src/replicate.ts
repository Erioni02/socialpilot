import { providerFetch, ProviderError } from "@socialpilot/core";
import type { GeneratedMedia, ImageEditOptions, ImageGenOptions, ImageProvider, VideoGenOptions, VideoProvider } from "./types";

const BASE = "https://api.replicate.com/v1";
const REMOVE_BG_MODEL = "851-labs/background-remover";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function aspectFromSize(size?: string): string {
  if (size === "1024x1536") return "2:3";
  if (size === "1536x1024") return "3:2";
  return "1:1";
}

export function replicateProvider(token: string): ImageProvider & { test(): Promise<string> } {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  /** Runs an official model via POST /models/{owner}/{name}/predictions and polls until it finishes. */
  async function run(model: string, input: Record<string, unknown>, timeoutMs = 600000): Promise<any> {
    let pred = await providerFetch<any>("replicate", `${BASE}/models/${model}/predictions`, {
      method: "POST",
      headers: { ...headers, prefer: "wait=60" },
      body: JSON.stringify({ input }),
      timeoutMs: 90000,
    });
    const deadline = Date.now() + timeoutMs;
    while (!["succeeded", "failed", "canceled"].includes(pred.status)) {
      if (Date.now() > deadline) throw new ProviderError("replicate", `prediction ${pred.id} timed out`, undefined, undefined, true);
      await sleep(3000);
      pred = await providerFetch<any>("replicate", pred.urls?.get ?? `${BASE}/predictions/${pred.id}`, { headers });
    }
    if (pred.status !== "succeeded") throw new ProviderError("replicate", `prediction ${pred.status}: ${pred.error ?? "unknown error"}`);
    return pred;
  }

  async function download(output: unknown, id: string): Promise<GeneratedMedia[]> {
    const urls = (Array.isArray(output) ? output : [output]).filter((u): u is string => typeof u === "string");
    if (!urls.length) throw new ProviderError("replicate", "prediction returned no media output");
    const out: GeneratedMedia[] = [];
    for (const u of urls) {
      const res = await fetch(u);
      if (!res.ok) throw new ProviderError("replicate", `could not download output (${res.status})`);
      out.push({ data: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get("content-type") ?? "application/octet-stream", remoteId: id });
    }
    return out;
  }

  const dataUri = (m: GeneratedMedia) => `data:${m.mimeType};base64,${m.data.toString("base64")}`;

  return {
    id: "replicate",
    async test() {
      const r = await providerFetch<any>("replicate", `${BASE}/account`, { headers });
      return `Connected as ${r.username ?? "account"}`;
    },
    async generate(opts: ImageGenOptions) {
      const results: GeneratedMedia[] = [];
      for (let i = 0; i < (opts.n ?? 1); i++) {
        const pred = await run(opts.model, { prompt: opts.prompt, aspect_ratio: aspectFromSize(opts.size), output_format: "png" });
        results.push(...(await download(pred.output, pred.id)));
      }
      return results;
    },
    async edit(opts: ImageEditOptions) {
      const model = opts.model.includes("kontext") ? opts.model : "black-forest-labs/flux-kontext-pro";
      const pred = await run(model, { prompt: opts.prompt, input_image: dataUri(opts.image), output_format: "png" });
      return download(pred.output, pred.id);
    },
    async removeBackground(image: GeneratedMedia) {
      const pred = await run(REMOVE_BG_MODEL, { image: dataUri(image) });
      return (await download(pred.output, pred.id))[0];
    },
  };
}

export function replicateVideoProvider(token: string): VideoProvider {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  return {
    id: "replicate",
    async generate(opts: VideoGenOptions) {
      const input: Record<string, unknown> = { prompt: opts.prompt };
      if (opts.model.startsWith("kwaivgi/kling")) {
        input.duration = opts.durationSec > 5 ? 10 : 5;
        input.aspect_ratio = opts.aspect;
        if (opts.imageDataUri) input.start_image = opts.imageDataUri;
      } else {
        if (opts.imageDataUri) input.first_frame_image = opts.imageDataUri;
      }
      let pred = await providerFetch<any>("replicate", `${BASE}/models/${opts.model}/predictions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ input }),
      });
      const deadline = Date.now() + 15 * 60_000;
      while (!["succeeded", "failed", "canceled"].includes(pred.status)) {
        if (Date.now() > deadline) throw new ProviderError("replicate", "video generation timed out", undefined, undefined, true);
        await sleep(5000);
        pred = await providerFetch<any>("replicate", pred.urls?.get ?? `${BASE}/predictions/${pred.id}`, { headers });
      }
      if (pred.status !== "succeeded") throw new ProviderError("replicate", `video ${pred.status}: ${pred.error ?? "unknown error"}`);
      const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
      if (typeof url !== "string") throw new ProviderError("replicate", "video prediction returned no file");
      const res = await fetch(url);
      return { data: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get("content-type") ?? "video/mp4", remoteId: pred.id };
    },
  };
}
