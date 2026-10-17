import type { BrandProfileDTO, IntegrationInfo, Policy, ProjectEvent, TaskEventDTO, TaskSummary, WebsiteIssue } from "@sp/shared";

export type { BrandProfileDTO, Policy, ProjectEvent, TaskEventDTO, TaskSummary, WebsiteIssue };

export type Me = { user: { id: string; email: string; name: string }; workspace: { id: string; name: string; emergencyStop: boolean } };

export type Project = {
  id: string;
  name: string;
  slug: string;
  websiteUrl: string | null;
  status: "draft" | "active" | "archived";
  hasLogo: boolean;
  wizardStep: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectListItem = Project & { latestSnapshot: { httpStatus: number; responseMs: number; fetchedAt: string; issueCount: number } | null };

export type WebsiteSnapshot = {
  id: string;
  rootUrl: string;
  fetchedAt: string;
  httpStatus: number;
  responseMs: number;
  sitemapFound: boolean;
  robotsTxtFound: boolean;
  pages: { url: string; title: string; httpStatus: number; wordCount: number }[];
  issues: WebsiteIssue[];
  brokenLinks: { url: string; from: string; status: number }[];
};

export type Integration = IntegrationInfo & { status: "not_connected" | "needs_setup" | "connected" | "error" | "revoked"; accountLabel: string | null; scopes: string[]; lastSyncAt: string | null; lastError: string | null };

export type Approval = { id: string; taskId: string; toolName: string; payload: unknown; reason: string; status: string; createdAt: string; decidedAt: string | null };

export type AuditEntry = { id: string; at: string; actorType: string; action: string; outcome: string; error: string | null };

export type AiProvider = {
  id: string;
  provider: string;
  baseUrl: string;
  keysPreview: string[];
  models: string[];
  order: number;
  enabled: boolean;
  lastTestAt: string | null;
  lastTestResult: { ok: boolean; model?: string; ms?: number; error?: string } | null;
};

export type ProviderCatalogItem = { provider: string; baseUrl: string; models: string[] };

export type Spend = { todayAiUsd: number; monthAiUsd: number; todayMediaUsd: number; budget: Policy["budget"] };

export type AnalyzeOutput = {
  snapshotId: string;
  pagesCrawled: number;
  issueCount: number;
  httpStatus: number;
  profileVersion?: number;
  profileSkipped?: "no_ai_provider" | "fetch_blocked" | "thin_content" | "ai_failed";
  aiError?: string;
};

export type TaskDetail = { task: TaskSummary; events: TaskEventDTO[] };
export type ExecuteResult = { status: "succeeded" | "queued" | "awaiting_approval"; taskId: string; output?: unknown };
