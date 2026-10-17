import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardContent, Progress } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { keys, useTask, useTasks } from "@/lib/queries";
import type { AnalyzeOutput } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { StepProps } from "./Wizard";

const MAX_PAGES = 15;

export function SkipReason({ output }: { output: AnalyzeOutput }) {
  switch (output.profileSkipped) {
    case "no_ai_provider":
      return (
        <Alert variant="warning">
          <AlertTriangle />
          <div>
            No AI provider configured. <Link className="font-medium text-primary underline" to="/settings/ai-providers">Add one in Settings → AI Providers</Link>, or fill the profile manually.
          </div>
        </Alert>
      );
    case "fetch_blocked":
      return (
        <Alert variant="warning">
          <AlertTriangle />
          <div>The site refused our crawler (HTTP {output.httpStatus}). Fill the profile manually.</div>
        </Alert>
      );
    case "thin_content":
      return (
        <Alert variant="warning">
          <AlertTriangle />
          <div>The page has very little server-rendered text, so the AI couldn't infer a profile. Fill it manually.</div>
        </Alert>
      );
    case "emergency_stop":
      return (
        <Alert variant="warning">
          <AlertTriangle />
          <div>The emergency stop is on, so the AI draft was skipped. Turn it off and re-analyze, or fill the profile manually.</div>
        </Alert>
      );
    case "not_permitted":
      return (
        <Alert variant="warning">
          <AlertTriangle />
          <div>This project's permissions deny brand edits or AI spending, so the AI draft was skipped. Change it in Settings → Permissions, or fill the profile manually.</div>
        </Alert>
      );
    case "ai_failed":
      return (
        <Alert variant="destructive">
          <XCircle />
          <div>The AI provider failed: {output.aiError}. Retry or fill manually.</div>
        </Alert>
      );
    default:
      return null;
  }
}

/** Step 3. Runs website.analyze as a background task and streams its progress live. */
export function StepAnalyze({ project, next, back }: StepProps) {
  const queryClient = useQueryClient();
  const tasks = useTasks(project.id);
  const latest = tasks.data?.find((t) => t.toolName === "website.analyze") ?? null;
  const detail = useTask(latest?.id ?? null);
  const started = useRef(false);

  const analyze = useMutation({
    mutationFn: () => api<{ taskId: string }>(`/projects/${project.id}/analyze`, { method: "POST" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.tasks(project.id) })
  });

  // Start automatically the first time this step opens.
  useEffect(() => {
    if (tasks.isSuccess && !latest && !started.current) {
      started.current = true;
      analyze.mutate();
    }
  }, [tasks.isSuccess, latest, analyze]);

  const task = detail.data?.task ?? latest;
  const events = detail.data?.events ?? [];
  // Before the first task exists we're "running" unless starting it failed — then show the error and let the user retry or move on.
  const running = task ? task.status === "queued" || task.status === "running" : !analyze.isError;
  const output = task?.status === "succeeded" ? (task.output as AnalyzeOutput) : null;
  const fetched = events.filter((e) => e.message.startsWith("Fetched ")).length;
  const percent = output ? 100 : Math.min(95, (fetched / MAX_PAGES) * 80 + (events.some((e) => e.message.startsWith("Drafting")) ? 15 : 0));

  return (
    <Card>
      <CardContent className="grid gap-5 p-6">
        <div className="flex items-center gap-3">
          {running ? <Loader2 className="size-5 animate-spin text-primary" /> : task?.status === "succeeded" ? <CheckCircle2 className="size-5 text-success" /> : <XCircle className="size-5 text-destructive" />}
          <div className="flex-1">
            <p className="font-medium">{running ? `Analyzing ${project.websiteUrl}` : task?.status === "succeeded" ? "Analysis complete" : task ? "Analysis failed" : "Couldn't start the analysis"}</p>
            <p className="text-xs text-muted-foreground">Crawls up to {MAX_PAGES} pages, runs basic SEO/accessibility checks, then drafts a brand profile.</p>
          </div>
        </div>
        <Progress value={percent} />

        <ol className="max-h-64 overflow-y-auto rounded-md border bg-muted/30 p-3 font-mono text-xs" aria-live="polite">
          {events.length === 0 && <li className="text-muted-foreground">{running ? "Waiting for the worker…" : "No progress recorded."}</li>}
          {events.map((e) => (
            <li key={e.id} className={cn("py-0.5", e.level === "warn" && "text-warning", e.level === "error" && "text-destructive")}>
              {e.message}
            </li>
          ))}
        </ol>

        {output && (
          <div className="grid gap-3">
            <p className="text-sm">
              <span className="font-medium">{output.pagesCrawled}</span> pages crawled · <span className="font-medium">{output.issueCount}</span> basic issues found
              {output.profileVersion ? <> · brand profile v{output.profileVersion} drafted</> : null}
            </p>
            <SkipReason output={output} />
          </div>
        )}
        {task?.status === "failed" && <Alert variant="destructive">{task.error}</Alert>}
        {analyze.isError && <Alert variant="destructive">{analyze.error.message}</Alert>}

        <div className="flex justify-between">
          <Button variant="ghost" onClick={back}>
            Back
          </Button>
          <div className="flex gap-2">
            {!running && (
              <Button variant="outline" onClick={() => analyze.mutate()} loading={analyze.isPending}>
                <RefreshCw /> Re-analyze
              </Button>
            )}
            <Button onClick={next} disabled={running}>
              {output?.profileVersion ? "Review profile" : "Continue"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
