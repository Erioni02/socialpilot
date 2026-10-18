import { providerFetch, ProviderError } from "@socialpilot/core";
import type { GeneratedMedia, ImageEditOptions, ImageGenOptions, ImageProvider } from "./types";
import { BYTEPLUS_BASE } from "./seedance";

/**
 * ByteDance Seedream image generation and editing via BytePlus ModelArk.
 * Synchronous: POST {base}/images/generations { model, prompt, size, image?, response_format, watermark } → { data: [{ b64_json | url }] }.
 * Edits pass the source image as a data URI in `image` (Seedream uses it as the reference to edit).
 */

/** Seedream works at ~2K and above; map our aspect choices to sizes inside its accepted pixel range. */
const SIZE: Record<NonNullable<ImageGenOptions["size"]>, string> = {
  "1024x1024": "2048x2048",
  "1024x1536": "1664x2496",
  "1536x1024": "2496x1664",
};

const mimeOf = (b: Buffer) => (b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg" : b[0] === 0x89 && b[1] === 0x50 ? "image/png" : b.subarray(8, 12).toString() === "WEBP" ? "image/webp" : "image/jpeg");

export function seedreamProvider(apiKey: string, baseUrl = BYTEPLUS_BASE): ImageProvider {
  const base = baseUrl.replace(/\/$/, "");
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };

  async function once(body: Record<string, unknown>): Promise<GeneratedMedia> {
    const r = await providerFetch<any>("byteplus", `${base}/images/generations`, {
      method: "POST",
      headers,
      body: JSON.stringify({ response_format: "b64_json", watermark: false, ...body }),
      timeoutMs: 180_000,
    });
    const item = r?.data?.[0];
    if (item?.b64_json) {
      const data = Buffer.from(item.b64_json, "base64");
      return { data, mimeType: mimeOf(data), remoteId: r.id };
    }
    if (item?.url) {
      const res = await fetch(item.url);
      if (!res.ok) throw new ProviderError("byteplus", `Could not download generated image (HTTP ${res.status})`, res.status, undefined, true);
      const data = Buffer.from(await res.arrayBuffer());
      return { data, mimeType: res.headers.get("content-type")?.split(";")[0] || mimeOf(data) };
    }
    throw new ProviderError("byteplus", r?.error?.message ?? "Seedream returned no image");
  }

  return {
    id: "byteplus",
    async generate(opts: ImageGenOptions) {
      const out: GeneratedMedia[] = [];
      for (let i = 0; i < (opts.n ?? 1); i++) out.push(await once({ model: opts.model, prompt: opts.prompt, size: SIZE[opts.size ?? "1024x1024"] }));
      return out;
    },
    async edit(opts: ImageEditOptions) {
      const image = `data:${opts.image.mimeType};base64,${opts.image.data.toString("base64")}`;
      return [await once({ model: opts.model, prompt: opts.prompt, image, size: SIZE[opts.size ?? "1024x1024"] })];
    },
  };
}
