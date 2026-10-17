import { UNTRUSTED_SYSTEM_RULE, untrusted, type ChatMessage } from "@sp/ai";
import { prisma, type BrandProfile, type Prisma } from "@sp/db";
import { BrandDraftSchema, BrandProfileInputSchema, type BrandDraft, type BrandProfileDTO, type BrandProfileInput, type PageInfo, type ProfileSkipReason } from "@sp/shared";
import { z } from "zod";
import { registerTool } from "../registry";
import type { ToolContext } from "../types";
import { deps } from "./deps";

export const MIN_WORDS_FOR_DRAFT = 50;
const PROMPT_CHAR_BUDGET = 14_000;

export function toProfileDTO(row: BrandProfile): BrandProfileDTO {
  return {
    id: row.id,
    version: row.version,
    source: row.source,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    description: row.description,
    targetAudience: row.targetAudience,
    industry: row.industry,
    productsServices: row.productsServices as string[],
    objectives: row.objectives as string[],
    voiceTone: row.voiceTone,
    keyMessages: row.keyMessages as string[],
    colors: row.colors as string[],
    competitors: row.competitors as string[],
    notes: row.notes
  };
}

/** Appends a new profile version; earlier versions are never modified. */
export async function saveProfileVersion(projectId: string, data: BrandProfileInput, source: "ai_draft" | "user_edit", confirm = false): Promise<BrandProfile> {
  for (let attempt = 0; ; attempt++) {
    const latest = await prisma.brandProfile.findFirst({ where: { projectId }, orderBy: { version: "desc" }, select: { version: true } });
    try {
      return await prisma.brandProfile.create({
        data: { projectId, version: (latest?.version ?? 0) + 1, source, confirmedAt: confirm ? new Date() : null, ...data } as Prisma.BrandProfileUncheckedCreateInput
      });
    } catch (error) {
      if (attempt >= 2 || (error as { code?: string }).code !== "P2002") throw error; // version race: retry
    }
  }
}

/** Why an AI draft can't be made from these pages, or null if it can. */
export function draftBlocker(httpStatus: number, pages: PageInfo[]): Exclude<ProfileSkipReason, "no_ai_provider" | "ai_failed"> | null {
  if (httpStatus >= 400) return "fetch_blocked";
  const words = pages.reduce((sum, p) => sum + p.wordCount, 0);
  return words < MIN_WORDS_FOR_DRAFT ? "thin_content" : null;
}

function describePages(pages: PageInfo[]): string {
  let out = "";
  for (const p of pages) {
    const block = [
      `URL: ${p.url}`,
      `Title: ${p.title}`,
      `Description: ${p.metaDescription}`,
      `Headings: ${[...p.h1, ...p.h2, ...p.h3].slice(0, 12).join(" | ")}`,
      `Calls to action: ${p.ctas.map((c) => c.text).slice(0, 8).join(" | ")}`,
      `Text: ${p.textSample.slice(0, 1200)}`
    ].join("\n");
    if (out.length + block.length > PROMPT_CHAR_BUDGET) break;
    out += `${block}\n---\n`;
  }
  return out;
}

export function draftMessages(projectName: string, pages: PageInfo[]): ChatMessage[] {
  return [
    {
      role: "system",
      content: `You are a senior brand strategist. You infer a business's brand profile strictly from its public website. ${UNTRUSTED_SYSTEM_RULE} Only state what the pages support; leave a field empty rather than guessing. List competitors only if the site names them. Reply with JSON only.`
    },
    {
      role: "user",
      content:
        `Draft the brand profile for the project "${projectName}".\n` +
        `Return JSON with keys: description (2-3 sentences), targetAudience, industry, productsServices (string[]), objectives (string[], the business goals the site implies), ` +
        `voiceTone, keyMessages (string[]), competitors (string[]), messagingSummary (one paragraph assessing the site's messaging and calls to action).\n\n` +
        untrusted("website pages", describePages(pages))
    }
  ];
}

function draftToInput(draft: BrandDraft): BrandProfileInput {
  const cap = (items: string[], n: number, len = 200) => items.map((s) => s.trim().slice(0, len)).filter(Boolean).slice(0, n);
  return BrandProfileInputSchema.parse({
    description: draft.description.slice(0, 2000),
    targetAudience: draft.targetAudience.slice(0, 1000),
    industry: draft.industry.slice(0, 200),
    productsServices: cap(draft.productsServices, 30),
    objectives: cap(draft.objectives, 20),
    voiceTone: draft.voiceTone.slice(0, 500),
    keyMessages: cap(draft.keyMessages, 20, 300),
    colors: [],
    competitors: cap(draft.competitors, 20),
    notes: draft.messagingSummary ? `Website messaging (AI assessment): ${draft.messagingSummary}`.slice(0, 4000) : ""
  });
}

/** Asks the AI for a draft and saves it as a new `ai_draft` version. Throws on provider/validation failure. */
export async function draftProfile(ctx: ToolContext, projectName: string, pages: PageInfo[]): Promise<BrandProfile> {
  const providers = await deps.loadProviders(ctx.workspaceId);
  if (!providers.length) throw new Error("No AI provider is configured. Add one in Settings → AI Providers.");
  await ctx.emit(`Drafting brand profile with ${providers[0]!.name}…`);
  const result = await deps.chat({ providers, messages: draftMessages(projectName, pages), schema: BrandDraftSchema, json: true, signal: ctx.signal, label: "brand.draft" });
  await ctx.recordSpend("ai", result.costUsd);
  await ctx.emit(`Brand profile drafted by ${result.provider}/${result.model} in ${result.ms} ms`);
  return saveProfileVersion(ctx.projectId, draftToInput(result.data!), "ai_draft");
}

export function registerBrandTools(): void {
  registerTool({
    name: "brand.draftProfile",
    description: "Draft a new brand profile version from the latest website snapshot.",
    input: z.object({ snapshotId: z.string().optional() }),
    output: z.object({ profileVersion: z.number() }),
    capability: "brand.write",
    minAutonomy: 1,
    approval: "never",
    runMode: "queued",
    async run(ctx, input) {
      const project = await prisma.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
      const snapshot = await prisma.websiteSnapshot.findFirst({
        where: { projectId: ctx.projectId, ...(input.snapshotId ? { id: input.snapshotId } : {}) },
        orderBy: { fetchedAt: "desc" }
      });
      if (!snapshot) throw new Error("Analyze the website first: there is no snapshot to draft from.");
      const pages = snapshot.pages as PageInfo[];
      const blocker = draftBlocker(snapshot.httpStatus, pages);
      if (blocker === "fetch_blocked") throw new Error(`The site refused our crawler (HTTP ${snapshot.httpStatus}), so there is nothing to draft from.`);
      if (blocker === "thin_content") throw new Error("The site has too little server-rendered text to infer a profile. Fill it in manually.");
      const profile = await draftProfile(ctx, project.name, pages);
      return { profileVersion: profile.version };
    }
  });

  registerTool({
    name: "brand.updateProfile",
    description: "Save an edited brand profile as a new version (optionally confirming it).",
    input: BrandProfileInputSchema.extend({ confirm: z.boolean().optional() }),
    output: z.object({ profileVersion: z.number() }),
    capability: "brand.write",
    minAutonomy: 2,
    approval: "policy",
    runMode: "inline",
    async run(ctx, { confirm, ...data }) {
      const profile = await saveProfileVersion(ctx.projectId, data, "user_edit", confirm);
      return { profileVersion: profile.version };
    }
  });
}
