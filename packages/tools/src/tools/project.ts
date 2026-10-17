import { UNTRUSTED_SYSTEM_RULE, untrusted } from "@sp/ai";
import { prisma } from "@sp/db";
import type { WebsiteIssue } from "@sp/shared";
import { z } from "zod";
import { registerTool } from "../registry";
import { toProfileDTO } from "./brand";
import { deps } from "./deps";

const SummaryOutput = z.object({ bullets: z.array(z.string().min(1)).length(5) });

export function registerProjectTools(): void {
  registerTool({
    name: "project.summary",
    description: "Five-bullet AI summary of the project's brand profile and website findings.",
    input: z.object({}),
    output: SummaryOutput,
    capability: "website.read",
    minAutonomy: 1,
    approval: "never",
    runMode: "queued",
    async run(ctx) {
      const project = await prisma.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
      const profile = await prisma.brandProfile.findFirst({ where: { projectId: ctx.projectId }, orderBy: { version: "desc" } });
      const snapshot = await prisma.websiteSnapshot.findFirst({ where: { projectId: ctx.projectId }, orderBy: { fetchedAt: "desc" } });
      if (!profile && !snapshot) throw new Error("Nothing to summarize yet: analyze the website or fill in the brand profile first.");

      const providers = await deps.loadProviders(ctx.workspaceId);
      if (!providers.length) throw new Error("No AI provider is configured. Add one in Settings → AI Providers.");

      const issues = ((snapshot?.issues ?? []) as WebsiteIssue[]).map((i) => `${i.severity} ${i.code}: ${i.evidence}`).slice(0, 30);
      await ctx.emit("Summarizing the project…");
      const result = await deps.chat({
        providers,
        schema: SummaryOutput,
        json: true,
        signal: ctx.signal,
        label: "project.summary",
        messages: [
          { role: "system", content: `You are a pragmatic growth advisor. ${UNTRUSTED_SYSTEM_RULE} Reply with JSON {"bullets": [five strings]} only.` },
          {
            role: "user",
            content:
              `Give exactly five short, specific bullets about the project "${project.name}": what it is, who it serves, its strongest asset, ` +
              `the most important website problem, and the single next marketing step. Mark anything that is a hypothesis as "(hypothesis)".\n\n` +
              untrusted("brand profile", JSON.stringify(profile ? toProfileDTO(profile) : {})) +
              "\n\n" +
              untrusted("website issues", issues.join("\n") || "none recorded")
          }
        ]
      });
      await ctx.recordSpend("ai", result.costUsd);
      return result.data!;
    }
  });
}
