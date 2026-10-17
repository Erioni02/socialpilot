import { prisma, type Prisma } from "@sp/db";
import { extractPage } from "@sp/integrations";
import { normalizeSiteUrl, PageInfoSchema, type ProfileSkipReason } from "@sp/shared";
import { z } from "zod";
import { registerTool } from "../registry";
import { deps } from "./deps";
import { draftBlocker, draftProfile } from "./brand";

const AnalyzeOutput = z.object({
  snapshotId: z.string(),
  pagesCrawled: z.number(),
  issueCount: z.number(),
  httpStatus: z.number(),
  profileVersion: z.number().optional(),
  profileSkipped: z.enum(["no_ai_provider", "fetch_blocked", "thin_content", "ai_failed"]).optional(),
  aiError: z.string().optional()
});

export function registerWebsiteTools(): void {
  registerTool({
    name: "website.analyze",
    description: "Crawl the project's website, run basic checks, save a snapshot and draft a brand profile.",
    input: z.object({}),
    output: AnalyzeOutput,
    capability: "website.read",
    minAutonomy: 1,
    approval: "never",
    runMode: "queued",
    async run(ctx) {
      const project = await prisma.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
      if (!project.websiteUrl) throw new Error("This project has no website URL yet. Add one in the wizard or project settings.");
      const { startUrl } = normalizeSiteUrl(project.websiteUrl);

      await ctx.emit(`Crawling ${startUrl}`);
      const crawl = await deps.crawl(startUrl, {
        onPage: (page) => ctx.emit(`Fetched ${new URL(page.url).pathname} (${page.httpStatus})`, { url: page.url, status: page.httpStatus })
      });
      const snapshot = await prisma.websiteSnapshot.create({
        data: {
          projectId: ctx.projectId,
          rootUrl: crawl.rootUrl,
          httpStatus: crawl.httpStatus,
          responseMs: crawl.responseMs,
          pages: crawl.pages as unknown as Prisma.InputJsonValue,
          issues: crawl.issues as unknown as Prisma.InputJsonValue,
          brokenLinks: crawl.brokenLinks as unknown as Prisma.InputJsonValue,
          robotsTxt: crawl.robotsTxt,
          sitemapFound: crawl.sitemapFound
        }
      });
      await ctx.emit(`${crawl.pages.length} pages crawled, ${crawl.issues.length} basic issues found`, { snapshotId: snapshot.id });

      const base = { snapshotId: snapshot.id, pagesCrawled: crawl.pages.length, issueCount: crawl.issues.length, httpStatus: crawl.httpStatus };
      const skip = (profileSkipped: ProfileSkipReason, aiError?: string) => ({ ...base, profileSkipped, ...(aiError ? { aiError } : {}) });

      const blocker = draftBlocker(crawl.httpStatus, crawl.pages);
      if (blocker) {
        await ctx.emit(blocker === "fetch_blocked" ? `The site answered HTTP ${crawl.httpStatus}; skipping the AI draft` : "Too little server-rendered text; skipping the AI draft", undefined, "warn");
        return skip(blocker);
      }
      if (!(await deps.loadProviders(ctx.workspaceId)).length) {
        await ctx.emit("No AI provider configured; skipping the AI draft", undefined, "warn");
        return skip("no_ai_provider");
      }
      try {
        const profile = await draftProfile(ctx, project.name, crawl.pages);
        return { ...base, profileVersion: profile.version };
      } catch (error) {
        const message = (error as Error).message;
        await ctx.emit(`AI draft failed: ${message}`, undefined, "warn");
        return skip("ai_failed", message);
      }
    }
  });

  registerTool({
    name: "website.fetch",
    description: "Fetch and extract one page of the project's own website.",
    input: z.object({ url: z.string().url() }),
    output: PageInfoSchema,
    capability: "website.read",
    minAutonomy: 1,
    approval: "never",
    runMode: "inline",
    async run(ctx, { url }) {
      const project = await prisma.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
      if (!project.websiteUrl) throw new Error("This project has no website URL.");
      const siteHost = new URL(normalizeSiteUrl(project.websiteUrl).origin).hostname.replace(/^www\./, "");
      const target = new URL(url);
      if (target.hostname.replace(/^www\./, "") !== siteHost) throw new Error(`Only pages on the project's website (${siteHost}) can be fetched.`);
      const res = await deps.fetchPage(target.href);
      return extractPage(res.url, res.body, res.status);
    }
  });
}
