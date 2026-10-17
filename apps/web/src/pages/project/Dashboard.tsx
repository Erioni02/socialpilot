import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, Bot, CheckCircle2, ExternalLink, FileText, Globe, Plug, RefreshCw, Sparkles, Wallet } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { taskLabel, TaskList } from "@/components/TaskList";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Progress, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { keys, useApprovals, useAudit, useIntegrations, useProfile, useProject, useProviders, useSpend, useTask, useTasks, useWebsite } from "@/lib/queries";
import type { ExecuteResult, WebsiteIssue } from "@/lib/types";
import { timeAgo, usd } from "@/lib/utils";

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;
const SEVERITY_BADGE = { high: "destructive", medium: "warning", low: "secondary" } as const;

function QuickActions({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [summaryTaskId, setSummaryTaskId] = useState<string | null>(null);
  const summary = useTask(summaryTaskId);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: keys.tasks(projectId) });
  const onError = (error: Error) => toast.error(error.message);

  const analyze = useMutation({
    mutationFn: () => api<{ taskId: string; existing: boolean }>(`/projects/${projectId}/analyze`, { method: "POST" }),
    onSuccess: (r) => {
      refresh();
      toast.info(r.existing ? "An analysis is already running" : "Website analysis started");
    },
    onError
  });
  const draft = useMutation({
    mutationFn: () => api<ExecuteResult>(`/projects/${projectId}/tools/brand.draftProfile`, { method: "POST", body: {} }),
    onSuccess: () => {
      refresh();
      toast.info("Drafting a new brand profile version");
    },
    onError
  });
  const ask = useMutation({
    mutationFn: () => api<ExecuteResult>(`/projects/${projectId}/tools/project.summary`, { method: "POST", body: {} }),
    onSuccess: (r) => {
      refresh();
      setSummaryTaskId(r.taskId);
    },
    onError
  });

  const bullets = summary.data?.task.status === "succeeded" ? (summary.data.task.output as { bullets: string[] }).bullets : null;
  const summaryRunning = summaryTaskId && (!summary.data || summary.data.task.status === "queued" || summary.data.task.status === "running");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick actions</CardTitle>
        <CardDescription>Each runs as a tracked, permission-checked task.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => analyze.mutate()} loading={analyze.isPending}>
            <RefreshCw /> Re-analyze website
          </Button>
          <Button variant="outline" size="sm" onClick={() => draft.mutate()} loading={draft.isPending}>
            <FileText /> Regenerate brand profile
          </Button>
          <Button size="sm" onClick={() => ask.mutate()} loading={ask.isPending || Boolean(summaryRunning)}>
            <Sparkles /> Ask AI for a summary
          </Button>
        </div>
        {summary.data?.task.status === "failed" && <Alert variant="destructive">{summary.data.task.error}</Alert>}
        {bullets && (
          <ul className="grid gap-1.5 rounded-md border bg-muted/30 p-3 text-sm">
            {bullets.map((b) => (
              <li key={b} className="flex gap-2">
                <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
                {b}
              </li>
            ))}
            <li className="pt-1 text-xs text-muted-foreground">AI-generated from your profile and website checks — not measured data.</li>
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function IssuesList({ issues }: { issues: WebsiteIssue[] }) {
  const sorted = [...issues].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  if (!sorted.length)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4 text-success" /> No problems found by the basic checks.
      </p>
    );
  return (
    <ul className="grid gap-2">
      {sorted.slice(0, 12).map((issue, i) => (
        <li key={`${issue.code}-${issue.url}-${i}`} className="rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={SEVERITY_BADGE[issue.severity]}>{issue.severity}</Badge>
            <span className="font-medium">{issue.code.replaceAll("_", " ")}</span>
            <a href={issue.url} target="_blank" rel="noreferrer" className="ml-auto truncate text-xs text-muted-foreground hover:text-foreground">
              {new URL(issue.url).pathname}
            </a>
          </div>
          <p className="mt-1 text-muted-foreground">{issue.evidence}</p>
          <p className="mt-1">{issue.recommendation}</p>
        </li>
      ))}
      {sorted.length > 12 && <li className="text-xs text-muted-foreground">+{sorted.length - 12} more</li>}
    </ul>
  );
}

export function Dashboard() {
  const { id = "" } = useParams();
  const project = useProject(id);
  const profile = useProfile(id);
  const website = useWebsite(id);
  const integrations = useIntegrations(id);
  const providers = useProviders();
  const approvals = useApprovals(id);
  const tasks = useTasks(id);
  const audit = useAudit(id);
  const spend = useSpend(id);

  const connected = integrations.data?.filter((i) => i.status === "connected").length ?? 0;
  const failed = tasks.data?.filter((t) => t.status === "failed").length ?? 0;
  const workingProviders = providers.data?.filter((p) => p.enabled && p.lastTestResult?.ok).length ?? 0;
  const snap = website.data;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{project.data?.name ?? <Skeleton className="h-6 w-40" />}</h1>
        {project.data?.websiteUrl && (
          <a href={project.data.websiteUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            {project.data.websiteUrl} <ExternalLink className="size-3" />
          </a>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="grid gap-1 p-4">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Globe className="size-3.5" /> Website
            </span>
            {snap ? (
              <>
                <span className="text-lg font-semibold">{snap.httpStatus < 400 ? `Online · HTTP ${snap.httpStatus}` : `HTTP ${snap.httpStatus}`}</span>
                <span className="text-xs text-muted-foreground">
                  {snap.responseMs} ms · {snap.pages.length} pages · checked {timeAgo(snap.fetchedAt)}
                </span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">Not analyzed yet</span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="grid gap-1 p-4">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Plug className="size-3.5" /> Integrations
            </span>
            <span className="text-lg font-semibold">
              {connected} of {integrations.data?.length ?? 9} connected
            </span>
            <Link to={`/projects/${id}/integrations`} className="text-xs text-primary hover:underline">
              See what each needs
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="grid gap-1 p-4">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Bot className="size-3.5" /> AI providers
            </span>
            <span className="text-lg font-semibold">{providers.data?.length ? `${workingProviders} of ${providers.data.length} working` : "Using .env keys"}</span>
            <Link to="/settings/ai-providers" className="text-xs text-primary hover:underline">
              Manage and test
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="grid gap-1.5 p-4">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Wallet className="size-3.5" /> AI spend today
            </span>
            {spend.data ? (
              <>
                <span className="text-lg font-semibold">
                  {usd(spend.data.todayAiUsd)} <span className="text-sm font-normal text-muted-foreground">/ {usd(spend.data.budget.dailyAiUsd)}</span>
                </span>
                <Progress value={(spend.data.todayAiUsd / Math.max(spend.data.budget.dailyAiUsd, 0.0001)) * 100} />
                <span className="text-xs text-muted-foreground">Month: {usd(spend.data.monthAiUsd)} of {usd(spend.data.budget.monthlyAiUsd)}</span>
              </>
            ) : (
              <Skeleton className="h-10" />
            )}
          </CardContent>
        </Card>
      </div>

      {(approvals.data?.length ?? 0) > 0 && (
        <Alert variant="warning">
          <AlertTriangle />
          <div>
            {approvals.data!.length} action{approvals.data!.length > 1 ? "s" : ""} waiting for your approval.{" "}
            <Link to={`/projects/${id}/approvals`} className="font-medium text-primary underline">
              Review
            </Link>
          </div>
        </Alert>
      )}
      {failed > 0 && <p className="text-xs text-destructive">{failed} recent task{failed > 1 ? "s" : ""} failed — see Tasks below for the reason.</p>}

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="grid content-start gap-6">
          <QuickActions projectId={id} />
          <Card>
            <CardHeader>
              <CardTitle>Business overview</CardTitle>
              <CardDescription>
                From the brand profile{profile.data ? ` v${profile.data.version}` : ""}.{" "}
                <Link to={`/projects/${id}/profile`} className="text-primary hover:underline">
                  Edit profile
                </Link>
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {profile.data ? (
                <>
                  <p>{profile.data.description || <span className="text-muted-foreground">No description yet.</span>}</p>
                  <dl className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-muted-foreground">Audience</dt>
                      <dd>{profile.data.targetAudience || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Industry</dt>
                      <dd>{profile.data.industry || "—"}</dd>
                    </div>
                  </dl>
                  {profile.data.productsServices.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {profile.data.productsServices.map((p) => (
                        <Badge key={p} variant="secondary">
                          {p}
                        </Badge>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">
                  No brand profile yet.{" "}
                  <Link to={`/projects/${id}/profile`} className="text-primary hover:underline">
                    Fill it in
                  </Link>{" "}
                  or regenerate it from the website.
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Basic checks (full audit in Cycle 4)</CardTitle>
              <CardDescription>Measured from the latest crawl: titles, descriptions, headings, alt text, links, sitemap, response time.</CardDescription>
            </CardHeader>
            <CardContent>{snap ? <IssuesList issues={snap.issues} /> : <p className="text-sm text-muted-foreground">Run an analysis to see results.</p>}</CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="size-4" /> Tasks
              </CardTitle>
              <CardDescription>Live from the background worker.</CardDescription>
            </CardHeader>
            <CardContent>{tasks.data ? <TaskList tasks={tasks.data} /> : <Skeleton className="h-24" />}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>Audit log: who did what, including AI and denied actions.</CardDescription>
            </CardHeader>
            <CardContent>
              {audit.data?.length ? (
                <ul className="grid gap-1.5 text-sm">
                  {audit.data.map((a) => (
                    <li key={a.id} className="flex items-center gap-2">
                      <Badge variant={a.outcome === "denied" || a.outcome === "failed" ? "destructive" : a.outcome === "approval_requested" ? "warning" : "outline"}>{a.actorType}</Badge>
                      <span className="truncate">{taskLabel(a.action)}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {a.outcome.replace("_", " ")} · {timeAgo(a.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Social, traffic and trends</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm text-muted-foreground">
              <p>Followers, reach, website traffic, conversions, comments and trends appear here once their integrations are connected — never as estimates.</p>
              <Link to={`/projects/${id}/integrations`} className="text-primary hover:underline">
                View integrations
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
