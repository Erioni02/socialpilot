import * as React from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, ArrowsClockwise, CheckCircle, CircleNotch, File, FilePlus, FolderOpen, GitBranch, GitMerge, GitPullRequest, MagnifyingGlass, PencilSimple, Plus, Sparkle, Trash, X as XIcon, XCircle, Circle } from "@phosphor-icons/react";
import { Badge, Button, Card, ConfirmDialog, Empty, Field, Input, SetupCallout, Skeleton, StatusBadge, Textarea } from "@/components/ui";
import { DiffView, SectionTitle, useProject } from "@/components/common";
import { api, p } from "@/lib/api";
import { ago, cn, fmtBytes, fmtDate, toastError } from "@/lib/utils";
import { ExtLink, ListSkeleton, isSetupError, useParam } from "./shared";

type ChangeRow = { id: string; title: string; status: string; branch: string; prUrl: string | null; prNumber: number | null; previewUrl: string | null; createdBy: string; createdAt: string; checks: Checks | null; repo: string };
type Checks = { items: { name: string; status: string; conclusion: string | null; url?: string; source: string }[]; summary: "none" | "pending" | "failure" | "success" };
type Change = ChangeRow & { description: string; baseBranch: string; baseSha: string | null; files: { path: string; action: string; before: string | null; after: string | null }[]; diff: string; headSha: string | null; error: string | null; taskId: string | null; updatedAt: string };

export function CodeChangesTab({ projectId, github }: { projectId: string; github: { connected: boolean; repo?: string; baseBranch?: string } | null }) {
  const [changeId, setChangeId] = useParam("change");
  const list = useQuery({ queryKey: ["code-changes", projectId], queryFn: () => api.get<{ changes: ChangeRow[] }>(p(projectId, "/code-changes")) });
  const ready = !!github?.connected && !!github.repo;

  return (
    <div className="space-y-6">
      {!github ? null : !github.connected ? (
        <SetupCallout
          title="Connect GitHub to change the website"
          action={
            <Button size="sm" asChild>
              <Link to={`/projects/${projectId}/integrations`}>Connect GitHub</Link>
            </Button>
          }
        >
          SocialPilot reads the repository, commits to new branches and opens pull requests for your review. It never pushes to the base branch.
        </SetupCallout>
      ) : !github.repo ? (
        <SetupCallout
          title="Choose the repository for this project"
          action={
            <Button size="sm" asChild>
              <Link to={`/projects/${projectId}/integrations`}>Pick repository</Link>
            </Button>
          }
        >
          GitHub is connected, but no repository and base branch are selected yet.
        </SetupCallout>
      ) : (
        <AskAi projectId={projectId} repo={github.repo} />
      )}

      <div className="grid lg:grid-cols-[300px_1fr] gap-6 items-start">
        <div className="min-w-0">
          <SectionTitle
            action={
              ready && (
                <Button size="sm" variant="ghost" onClick={() => setChangeId("new")}>
                  <Plus size={12} weight="bold" /> Manual change
                </Button>
              )
            }
          >
            Changes
          </SectionTitle>
          {list.isLoading ? (
            <ListSkeleton rows={4} />
          ) : !list.data?.changes.length ? (
            <Card>
              <Empty icon={<GitPullRequest size={18} />} title="No code changes yet" description="Ask the AI or write a manual change. Every change is a reviewable diff before anything reaches GitHub." className="py-8" />
            </Card>
          ) : (
            <Card className="divide-y divide-line overflow-hidden">
              {list.data.changes.map((c) => (
                <button key={c.id} onClick={() => setChangeId(c.id)} className={cn("w-full text-left px-3.5 py-3 hover:bg-subtle", changeId === c.id && "bg-canvas")}>
                  <div className="text-[13px] font-medium text-ink line-clamp-2">{c.title}</div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    <StatusBadge status={c.status} />
                    {c.checks?.summary && c.checks.summary !== "none" && <ChecksBadge summary={c.checks.summary} />}
                    <span className="text-[11px] text-muted">
                      {c.prNumber ? `#${c.prNumber} · ` : ""}
                      {ago(c.createdAt)}
                    </span>
                  </div>
                </button>
              ))}
            </Card>
          )}
        </div>
        <div className="min-w-0">
          {changeId === "new" ? (
            ready ? (
              <ManualEditor projectId={projectId} repo={github!.repo!} baseBranch={github!.baseBranch ?? "main"} onCreated={(id) => setChangeId(id, { replace: true })} onCancel={() => setChangeId(null)} />
            ) : (
              <Card>
                <Empty title="GitHub repository required" description="Connect GitHub and choose a repository to write changes." />
              </Card>
            )
          ) : changeId ? (
            <ChangeDetail projectId={projectId} changeId={changeId} />
          ) : (
            <Card>
              <Empty
                icon={<GitBranch size={18} />}
                title="Select a change"
                description="Review the diff, open a pull request, check CI and preview, then merge with approval."
                action={
                  ready && (
                    <Button onClick={() => setChangeId("new")}>
                      <PencilSimple size={14} /> Write a manual change
                    </Button>
                  )
                }
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ChecksBadge({ summary }: { summary: string }) {
  const tone = summary === "success" ? "green" : summary === "failure" ? "red" : summary === "pending" ? "blue" : "gray";
  return <Badge tone={tone}>checks {summary}</Badge>;
}

function AskAi({ projectId, repo }: { projectId: string; repo: string }) {
  const [text, setText] = React.useState("");
  const [lastTask, setLastTask] = React.useState<string | null>(null);
  const ask = useMutation({
    mutationFn: () => api.post<{ taskId: string }>(p(projectId, "/code-changes/ai"), { instruction: text.trim() }),
    onSuccess: (r) => {
      setText("");
      setLastTask(r.taskId);
      toast.success("Website engineer started");
    },
    onError: (e) => toastError(e),
  });
  return (
    <Card className="px-5 py-4">
      <div className="flex items-center gap-2">
        <Sparkle size={15} weight="fill" className="text-muted" />
        <span className="text-[13.5px] font-semibold text-ink">Ask AI to change the website</span>
        <span className="text-[12px] text-muted font-mono ml-auto truncate">{repo}</span>
      </div>
      <p className="text-[12.5px] text-muted mt-1">The website engineer agent reads the relevant files, proposes a minimal diff and opens a pull request. It never merges.</p>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Add a meta description to the homepage and fix the missing alt text on the hero image" className="mt-3 min-h-[64px]" maxLength={4000} />
      <div className="flex flex-wrap items-center gap-3 mt-2">
        <Button variant="primary" size="sm" onClick={() => ask.mutate()} loading={ask.isPending} disabled={text.trim().length < 5}>
          Start task
        </Button>
        {lastTask && (
          <Link to={`/projects/${projectId}/agents?task=${lastTask}`} className="inline-flex items-center gap-1 text-[12.5px] text-ink hover:underline">
            Follow the task <ArrowRight size={12} />
          </Link>
        )}
      </div>
    </Card>
  );
}

type EditFile = { path: string; content: string | null; original: string | null; isNew: boolean };

function ManualEditor({ projectId, repo, baseBranch, onCreated, onCancel }: { projectId: string; repo: string; baseBranch: string; onCreated: (id: string) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const [files, setFiles] = React.useState<EditFile[]>([]);
  const [active, setActive] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [newPath, setNewPath] = React.useState("");
  const [opening, setOpening] = React.useState<string | null>(null);

  const openFile = async (path: string) => {
    if (files.some((f) => f.path === path)) return setActive(path);
    setOpening(path);
    try {
      const r = await api.get<{ path: string; content: string }>(p(projectId, `/repo/file?path=${encodeURIComponent(path)}`));
      setFiles((fs) => [...fs, { path, content: r.content, original: r.content, isNew: false }]);
      setActive(path);
    } catch (e) {
      toastError(e);
    } finally {
      setOpening(null);
    }
  };
  const addNew = () => {
    const path = newPath.trim().replace(/^\/+/, "");
    if (!path) return;
    if (files.some((f) => f.path === path)) return setActive(path);
    setFiles((fs) => [...fs, { path, content: "", original: null, isNew: true }]);
    setActive(path);
    setNewPath("");
  };
  const changed = files.filter((f) => f.content !== f.original);
  const create = useMutation({
    mutationFn: () => api.post<{ change: { id: string } }>(p(projectId, "/code-changes"), { title: title.trim(), description, files: changed.map((f) => ({ path: f.path, content: f.content })) }),
    onSuccess: (r) => {
      toast.success("Change created — review the diff, then open a pull request");
      qc.invalidateQueries({ queryKey: ["code-changes", projectId] });
      onCreated(r.change.id);
    },
    onError: (e) => toastError(e),
  });
  const cur = files.find((f) => f.path === active);

  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-3.5 border-b border-line flex items-center gap-2">
        <PencilSimple size={15} />
        <span className="text-[13.5px] font-semibold text-ink flex-1">Manual change</span>
        <span className="text-[12px] text-muted font-mono">
          {repo} @ {baseBranch}
        </span>
        <Button size="icon-sm" variant="ghost" onClick={onCancel} aria-label="Close editor">
          <XIcon size={14} />
        </Button>
      </div>
      <div className="grid md:grid-cols-[260px_1fr] min-h-[480px]">
        <div className="border-b md:border-b-0 md:border-r border-line flex flex-col min-w-0">
          <RepoBrowser projectId={projectId} onOpen={openFile} opening={opening} />
          <div className="border-t border-line p-2.5">
            <div className="text-[11px] text-muted font-medium mb-1">New file</div>
            <div className="flex gap-1.5">
              <Input value={newPath} onChange={(e) => setNewPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNew()} placeholder="src/pages/new.tsx" className="h-7 text-[12px] font-mono" />
              <Button size="icon-sm" onClick={addNew} disabled={!newPath.trim()} aria-label="Add new file">
                <FilePlus size={13} />
              </Button>
            </div>
          </div>
        </div>
        <div className="flex flex-col min-w-0">
          {files.length > 0 && (
            <div className="flex overflow-x-auto scrollbar-thin border-b border-line bg-subtle">
              {files.map((f) => (
                <div key={f.path} className={cn("flex items-center gap-1 pl-3 pr-1 h-8 border-r border-line text-[12px] shrink-0", active === f.path ? "bg-surface text-ink" : "text-muted")}>
                  <button onClick={() => setActive(f.path)} className="font-mono truncate max-w-[200px]">
                    {f.path.split("/").pop()}
                    {f.content === null ? " (deleted)" : f.content !== f.original ? " •" : ""}
                  </button>
                  <button
                    onClick={() => {
                      setFiles((fs) => fs.filter((x) => x.path !== f.path));
                      if (active === f.path) setActive(null);
                    }}
                    className="h-5 w-5 rounded hover:bg-black/[0.05] flex items-center justify-center"
                    aria-label={`Close ${f.path}`}
                  >
                    <XIcon size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {cur ? (
            <div className="flex-1 flex flex-col p-3 gap-2 min-w-0">
              <div className="flex items-center gap-2 text-[12px]">
                <span className="font-mono text-ink-2 truncate flex-1">{cur.path}</span>
                {cur.isNew && <Badge tone="green">new</Badge>}
                {!cur.isNew &&
                  (cur.content === null ? (
                    <Button size="sm" variant="ghost" onClick={() => setFiles((fs) => fs.map((x) => (x.path === cur.path ? { ...x, content: x.original } : x)))}>
                      Restore
                    </Button>
                  ) : (
                    <Button size="sm" variant="danger-ghost" onClick={() => setFiles((fs) => fs.map((x) => (x.path === cur.path ? { ...x, content: null } : x)))}>
                      <Trash size={12} /> Delete file
                    </Button>
                  ))}
              </div>
              {cur.content === null ? (
                <div className="flex-1 rounded-md border border-dashed border-[#f3cfd1] bg-red-bg/30 flex items-center justify-center text-[12.5px] text-red-fg">This file will be deleted.</div>
              ) : (
                <textarea
                  value={cur.content}
                  onChange={(e) => setFiles((fs) => fs.map((x) => (x.path === cur.path ? { ...x, content: e.target.value } : x)))}
                  spellCheck={false}
                  className="flex-1 min-h-[380px] w-full font-mono text-[12px] leading-[1.55] bg-subtle border border-line rounded-md p-3 resize-y focus:outline-none focus:border-ink/40 whitespace-pre overflow-auto scrollbar-thin"
                />
              )}
            </div>
          ) : (
            <Empty icon={<FolderOpen size={18} />} title="Open a file to edit" description="Browse the repository on the left, or add a new file. You can edit several files in one change." className="flex-1" />
          )}
        </div>
      </div>
      <div className="border-t border-line px-5 py-4 grid gap-3 bg-subtle">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Fix homepage meta description" maxLength={150} />
          </Field>
          <Field label="Description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Why this change is needed (optional)" maxLength={8000} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[12px] text-muted">
            {changed.length} file{changed.length === 1 ? "" : "s"} changed · secrets, CI workflows and lockfiles are protected
          </span>
          <Button variant="primary" onClick={() => create.mutate()} loading={create.isPending} disabled={!changed.length || title.trim().length < 3 || changed.length > 30}>
            Create change
          </Button>
        </div>
      </div>
    </Card>
  );
}

function RepoBrowser({ projectId, onOpen, opening }: { projectId: string; onOpen: (path: string) => void; opening: string | null }) {
  const [prefix, setPrefix] = React.useState("");
  const [applied, setApplied] = React.useState("");
  const [filter, setFilter] = React.useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["code-changes", projectId, "repo-files", applied],
    queryFn: () => api.get<{ repo: string; branch: string; truncated: boolean; files: { path: string; size: number }[] }>(p(projectId, `/repo/files?prefix=${encodeURIComponent(applied)}`)),
    staleTime: 60_000,
  });
  const files = (data?.files ?? []).filter((f) => !filter || f.path.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="p-2.5 space-y-1.5 border-b border-line">
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(prefix.trim());
          }}
        >
          <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="Folder prefix, e.g. src/" className="h-7 text-[12px] font-mono" />
          <Button size="icon-sm" type="submit" aria-label="Load folder">
            <FolderOpen size={13} />
          </Button>
        </form>
        <div className="relative">
          <MagnifyingGlass size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter files" className="h-7 text-[12px] pl-6" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin max-h-[360px] md:max-h-none">
        {isLoading ? (
          <div className="p-2.5 space-y-1.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-5" />
            ))}
          </div>
        ) : error ? (
          <p className="p-3 text-[12px] text-red-fg">{isSetupError(error) ? error.message : (error as Error).message}</p>
        ) : !files.length ? (
          <p className="p-3 text-[12px] text-muted">No files{applied ? ` under ${applied}` : ""}.</p>
        ) : (
          <ul className="py-1">
            {files.slice(0, 300).map((f) => (
              <li key={f.path}>
                <button onClick={() => onOpen(f.path)} className="w-full text-left px-2.5 py-1 hover:bg-canvas flex items-center gap-1.5 text-[12px] min-w-0" title={f.path}>
                  {opening === f.path ? <CircleNotch size={12} className="animate-spin text-muted shrink-0" /> : <File size={12} className="text-faint shrink-0" />}
                  <span className="font-mono text-ink-2 truncate flex-1" dir="rtl">
                    <bdi>{f.path}</bdi>
                  </span>
                  <span className="text-[10.5px] text-faint shrink-0">{fmtBytes(f.size)}</span>
                </button>
              </li>
            ))}
            {files.length > 300 && <li className="px-2.5 py-1.5 text-[11.5px] text-muted">{files.length - 300} more — narrow with a prefix or filter</li>}
          </ul>
        )}
        {data?.truncated && <p className="px-2.5 pb-2 text-[11px] text-yellow-fg">Repository tree was truncated by GitHub; use a prefix.</p>}
      </div>
    </div>
  );
}

const TIMELINE = [
  { key: "draft", label: "Proposed" },
  { key: "pr_open", label: "Pull request open" },
  { key: "merged", label: "Merged" },
];

function Timeline({ c }: { c: Change }) {
  const terminalBad = ["closed", "rejected", "failed"].includes(c.status);
  const idx = c.status === "merged" ? 2 : c.status === "pr_open" || c.status === "branch_pushed" ? 1 : 0;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px]">
      {TIMELINE.map((s, i) => {
        const done = !terminalBad ? i <= idx : i === 0 || (i === 1 && !!c.prNumber);
        return (
          <React.Fragment key={s.key}>
            <span className={cn("inline-flex items-center gap-1", done ? "text-ink" : "text-faint")}>
              {done ? <CheckCircle size={14} weight="fill" className={i === 2 ? "text-purple-fg" : "text-green-fg"} /> : <Circle size={14} />}
              {s.label}
              {i === 0 && <span className="text-muted">· {fmtDate(c.createdAt, "MMM d, HH:mm")}</span>}
            </span>
            {i < TIMELINE.length - 1 && <span className="w-6 h-px bg-line-strong" />}
          </React.Fragment>
        );
      })}
      {terminalBad && (
        <>
          <span className="w-6 h-px bg-line-strong" />
          <span className="inline-flex items-center gap-1 text-red-fg">
            <XCircle size={14} weight="fill" /> {c.status === "failed" ? "Failed" : c.status === "rejected" ? "Discarded" : "Closed"} · {ago(c.updatedAt)}
          </span>
        </>
      )}
    </div>
  );
}

function ChangeDetail({ projectId, changeId }: { projectId: string; changeId: string }) {
  const qc = useQueryClient();
  const { data: proj } = useProject(projectId);
  const [confirmMerge, setConfirmMerge] = React.useState(false);
  const [confirmClose, setConfirmClose] = React.useState(false);
  const [mergeResult, setMergeResult] = React.useState<string | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ["code-change", projectId, changeId], queryFn: () => api.get<{ change: Change }>(p(projectId, `/code-changes/${changeId}`)) });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["code-change", projectId, changeId] });
    qc.invalidateQueries({ queryKey: ["code-changes", projectId] });
  };
  const push = useMutation({
    mutationFn: () => api.post<{ prUrl: string | null; prNumber?: number }>(p(projectId, `/code-changes/${changeId}/push`)),
    onSuccess: (r) => {
      toast.success(r.prNumber ? `Pull request #${r.prNumber} opened` : "Branch pushed");
      invalidate();
    },
    onError: (e) => {
      toastError(e);
      invalidate();
    },
  });
  const refresh = useMutation({
    mutationFn: () => api.post(p(projectId, `/code-changes/${changeId}/refresh`)),
    onSuccess: () => {
      toast.success("Checks refreshed");
      invalidate();
    },
    onError: (e) => toastError(e),
  });
  const merge = useMutation({
    mutationFn: () => api.post<{ pendingApproval?: string; merged?: boolean; alreadyMerged?: boolean; sha?: string; rollback?: string }>(p(projectId, `/code-changes/${changeId}/merge`), { confirm: true }),
    onSuccess: (r) => {
      setConfirmMerge(false);
      if (r.pendingApproval) {
        toast.success("Merge request sent to the approval queue");
        setMergeResult("pending");
      } else {
        toast.success(r.alreadyMerged ? "Already merged" : "Pull request merged");
        setMergeResult(r.rollback ?? null);
      }
      invalidate();
      qc.invalidateQueries({ queryKey: ["approvals"] });
    },
    onError: (e) => toastError(e),
  });
  const close = useMutation({
    mutationFn: () => api.post(p(projectId, `/code-changes/${changeId}/close`)),
    onSuccess: () => {
      setConfirmClose(false);
      toast.success("Change closed");
      invalidate();
    },
    onError: (e) => toastError(e),
  });

  if (isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (error || !data)
    return (
      <SetupCallout tone="red" title="Could not load change">
        {(error as Error)?.message}
      </SetupCallout>
    );
  const c = data.change;
  const mergeEff = proj?.effective?.mergeCode;
  const checks = c.checks;
  const canPush = c.status === "draft" || c.status === "failed";
  const canClose = c.status === "draft" || c.status === "pr_open" || c.status === "failed";

  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 border-b border-line space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <StatusBadge status={c.status} />
              {checks?.summary && <ChecksBadge summary={checks.summary} />}
              <span className="text-[11.5px] text-muted">by {c.createdBy === "user" ? "you" : c.createdBy.replace("agent:", "")}</span>
            </div>
            <h2 className="text-[16px] font-semibold text-ink">{c.title}</h2>
            <div className="text-[12px] text-muted font-mono mt-1 break-all">
              {c.repo} · {c.branch} → {c.baseBranch}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {canPush && (
              <Button size="sm" variant="primary" onClick={() => push.mutate()} loading={push.isPending}>
                <GitPullRequest size={14} /> Push branch & open PR
              </Button>
            )}
            {c.prNumber && c.status === "pr_open" && (
              <>
                <Button size="sm" onClick={() => refresh.mutate()} loading={refresh.isPending}>
                  <ArrowsClockwise size={14} /> Refresh checks
                </Button>
                <Button size="sm" variant="primary" onClick={() => setConfirmMerge(true)}>
                  <GitMerge size={14} /> Merge
                </Button>
              </>
            )}
            {canClose && (
              <Button size="sm" variant="ghost" onClick={() => setConfirmClose(true)}>
                Close
              </Button>
            )}
          </div>
        </div>
        <Timeline c={c} />
        {c.taskId && (
          <Link to={`/projects/${projectId}/agents?task=${c.taskId}`} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink">
            Created by agent task <ArrowRight size={11} />
          </Link>
        )}
      </div>

      <div className="px-5 py-4 space-y-6">
        {c.error && (
          <SetupCallout tone="red" title="Last operation failed">
            <span className="break-words">{c.error}</span>
          </SetupCallout>
        )}
        {mergeResult === "pending" && (
          <SetupCallout
            tone="blue"
            title="Waiting for approval"
            action={
              <Button size="sm" asChild>
                <Link to={`/projects/${projectId}/approvals`}>Open approvals</Link>
              </Button>
            }
          >
            The merge runs once the request is approved. Checks are verified again at that moment.
          </SetupCallout>
        )}
        {mergeResult && mergeResult !== "pending" && <SetupCallout tone="blue" title="Merged">{mergeResult}</SetupCallout>}
        {c.description && <p className="text-[13px] text-ink-2 whitespace-pre-wrap">{c.description}</p>}

        {(c.prUrl || c.previewUrl || checks) && (
          <div>
            <SectionTitle>Pull request, checks & preview</SectionTitle>
            <div className="rounded-lg border border-line divide-y divide-line">
              <div className="px-3.5 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px]">
                {c.prUrl && <ExtLink href={c.prUrl}>Pull request #{c.prNumber}</ExtLink>}
                {c.previewUrl ? <ExtLink href={c.previewUrl}>Preview deployment</ExtLink> : c.prNumber && <span className="text-muted">No preview URL found yet</span>}
                {c.headSha && <span className="font-mono text-[11.5px] text-muted">head {c.headSha.slice(0, 7)}</span>}
              </div>
              {checks?.items?.length ? (
                checks.items.map((it, i) => (
                  <div key={i} className="px-3.5 py-2 flex items-center gap-2 text-[12.5px]">
                    {it.status !== "completed" ? (
                      <CircleNotch size={14} className="animate-spin text-blue-fg" />
                    ) : it.conclusion && ["success", "neutral", "skipped"].includes(it.conclusion) ? (
                      <CheckCircle size={14} weight="fill" className="text-green-fg" />
                    ) : (
                      <XCircle size={14} weight="fill" className="text-red-fg" />
                    )}
                    <span className="text-ink flex-1 min-w-0 truncate">{it.name}</span>
                    <span className="text-muted">{it.conclusion ?? it.status.replace(/_/g, " ")}</span>
                    {it.url && <ExtLink href={it.url}>Details</ExtLink>}
                  </div>
                ))
              ) : c.prNumber ? (
                <div className="px-3.5 py-2 text-[12.5px] text-muted">{checks ? "No checks reported for this commit." : "Checks not fetched yet — click Refresh checks."}</div>
              ) : null}
            </div>
          </div>
        )}

        <div>
          <SectionTitle>Files ({c.files.length})</SectionTitle>
          <ul className="flex flex-wrap gap-1.5">
            {c.files.map((f) => (
              <li key={f.path} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-subtle px-2 py-0.5 text-[12px]">
                <Badge tone={f.action === "create" ? "green" : f.action === "delete" ? "red" : "blue"}>{f.action}</Badge>
                <span className="font-mono text-ink-2">{f.path}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <SectionTitle>Diff</SectionTitle>
          {c.diff ? <DiffView diff={c.diff} /> : <p className="text-[12.5px] text-muted">No diff recorded.</p>}
        </div>
      </div>

      <ConfirmDialog
        open={confirmMerge}
        onOpenChange={setConfirmMerge}
        title={`Merge PR #${c.prNumber} into ${c.baseBranch}?`}
        description="This changes the code your site is built from."
        confirmLabel={mergeEff?.allowed && !mergeEff.requiresApproval ? "Merge now" : "Request merge"}
        loading={merge.isPending}
        onConfirm={() => merge.mutate()}
      >
        <ul className="text-[12.5px] text-ink-2 space-y-1.5 list-disc pl-4">
          <li>
            {!mergeEff
              ? "The project's approval policy decides whether this merges now or goes to the approval queue."
              : !mergeEff.allowed
                ? `Merging is not currently permitted by the project policy: ${mergeEff.reason ?? "permission disabled"}.`
                : mergeEff.requiresApproval
                  ? "Project policy requires approval for merges — this creates a request in the approval queue instead of merging immediately."
                  : "Project policy allows merging without approval — this merges immediately."}
          </li>
          <li>The merge is refused while checks are failing or still running{checks?.summary ? ` (currently: ${checks.summary})` : ""}.</li>
          <li>Rollback: revert the merge commit on GitHub.</li>
        </ul>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Close this change?"
        description={c.prNumber && c.status === "pr_open" ? "The pull request is closed on GitHub without merging. The branch is kept." : "The proposed change is discarded. Nothing was pushed to GitHub."}
        confirmLabel="Close change"
        danger
        loading={close.isPending}
        onConfirm={() => close.mutate()}
      />
    </Card>
  );
}
