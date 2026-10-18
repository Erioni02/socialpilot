import { ProviderError } from "@socialpilot/core";
import type { GeneratedMedia, ImageEditOptions, ImageGenOptions, ImageProvider } from "./types";

/**
 * Cloudflare Workers AI over REST: POST /accounts/{accountId}/ai/run/{model}.
 * FLUX schnell returns JSON `{ result: { image: <base64> } }`; Stable Diffusion models return raw image bytes.
 */
const DEFAULT_EDIT_MODEL = "@cf/runwayml/stable-diffusion-v1-5-img2img";

function dims(size?: string) {
  if (size === "1024x1536") return { width: 768, height: 1152 };
  if (size === "1536x1024") return { width: 1152, height: 768 };
  return { width: 1024, height: 1024 };
}

export function cloudflareProvider(apiToken: string, accountId: string): ImageProvider & { test(): Promise<string> } {
  if (!accountId) throw new ProviderError("cloudflare", "Cloudflare account ID is missing. Add it next to the API token in Settings → AI providers.");
  const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/`;

  async function run(model: string, input: Record<string, unknown>): Promise<GeneratedMedia> {
    const res = await fetch(base + model, {
      method: "POST",
      headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(180_000),
    });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok) {
      const text = await res.text();
      let msg = text.slice(0, 300);
      try {
        const j = JSON.parse(text);
        msg = (j.errors ?? []).map((e: any) => e.message).join("; ") || msg;
      } catch {
        /* keep text */
      }
      throw new ProviderError("cloudflare", `${msg} (HTTP ${res.status})`, res.status, undefined, res.status === 429 || res.status >= 500);
    }
    if (type.startsWith("image/")) return { data: Buffer.from(await res.arrayBuffer()), mimeType: type.split(";")[0] };
    const j: any = await res.json();
    const b64 = j?.result?.image ?? j?.image;
    if (!b64) throw new ProviderError("cloudflare", "Workers AI returned no image");
    const data = Buffer.from(b64, "base64");
    const mime = data[0] === 0xff ? "image/jpeg" : "image/png";
    return { data, mimeType: mime };
  }

  return {
    id: "cloudflare",
    async test() {
      const res = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", { headers: { authorization: `Bearer ${apiToken}` } });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) throw new ProviderError("cloudflare", j?.errors?.[0]?.message ?? `token rejected (HTTP ${res.status})`, res.status);
      return `Connected — token ${j.result?.status ?? "valid"}`;
    },
    async generate(opts: ImageGenOptions) {
      const out: GeneratedMedia[] = [];
      for (let i = 0; i < (opts.n ?? 1); i++) {
        const input: Record<string, unknown> = opts.model.includes("flux")
          ? { prompt: opts.prompt.slice(0, 2048), steps: 8, seed: Math.floor(Math.random() * 2 ** 31) }
          : { prompt: opts.prompt.slice(0, 2048), ...dims(opts.size), num_steps: 20, seed: Math.floor(Math.random() * 2 ** 31) };
        out.push(await run(opts.model, input));
      }
      return out;
    },
    async edit(opts: ImageEditOptions) {
      const model = opts.model.includes("img2img") || opts.model.includes("inpaint") ? opts.model : DEFAULT_EDIT_MODEL;
      return [await run(model, { prompt: opts.prompt, image_b64: opts.image.data.toString("base64"), strength: 0.6, num_steps: 20 })];
    },
  };
}
