import sharp from "sharp";
import type { Project } from "@socialpilot/db";
import { badRequest, notFound } from "@socialpilot/core";
import type { ImageInput } from "@socialpilot/ai";
import { aiComplete, type AiCallContext } from "../ai/service";
import { loadAsset } from "./service";
import * as ff from "./ffmpeg";

async function toJpeg(data: Buffer, max = 1024): Promise<ImageInput> {
  const jpg = await sharp(data).rotate().resize(max, max, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer();
  return { mimeType: "image/jpeg", base64: jpg.toString("base64") };
}

/**
 * Real image/video understanding with the project's vision model.
 * Videos are sampled into evenly spaced frames with FFmpeg and sent together with their timestamps.
 */
export async function analyzeMedia(ctx: AiCallContext & { project: Project }, assetId: string, question?: string, frames = 6) {
  const { asset, version, data } = await loadAsset(assetId);
  if (asset.projectId !== ctx.project.id) throw notFound("Asset");
  const q = question?.trim() || "Describe this content in detail for a marketing team: subject, composition, text visible, colors, mood, brand fit, and anything that would hurt performance on social media.";
  let images: ImageInput[];
  let prompt: string;
  if (version.mimeType.startsWith("image/")) {
    images = [await toJpeg(data)];
    prompt = q;
  } else if (version.mimeType.startsWith("video/")) {
    const duration = version.durationSec ?? (await ff.probeBuffer(data)).durationSec;
    if (!duration) throw badRequest("Could not read the video duration");
    const n = Math.max(2, Math.min(frames, 10));
    const times = Array.from({ length: n }, (_, i) => Math.min(duration - 0.05, (duration * (i + 0.5)) / n));
    images = [];
    for (const t of times) images.push(await toJpeg(await ff.videoThumbnail(data, t), 768));
    prompt = `These are ${n} frames sampled from a ${duration.toFixed(1)}s video at ${times.map((t) => `${t.toFixed(1)}s`).join(", ")} (in order). Treat them as one video.\n\n${q}`;
  } else {
    throw badRequest("Only images and videos can be analyzed");
  }
  const r = await aiComplete(ctx, { role: "vision", system: "You are a precise visual analyst for a marketing team. Only describe what is actually visible; say when something is unclear.", prompt, images, maxTokens: 2000 }, ctx.project);
  return { assetId, kind: asset.kind, model: r.model, provider: r.provider, analysis: r.text };
}
