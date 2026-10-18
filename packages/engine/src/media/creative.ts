import type { Project } from "@socialpilot/db";
import { createLogger } from "@socialpilot/core";
import type { Brand } from "@socialpilot/shared";
import { z } from "zod";
import { aiJson, hasTextAI, type AiCallContext } from "../ai/service";
import { getSkill } from "../agents/skills";

/**
 * Creative-director pass: turns a rough request into a production-grade Seedream / Seedance prompt using the
 * image/video creative-direction skills and the project's brand. Falls back to the original prompt when no text
 * AI is configured or the call fails — generation never blocks on it.
 */

const log = createLogger("creative");

const crafted = z.object({ prompt: z.string().min(10).max(3000), notes: z.string().max(400).default("") });

function brandBrief(project: Project) {
  const b = (project.brand ?? {}) as Brand & Record<string, unknown>;
  return [
    `Brand: ${project.name}${project.industry ? ` (${project.industry})` : ""}.`,
    project.description ? `What it does: ${project.description.slice(0, 400)}` : "",
    project.targetAudience ? `Audience: ${project.targetAudience.slice(0, 300)}` : "",
    b.colors?.length ? `Brand colors: ${b.colors.slice(0, 5).join(", ")}.` : "",
    b.tone?.length ? `Tone: ${b.tone.slice(0, 5).join(", ")}.` : "",
    (b as any).fonts?.length ? `Fonts: ${(b as any).fonts.slice(0, 3).join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function craft(ctx: AiCallContext, project: Project, kind: "image" | "video", request: string, format: string): Promise<{ prompt: string; enhanced: boolean; notes?: string }> {
  if (!(await hasTextAI(ctx.userId, project))) return { prompt: request, enhanced: false };
  const skills = kind === "image" ? [getSkill("image-creative-direction"), getSkill("ad-creative-conversion")] : [getSkill("video-creative-direction")];
  try {
    const r = await aiJson(
      ctx,
      {
        role: "fast",
        system: [
          `You are a senior ${kind === "image" ? "art director and commercial photographer" : "commercial video director"} writing a single generation prompt for ByteDance ${kind === "image" ? "Seedream" : "Seedance"}.`,
          "Goal: clean, professional, on-brand, conversion-focused output. Keep the user's subject and intent exactly; add composition, lighting, style, palette and quality details. Never add claims, logos of other brands, or text the user didn't ask for.",
          ...skills.filter(Boolean).map((s) => `${s!.title}:\n${s!.body}`),
        ].join("\n\n"),
        prompt: `${brandBrief(project)}\n\nFormat: ${format}\n\nRequest:\n${request}\n\nReturn JSON {"prompt": "<one detailed paragraph, most important first>", "notes": "<one line on the creative choice>"}.`,
        schema: crafted,
        schemaHint: '{"prompt": string, "notes": string}',
        maxTokens: 900,
      },
      project,
    );
    return { prompt: r.data.prompt, enhanced: true, notes: r.data.notes };
  } catch (e) {
    log.warn(`creative pass skipped: ${(e as Error).message}`);
    return { prompt: request, enhanced: false };
  }
}

const SIZE_LABEL: Record<string, string> = { "1024x1024": "square 1:1 (feed post)", "1024x1536": "portrait 2:3 (4:5 feed / story-safe)", "1536x1024": "landscape 3:2 (X / LinkedIn / web)" };

export const craftImagePrompt = (ctx: AiCallContext, project: Project, request: string, size = "1024x1024") => craft(ctx, project, "image", request, SIZE_LABEL[size] ?? size);

export const craftVideoPrompt = (ctx: AiCallContext, project: Project, request: string, aspect: string, durationSec: number, hasFirstFrame: boolean) =>
  craft(ctx, project, "video", request, `${aspect}, ${durationSec}s single continuous shot${hasFirstFrame ? ", starts from the provided first-frame image (keep its subject, colors and composition)" : ""}`);
