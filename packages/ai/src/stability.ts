import { ProviderError } from "@socialpilot/core";
import type { GeneratedMedia, ImageGenOptions, ImageProvider } from "./types";

const BASE = "https://api.stability.ai/v2beta/stable-image";

function aspect(size?: string) {
  if (size === "1024x1536") return "2:3";
  if (size === "1536x1024") return "3:2";
  return "1:1";
}

export function stabilityProvider(apiKey: string): ImageProvider & { test(): Promise<string> } {
  async function post(path: string, form: FormData): Promise<GeneratedMedia> {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, accept: "image/*" },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text();
      let msg = text.slice(0, 300);
      try {
        const j = JSON.parse(text);
        msg = (j.errors ?? [j.message ?? j.name]).join("; ");
      } catch {
        /* keep text */
      }
      throw new ProviderError("stability", `${msg} (HTTP ${res.status})`, res.status, undefined, res.status >= 500 || res.status === 429);
    }
    return { data: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get("content-type") ?? "image/png" };
  }
  return {
    id: "stability",
    async test() {
      const res = await fetch("https://api.stability.ai/v1/user/balance", { headers: { authorization: `Bearer ${apiKey}` } });
      if (!res.ok) throw new ProviderError("stability", `key rejected (HTTP ${res.status})`, res.status);
      const j: any = await res.json();
      return `Connected — balance ${j.credits ?? "?"} credits`;
    },
    async generate(opts: ImageGenOptions) {
      const endpoint = opts.model === "stable-image-ultra" ? "/generate/ultra" : "/generate/core";
      const out: GeneratedMedia[] = [];
      for (let i = 0; i < (opts.n ?? 1); i++) {
        const form = new FormData();
        form.append("prompt", opts.prompt);
        form.append("aspect_ratio", aspect(opts.size));
        form.append("output_format", "png");
        out.push(await post(endpoint, form));
      }
      return out;
    },
    async removeBackground(image: GeneratedMedia) {
      const form = new FormData();
      form.append("image", new Blob([new Uint8Array(image.data)], { type: image.mimeType }), "image.png");
      form.append("output_format", "png");
      return post("/edit/remove-background", form);
    },
  };
}
