import sharp from "sharp";
import { prisma, Prisma, type Asset, type AssetVersion, type Project } from "@socialpilot/db";
import { badRequest, notFound } from "@socialpilot/core";
import type { GeneratedMedia } from "@socialpilot/ai";
import { estimateUnitCost, normalizePolicy, type Brand, type ImageOp, type VideoOp } from "@socialpilot/shared";
import { getObject, newKey, putObject } from "../infra/storage";
import { emit } from "../infra/events";
import { checkBudget, recordUsage, resolveImageAI, resolveTranscriptionAI, resolveVideoAI, type AiCallContext } from "../ai/service";
import * as ff from "./ffmpeg";

export const ALLOWED_UPLOAD_TYPES: Record<string, "image" | "video" | "audio" | "document"> = {
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
  "image/gif": "image",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
  "audio/mpeg": "audio",
  "audio/wav": "audio",
  "text/plain": "document",
  "text/markdown": "document",
  "application/json": "document",
  "application/x-subrip": "document",
};

/** Validates by magic bytes, not just the declared mime type. */
export function sniffMime(buf: Buffer, declared: string): string | null {
  const b = buf.subarray(0, 16);
  if (b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG") return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (b.toString("ascii", 0, 3) === "GIF") return "image/gif";
  if (b.toString("ascii", 4, 8) === "ftyp") return b.toString("ascii", 8, 10) === "qt" ? "video/quicktime" : "video/mp4";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  if (b.toString("ascii", 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WAVE") return "audio/wav";
  if (["text/plain", "text/markdown", "application/json", "application/x-subrip"].includes(declared)) {
    return buf.subarray(0, 4096).includes(0) ? null : declared;
  }
  return null;
}

async function mediaMeta(data: Buffer, mimeType: string) {
  if (mimeType.startsWith("image/")) {
    const m = await sharp(data).metadata();
    return { width: m.width ?? null, height: m.height ?? null, durationSec: null };
  }
  if (mimeType.startsWith("video/")) {
    try {
      const p = await ff.probeBuffer(data, mimeType === "video/webm" ? "webm" : "mp4");
      return { width: p.width, height: p.height, durationSec: p.durationSec };
    } catch {
      return { width: null, height: null, durationSec: null };
    }
  }
  return { width: null, height: null, durationSec: null };
}

export interface VersionMeta {
  operation: string;
  params?: Record<string, unknown>;
  provider?: string;
  model?: string;
  prompt?: string;
  costUsd?: number;
  createdBy?: string;
}

export async function addVersion(asset: Asset, data: Buffer, mimeType: string, meta: VersionMeta): Promise<AssetVersion> {
  const key = newKey(asset.projectId, mimeType);
  await putObject(key, data);
  const m = await mediaMeta(data, mimeType);
  const last = await prisma.assetVersion.findFirst({ where: { assetId: asset.id }, orderBy: { version: "desc" } });
  const version = await prisma.assetVersion.create({
    data: {
      assetId: asset.id,
      version: (last?.version ?? 0) + 1,
      storageKey: key,
      mimeType,
      sizeBytes: data.length,
      width: m.width,
      height: m.height,
      durationSec: m.durationSec,
      operation: meta.operation,
      params: (meta.params ?? {}) as Prisma.InputJsonValue,
      provider: meta.provider,
      model: meta.model,
      prompt: meta.prompt,
      costUsd: meta.costUsd ?? 0,
      createdBy: meta.createdBy ?? "user",
    },
  });
  await prisma.asset.update({ where: { id: asset.id }, data: { currentVersionId: version.id, status: "ready", error: null, kind: mimeType.startsWith("video/") ? "video" : mimeType.startsWith("image/") ? "image" : asset.kind } });
  await emit({ type: "asset.updated", projectId: asset.projectId, data: { id: asset.id, versionId: version.id } });
  return version;
}

export async function createAsset(
  projectId: string,
  info: { name: string; kind: string; folder?: string; campaignId?: string | null; source: string; createdBy?: string; tags?: string[] },
  data: Buffer,
  mimeType: string,
  meta: VersionMeta,
) {
  const asset = await prisma.asset.create({
    data: {
      projectId,
      name: info.name.slice(0, 200),
      kind: info.kind,
      folder: normalizeFolder(info.folder),
      campaignId: info.campaignId ?? null,
      source: info.source,
      createdBy: info.createdBy ?? "user",
      tags: info.tags ?? [],
      status: "processing",
    },
  });
  const version = await addVersion(asset, data, mimeType, meta);
  return { asset: { ...asset, currentVersionId: version.id, status: "ready" }, version };
}

export function normalizeFolder(folder?: string) {
  const f = ("/" + (folder ?? "/").replace(/\\/g, "/").split("/").filter((s) => s && s !== "." && s !== "..").join("/")).slice(0, 200);
  return f || "/";
}

export async function currentVersion(assetId: string): Promise<{ asset: Asset; version: AssetVersion }> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset || !asset.currentVersionId) throw notFound("Asset");
  const version = await prisma.assetVersion.findUniqueOrThrow({ where: { id: asset.currentVersionId } });
  return { asset, version };
}

export async function loadAsset(assetId: string): Promise<{ asset: Asset; version: AssetVersion; data: Buffer }> {
  const { asset, version } = await currentVersion(assetId);
  return { asset, version, data: await getObject(version.storageKey) };
}

export async function restoreVersion(assetId: string, versionId: string, createdBy = "user") {
  const v = await prisma.assetVersion.findFirst({ where: { id: versionId, assetId } });
  if (!v) throw notFound("Version");
  const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
  const data = await getObject(v.storageKey);
  return addVersion(asset, data, v.mimeType, { operation: "restore", params: { fromVersion: v.version }, createdBy });
}

// ───────────── Images ─────────────

const PRESETS: Record<string, [number, number]> = {
  instagram_square: [1080, 1080],
  instagram_portrait: [1080, 1350],
  story_9_16: [1080, 1920],
  tiktok_9_16: [1080, 1920],
  x_landscape: [1600, 900],
};

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > maxChars) {
      if (line) lines.push(line);
      line = w;
    } else line = (line + " " + w).trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 6);
}

async function brandImage(data: Buffer, op: Extract<ImageOp, { op: "brand" }>, brand: Brand): Promise<Buffer> {
  let img = sharp(data).rotate();
  const meta = await img.metadata();
  const W = meta.width ?? 1080;
  const H = meta.height ?? 1080;
  const color = op.color ?? brand.colors?.[0] ?? "#111111";
  const composites: sharp.OverlayOptions[] = [];
  if (op.overlayText) {
    const fontSize = Math.round(W / 18);
    const lines = wrapText(op.overlayText, Math.max(12, Math.round(W / (fontSize * 0.55))));
    const boxH = Math.round(lines.length * fontSize * 1.3 + fontSize * 1.2);
    const y = op.textPosition === "top" ? 0 : op.textPosition === "center" ? Math.round((H - boxH) / 2) : H - boxH;
    const font = brand.fonts?.[0] ? `${escapeXml(brand.fonts[0])}, Arial, sans-serif` : "Arial, Helvetica, sans-serif";
    const svg = `<svg width="${W}" height="${boxH}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${escapeXml(color)}" fill-opacity="0.82"/>
      ${lines
        .map((l, i) => `<text x="50%" y="${Math.round(fontSize * 1.1 + i * fontSize * 1.3)}" font-family="${font}" font-size="${fontSize}" font-weight="700" fill="#ffffff" text-anchor="middle">${escapeXml(l)}</text>`)
        .join("")}
    </svg>`;
    composites.push({ input: Buffer.from(svg), top: Math.max(0, y), left: 0 });
  }
  if (op.logoAssetId) {
    const logo = await loadAsset(op.logoAssetId);
    const size = Math.round(W * 0.14);
    const logoBuf = await sharp(logo.data).resize(size, size, { fit: "inside" }).png().toBuffer();
    composites.push({ input: logoBuf, top: Math.round(H * 0.04), left: W - size - Math.round(W * 0.04) });
  }
  if (composites.length) img = sharp(await img.composite(composites).png().toBuffer());
  if (op.border > 0) img = img.extend({ top: op.border, bottom: op.border, left: op.border, right: op.border, background: color });
  return img.png().toBuffer();
}

export interface OpContext extends AiCallContext {
  project: Project;
  createdBy: string;
}

/** Applies a real image operation and saves the output as a new asset version (or new assets for variations). */
export async function applyImageOp(ctx: OpContext, assetId: string, op: ImageOp) {
  const { asset, version, data } = await loadAsset(assetId);
  if (asset.projectId !== ctx.project.id) throw notFound("Asset");
  if (!version.mimeType.startsWith("image/")) throw badRequest("This operation needs an image asset");
  const brand = (ctx.project.brand ?? {}) as Brand;
  const save = (buf: Buffer, mime: string, meta: Partial<VersionMeta> = {}) =>
    addVersion(asset, buf, mime, { operation: op.op, params: op as Record<string, unknown>, createdBy: ctx.createdBy, ...meta });

  switch (op.op) {
    case "crop": {
      const m = await sharp(data).metadata();
      if (op.left + op.width > (m.width ?? 0) || op.top + op.height > (m.height ?? 0)) throw badRequest(`Crop area exceeds the image (${m.width}×${m.height})`);
      return { versions: [await save(await sharp(data).extract({ left: op.left, top: op.top, width: op.width, height: op.height }).png().toBuffer(), "image/png")] };
    }
    case "resize":
      return { versions: [await save(await sharp(data).resize(op.width, op.height, { fit: op.fit }).png().toBuffer(), "image/png")] };
    case "preset": {
      const [w, h] = PRESETS[op.preset];
      return { versions: [await save(await sharp(data).resize(w, h, { fit: "cover", position: "attention" }).jpeg({ quality: 92 }).toBuffer(), "image/jpeg")] };
    }
    case "format": {
      const s = sharp(data);
      const buf = op.format === "jpeg" ? await s.jpeg({ quality: op.quality }).toBuffer() : op.format === "webp" ? await s.webp({ quality: op.quality }).toBuffer() : await s.png().toBuffer();
      return { versions: [await save(buf, `image/${op.format}`)] };
    }
    case "brand":
      return { versions: [await save(await brandImage(data, op, brand), "image/png")] };
    case "ai_edit": {
      const ai = await resolveImageAI(ctx.userId, ctx.project, op.provider, "edit");
      const model = op.model ?? (ai.providerId === "openai" ? "gpt-image-1" : "black-forest-labs/flux-kontext-pro");
      const cost = estimateUnitCost(model);
      await checkBudget(ctx, cost);
      const png = await sharp(data).png().toBuffer();
      const out = await ai.provider.edit!({ model, prompt: op.instruction, image: { data: png, mimeType: "image/png" } });
      if (!out.length || !out[0].data.length) throw new Error("The provider returned no edited image");
      await recordUsage(ctx, { provider: ai.providerId, model, kind: "image", units: 1, costUsd: cost });
      return { versions: [await save(out[0].data, normalizeImageMime(out[0].mimeType), { provider: ai.providerId, model, prompt: op.instruction, costUsd: cost })] };
    }
    case "remove_background": {
      const ai = await resolveImageAI(ctx.userId, ctx.project, op.provider, "remove_background");
      const model = ai.providerId === "stability" ? "stability-remove-background" : "replicate-remove-background";
      const cost = estimateUnitCost(model);
      await checkBudget(ctx, cost);
      const out = await ai.provider.removeBackground!({ data: await sharp(data).png().toBuffer(), mimeType: "image/png" });
      await recordUsage(ctx, { provider: ai.providerId, model, kind: "image", units: 1, costUsd: cost });
      return { versions: [await save(out.data, normalizeImageMime(out.mimeType), { provider: ai.providerId, model, costUsd: cost })] };
    }
    case "variations": {
      const ai = await resolveImageAI(ctx.userId, ctx.project, undefined, "edit");
      const model = ai.providerId === "openai" ? "gpt-image-1" : "black-forest-labs/flux-kontext-pro";
      const created = [];
      for (let i = 0; i < op.n; i++) {
        const cost = estimateUnitCost(model);
        await checkBudget(ctx, cost);
        const prompt = `Create a fresh variation of this image for a social media campaign, keeping the same subject and brand style. ${op.instruction ?? ""}`.trim();
        const out = await ai.provider.edit!({ model, prompt, image: { data: await sharp(data).png().toBuffer(), mimeType: "image/png" } });
        await recordUsage(ctx, { provider: ai.providerId, model, kind: "image", units: 1, costUsd: cost });
        const r = await createAsset(
          ctx.project.id,
          { name: `${asset.name} — variation ${i + 1}`, kind: "image", folder: asset.folder, campaignId: asset.campaignId, source: "generated", createdBy: ctx.createdBy },
          out[0].data,
          normalizeImageMime(out[0].mimeType),
          { operation: "variation", params: { sourceAssetId: asset.id, sourceVersion: version.version }, provider: ai.providerId, model, prompt, costUsd: cost, createdBy: ctx.createdBy },
        );
        created.push(r.asset);
      }
      return { versions: [], createdAssets: created };
    }
  }
}

function normalizeImageMime(m: string) {
  return m.startsWith("image/") ? m.split(";")[0] : "image/png";
}

function brandPromptSuffix(project: Project): string {
  const b = (project.brand ?? {}) as Brand;
  const bits = [];
  if (b.colors?.length) bits.push(`brand colors ${b.colors.slice(0, 4).join(", ")}`);
  if (b.tone?.length) bits.push(`tone: ${b.tone.slice(0, 4).join(", ")}`);
  return bits.length ? ` Style guidance: ${bits.join("; ")}.` : "";
}

export async function generateImages(
  ctx: OpContext,
  input: { prompt: string; size?: "1024x1024" | "1024x1536" | "1536x1024"; n?: number; folder?: string; campaignId?: string | null; provider?: string; model?: string; name?: string; applyBrandStyle?: boolean },
) {
  const ai = await resolveImageAI(ctx.userId, ctx.project, input.provider);
  const model = input.model ?? ai.model;
  const n = input.n ?? 1;
  const cost = estimateUnitCost(model, n);
  await checkBudget(ctx, cost);
  const prompt = input.prompt + (input.applyBrandStyle !== false ? brandPromptSuffix(ctx.project) : "");
  const out: GeneratedMedia[] = await ai.provider.generate({ model, prompt, size: input.size ?? "1024x1024", n });
  const real = out.filter((o) => o.data.length > 0);
  if (!real.length) throw new Error("The image provider returned no image data — nothing was saved.");
  await recordUsage(ctx, { provider: ai.providerId, model, kind: "image", units: real.length, costUsd: estimateUnitCost(model, real.length) });
  const assets = [];
  for (let i = 0; i < real.length; i++) {
    const r = await createAsset(
      ctx.project.id,
      { name: input.name ?? input.prompt.slice(0, 60) + (real.length > 1 ? ` (${i + 1})` : ""), kind: "image", folder: input.folder, campaignId: input.campaignId, source: "generated", createdBy: ctx.createdBy },
      real[i].data,
      normalizeImageMime(real[i].mimeType),
      { operation: "generate", params: { size: input.size, userPrompt: input.prompt }, provider: ai.providerId, model, prompt, costUsd: estimateUnitCost(model), createdBy: ctx.createdBy },
    );
    assets.push(r.asset);
  }
  return assets;
}

export async function generateVideo(
  ctx: OpContext,
  input: { prompt: string; aspect: "9:16" | "16:9" | "1:1"; durationSec: number; imageAssetId?: string; folder?: string; campaignId?: string | null; model?: string; assetId?: string },
) {
  const ai = await resolveVideoAI(ctx.userId, ctx.project);
  const model = input.model ?? ai.model;
  const cost = estimateUnitCost(model);
  await checkBudget(ctx, cost);
  let imageDataUri: string | undefined;
  if (input.imageAssetId) {
    const img = await loadAsset(input.imageAssetId);
    imageDataUri = `data:${img.version.mimeType};base64,${img.data.toString("base64")}`;
  }
  const out = await ai.provider.generate({ model, prompt: input.prompt, aspect: input.aspect, durationSec: input.durationSec, imageDataUri });
  if (!out.data.length) throw new Error("The video provider returned no video data — nothing was saved.");
  await recordUsage(ctx, { provider: ai.providerId, model, kind: "video", units: 1, costUsd: cost });
  const mime = out.mimeType.startsWith("video/") ? out.mimeType.split(";")[0] : "video/mp4";
  const meta = { operation: "generate", params: { aspect: input.aspect, durationSec: input.durationSec, imageAssetId: input.imageAssetId }, provider: ai.providerId, model, prompt: input.prompt, costUsd: cost, createdBy: ctx.createdBy };
  if (input.assetId) {
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: input.assetId } });
    await addVersion(asset, out.data, mime, meta);
    return prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
  }
  const r = await createAsset(ctx.project.id, { name: input.prompt.slice(0, 60), kind: "video", folder: input.folder, campaignId: input.campaignId, source: "generated", createdBy: ctx.createdBy }, out.data, mime, meta);
  return r.asset;
}

/** Real FFmpeg operations; output saved as a new version (concat/thumbnail create new assets). */
export async function applyVideoOp(ctx: OpContext, assetId: string, op: VideoOp) {
  const { asset, version, data } = await loadAsset(assetId);
  if (asset.projectId !== ctx.project.id) throw notFound("Asset");
  if (!version.mimeType.startsWith("video/")) throw badRequest("This operation needs a video asset");
  const save = (buf: Buffer, meta: Partial<VersionMeta> = {}) => addVersion(asset, buf, "video/mp4", { operation: op.op, params: op as Record<string, unknown>, createdBy: ctx.createdBy, ...meta });
  switch (op.op) {
    case "trim":
      if (op.end <= op.start) throw badRequest("End must be after start");
      return { versions: [await save(await ff.trimVideo(data, op.start, op.end))] };
    case "aspect":
      return { versions: [await save(await ff.reframeVideo(data, op.aspect, op.mode))] };
    case "compress":
      return { versions: [await save(await ff.compressVideo(data, op.crf))] };
    case "subtitles": {
      let srt = op.srt;
      let costUsd = 0;
      if (!srt && op.autoTranscribe) {
        const ai = await resolveTranscriptionAI(ctx.userId);
        const minutes = Math.max(1, Math.ceil((version.durationSec ?? 60) / 60));
        costUsd = estimateUnitCost("whisper-1", minutes);
        await checkBudget(ctx, costUsd);
        srt = await ai.provider.transcribeToSrt(await ff.extractAudio(data), "audio.mp3", ai.model);
        await recordUsage(ctx, { provider: ai.providerId, model: ai.model, kind: "transcription", units: minutes, costUsd });
      }
      if (!srt?.trim()) throw badRequest("Provide SRT subtitles or enable automatic transcription");
      const out = await save(await ff.burnSubtitles(data, srt), { costUsd });
      await createAsset(ctx.project.id, { name: `${asset.name}.srt`, kind: "document", folder: asset.folder, campaignId: asset.campaignId, source: "generated", createdBy: ctx.createdBy }, Buffer.from(srt, "utf8"), "application/x-subrip", {
        operation: "subtitles",
        params: { forAssetId: asset.id },
        createdBy: ctx.createdBy,
      });
      return { versions: [out] };
    }
    case "concat": {
      const others = [];
      for (const id of op.assetIds) {
        const a = await loadAsset(id);
        if (a.asset.projectId !== ctx.project.id) throw notFound("Asset");
        others.push(a.data);
      }
      const merged = await ff.concatVideos([data, ...others]);
      const r = await createAsset(ctx.project.id, { name: `${asset.name} — assembled`, kind: "video", folder: asset.folder, campaignId: asset.campaignId, source: "edited", createdBy: ctx.createdBy }, merged, "video/mp4", {
        operation: "concat",
        params: { clips: [asset.id, ...op.assetIds] },
        createdBy: ctx.createdBy,
      });
      return { versions: [], createdAssets: [r.asset] };
    }
    case "thumbnail": {
      const jpg = await ff.videoThumbnail(data, op.at);
      const r = await createAsset(ctx.project.id, { name: `${asset.name} — thumbnail`, kind: "image", folder: asset.folder, campaignId: asset.campaignId, source: "edited", createdBy: ctx.createdBy }, jpg, "image/jpeg", {
        operation: "thumbnail",
        params: { fromAssetId: asset.id, at: op.at },
        createdBy: ctx.createdBy,
      });
      return { versions: [], createdAssets: [r.asset] };
    }
  }
}

export async function assetWithVersions(assetId: string) {
  return prisma.asset.findUnique({ where: { id: assetId }, include: { versions: { orderBy: { version: "desc" } } } });
}

export function policyAllowsSpend(project: Project) {
  return normalizePolicy(project.policy).permissions.spendMoney !== false;
}
