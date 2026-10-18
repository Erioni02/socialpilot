import { providerFetch, ProviderError } from "@socialpilot/core";
import type { VideoGenOptions, VideoProvider } from "./types";

/**
 * ByteDance Seedance video generation via BytePlus ModelArk (international) or Volcengine Ark (China).
 * Async task API: POST {base}/contents/generations/tasks → { id }; GET {base}/contents/generations/tasks/{id}
 * → { status: queued|running|succeeded|failed|expired|cancelled, content: { video_url } }.
 */
export const BYTEPLUS_BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Seedance 1.0 (pro, pro-fast, lite) models: settings go in the prompt as commands (--ratio, --duration …). */
export const isSeedanceV1 = (model: string) => /^seedance-1-0/i.test(model);

const firstFrame = (opts: VideoGenOptions) => (opts.imageDataUri ? [{ type: "image_url", image_url: { url: opts.imageDataUri }, role: "first_frame" }] : []);

export function seedanceV1Body(opts: VideoGenOptions) {
  // 1.0 accepts 2–12 s; 1080p for crisp social video. With a first frame, the frame's aspect wins ("adaptive").
  const duration = Math.max(2, Math.min(12, Math.round(opts.durationSec)));
  const ratio = opts.imageDataUri ? "adaptive" : opts.aspect;
  const commands = `--resolution 1080p --ratio ${ratio} --duration ${duration} --camerafixed false --watermark false`;
  return { model: opts.model, content: [{ type: "text", text: `${opts.prompt.trim()} ${commands}` }, ...firstFrame(opts)] };
}

export function seedanceV2Body(opts: VideoGenOptions) {
  return {
    model: opts.model,
    content: [{ type: "text", text: opts.prompt }, ...firstFrame(opts)],
    ratio: opts.aspect,
    duration: Math.max(4, Math.min(12, Math.round(opts.durationSec))),
    resolution: "720p",
    generate_audio: false,
  };
}

export function seedanceProvider(apiKey: string, baseUrl = BYTEPLUS_BASE): VideoProvider & { test(): Promise<string> } {
  const base = baseUrl.replace(/\/$/, "");
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
  return {
    id: "byteplus",
    async test() {
      // An unknown task id with a valid key returns 404; an invalid key returns 401/403.
      try {
        await providerFetch("byteplus", `${base}/contents/generations/tasks/cgt-socialpilot-key-check`, { headers, timeoutMs: 20000 });
        return "Connected";
      } catch (e) {
        const status = (e as ProviderError).status;
        if (status === 404 || status === 400) return "Connected — key accepted";
        throw e;
      }
    },
    async generate(opts: VideoGenOptions) {
      const v1 = isSeedanceV1(opts.model);
      const body = v1 ? seedanceV1Body(opts) : seedanceV2Body(opts);
      const task = await providerFetch<any>("byteplus", `${base}/contents/generations/tasks`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        timeoutMs: 60000,
      });
      if (!task?.id) throw new ProviderError("byteplus", "No task id returned");
      const deadline = Date.now() + 15 * 60_000;
      for (;;) {
        await sleep(6000);
        const t = await providerFetch<any>("byteplus", `${base}/contents/generations/tasks/${encodeURIComponent(task.id)}`, { headers, timeoutMs: 30000 });
        if (t.status === "succeeded") {
          const url = t.content?.video_url;
          if (!url) throw new ProviderError("byteplus", "Task succeeded but returned no video URL");
          const res = await fetch(url);
          if (!res.ok) throw new ProviderError("byteplus", `Could not download video (HTTP ${res.status})`, res.status, undefined, true);
          return { data: Buffer.from(await res.arrayBuffer()), mimeType: "video/mp4", remoteId: task.id };
        }
        if (["failed", "expired", "cancelled"].includes(t.status)) throw new ProviderError("byteplus", `Video task ${t.status}: ${t.error?.message ?? t.error?.code ?? "no details"}`);
        if (Date.now() > deadline) throw new ProviderError("byteplus", `Video task ${task.id} still ${t.status} after 15 minutes`, undefined, undefined, true);
      }
    },
  };
}
