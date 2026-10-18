import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, X as XIcon, SealCheck, ArrowRight, ChatCircleText, GitPullRequest, RocketLaunch, Article, Code } from "@phosphor-icons/react";
import { PageContainer } from "@/components/layout/AppShell";
import { Badge, Button, Card, ConfirmDialog, Empty, PageHeader, SetupCallout, StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, type Tone } from "@/components/ui";
import { useMeta, useProject } from "@/components/common";
import { api, p } from "@/lib/api";
import { ago, fmtDate, toastError } from "@/lib/utils";
import { ExtLink, JsonView, ListSkeleton, actorText, useParam } from "@/components/ops/shared";

type Approval = {
  id: string;
  taskId: string | null;
  type: string;
  title: string;
  summary: string;
  payload: Record<string, any>;
  status: string;
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  result: { note?: string; output?: unknown; error?: string } | null;
  createdAt: string;
};

const TYPE_TONE: Record<string, Tone> = { publish: "blue", reply: "green", merge: "purple", deploy: "red", code_change: "purple", spend: "yellow" };
const TYPE_ICON: Record<string, React.ReactNode> = {
  publish: <Article size={15} />,
  reply: <ChatCircleText size={15} />,
  merge: <GitPullRequest size={15} />,
  deploy: <RocketLaunch size={15} />,
  code_change: <Code size={15} />,
};
const OUTBOUND_COPY: Record<string, string> = {
  publish: "Approving releases the post to its scheduled publication. At its scheduled time it is published to the selected platforms, subject to the daily post limit and publishing hours.",
  reply: "Approving sends the reply publicly on the platform as your account. It cannot be unsent through SocialPilot.",
  merge: "Approving merges the pull request into the base branch. The merge is blocked if checks are failing or still running. Roll back by reverting the merge commit.",
  deploy: "Approving changes what is served in production on Vercel. Previous production deployments are preserved so you can roll back.",
  code_change: "Approving pushes the change to a new branch and opens a pull request. Nothing is merged.",
};

export default function Approvals() {
  const { projectId = "" } = useParams();
  const [tab, setTab] = useParam("tab");
  const current = tab === "history" ? "history" : "pending";
  const pending = useQuery({ queryKey: ["approvals", projectId, "pending"], queryFn: () => api.get<{ approvals: Approval[] }>(p(projectId, "/approvals?status=pending")) });
  const history = useQuery({ queryKey: ["approvals", projectId, "all"], queryFn: () => api.get<{ approvals: Approval[] }>(p(projectId, "/approvals?status=all")), enabled: current === "history" });
  const { data: proj } = useProject(projectId);
  const level = proj?.policy?.autonomyLevel;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Project"
        title="Approvals"
        description="Outbound actions requested by agents, automations or you wait here until a human decides. Approved actions run in the background with retries and an audit trail."
        actions={
          <Link to={`/projects/${projectId}/settings`} className="text-[12.5px] text-muted hover:text-ink">
            {level ? `Autonomy level ${level} · ` : ""}Approval rules →
          </Link>
        }
      />
      <Tabs value={current} onValueChange={(v) => setTab(v === "pending" ? null : v, { replace: true })}>
        <TabsList>
          <TabsTrigger value="pending">
            Pending{pending.data?.approvals.length ? <Badge tone="yellow" className="ml-1.5">{pending.data.approvals.length}</Badge> : null}
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="pending">
          <ApprovalList projectId={projectId} query={pending} empty={{ title: "Nothing waiting", description: "When an agent or automation wants to publish, reply, merge or deploy, the request appears here." }} />
        </TabsContent>
        <TabsContent value="history">
          <ApprovalList projectId={projectId} query={history} empty={{ title: "No approvals yet", description: "Decided and executed requests are listed here." }} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function ApprovalList({ projectId, query, empty }: { projectId: string; query: { data?: { approvals: Approval[] }; isLoading: boolean; error: unknown }; empty: { title: string; description: string } }) {
  const approvals = query.data?.approvals ?? [];
  const needsInbox = approvals.some((a) => a.type === "reply");
  const inbox = useQuery({
    queryKey: ["inbox", projectId, "approval-lookup"],
    queryFn: () => api.get<{ items: { id: string; text: string; authorName?: string; authorHandle?: string; platform: string; url?: string }[] }>(p(projectId, "/inbox?status=pending_approval,drafted,replied,new,escalated&limit=300")),
    enabled: needsInbox,
    staleTime: 30_000,
  });
  if (query.isLoading) return <ListSkeleton rows={3} />;
  if (query.error)
    return (
      <SetupCallout tone="red" title="Could not load approvals">
        {(query.error as Error).message}
      </SetupCallout>
    );
  if (!approvals.length)
    return (
      <Card>
        <Empty icon={<SealCheck size={18} />} title={empty.title} description={empty.description} />
      </Card>
    );
  return (
    <div className="space-y-3">
      {approvals.map((a) => (
        <ApprovalCard key={a.id} projectId={projectId} approval={a} inboxItem={a.type === "reply" ? inbox.data?.items.find((i) => i.id === a.payload.inboxItemId) : undefined} />
      ))}
    </div>
  );
}

function ApprovalCard({ projectId, approval: a, inboxItem }: { projectId: string; approval: Approval; inboxItem?: { text: string; authorName?: string; authorHandle?: string; platform: string; url?: string } }) {
  const qc = useQueryClient();
  const { data: meta } = useMeta();
  const [note, setNote] = React.useState("");
  const [showNote, setShowNote] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") => api.post(p(projectId, `/approvals/${a.id}/decide`), { decision, note: note.trim() || undefined }),
    onSuccess: (_r, decision) => {
      setConfirm(false);
      toast.success(decision === "approve" ? "Approved — the action is executing in the background" : "Rejected");
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["posts"] });
      qc.invalidateQueries({ queryKey: ["task"] });
    },
    onError: (e) => toastError(e),
  });
  const pending = a.status === "pending";
  const outbound = a.type in OUTBOUND_COPY;

  return (
    <Card className="px-5 py-4">
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-lg border border-line bg-canvas flex items-center justify-center text-ink-2 shrink-0">{TYPE_ICON[a.type] ?? <SealCheck size={15} />}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TYPE_TONE[a.type] ?? "gray"}>{a.type.replace(/_/g, " ")}</Badge>
            {!pending && <StatusBadge status={a.status} />}
            <span className="text-[11.5px] text-muted">
              Requested by {actorText(a.requestedBy, meta?.agents)} · {ago(a.createdAt)}
            </span>
          </div>
          <h3 className="text-[14px] font-semibold text-ink mt-1.5 break-words">{a.title}</h3>
          {a.summary && <p className="text-[12.5px] text-muted mt-0.5 whitespace-pre-wrap break-words">{a.summary}</p>}

          <div className="mt-3">
            <PayloadDetails projectId={projectId} approval={a} inboxItem={inboxItem} />
          </div>

          {a.taskId && (
            <Link to={`/projects/${projectId}/agents?task=${a.taskId}`} className="inline-flex items-center gap-1 mt-2 text-[12px] text-muted hover:text-ink">
              View agent task <ArrowRight size={11} />
            </Link>
          )}

          {!pending && (
            <div className="mt-3 space-y-2">
              {a.decidedAt && <p className="text-[12px] text-muted">Decided {fmtDate(a.decidedAt)}</p>}
              {a.result?.note && <p className="text-[12.5px] text-ink-2">Note: {a.result.note}</p>}
              {a.result?.error && (
                <SetupCallout tone="red" title="Execution failed">
                  <span className="break-words">{a.result.error}</span>
                </SetupCallout>
              )}
              {a.result?.output !== undefined && <ResultOutput output={a.result.output} />}
            </div>
          )}

          {pending && (
            <div className="mt-4">
              {showNote && <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note (stored in the audit log)" className="min-h-[60px] mb-2" maxLength={1000} />}
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" size="sm" onClick={() => (outbound ? setConfirm(true) : decide.mutate("approve"))} loading={decide.isPending && decide.variables === "approve"}>
                  <Check size={13} weight="bold" /> Approve
                </Button>
                <Button size="sm" variant="secondary" onClick={() => decide.mutate("reject")} loading={decide.isPending && decide.variables === "reject"}>
                  <XIcon size={13} weight="bold" /> Reject
                </Button>
                {!showNote && (
                  <Button size="sm" variant="ghost" onClick={() => setShowNote(true)}>
                    Add note
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Approve: ${a.title}`}
        description={OUTBOUND_COPY[a.type]}
        confirmLabel="Approve and execute"
        loading={decide.isPending}
        onConfirm={() => decide.mutate("approve")}
      >
        {note.trim() && <p className="text-[12.5px] text-muted">Note: {note.trim()}</p>}
      </ConfirmDialog>
    </Card>
  );
}

function PayloadDetails({ projectId, approval: a, inboxItem }: { projectId: string; approval: Approval; inboxItem?: { text: string; authorName?: string; authorHandle?: string; platform: string; url?: string } }) {
  const pl = a.payload ?? {};
  const box = "rounded-lg border border-line bg-subtle px-3.5 py-2.5 text-[12.5px]";
  if (a.type === "publish")
    return (
      <div className={box}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {pl.scheduledAt && (
            <span className="text-ink-2">
              Scheduled for <span className="font-medium text-ink">{fmtDate(pl.scheduledAt)}</span>
            </span>
          )}
          {pl.version != null && <span className="text-muted">Post version {pl.version}</span>}
          {pl.postId && (
            <Link to={`/projects/${projectId}/content/${pl.postId}`} className="inline-flex items-center gap-1 text-ink font-medium hover:underline">
              Open in post editor <ArrowRight size={11} />
            </Link>
          )}
        </div>
      </div>
    );
  if (a.type === "reply")
    return (
      <div className={`${box} space-y-2`}>
        <div>
          <div className="text-[11px] text-muted font-medium mb-0.5">
            Comment{inboxItem ? ` from ${inboxItem.authorName ?? (inboxItem.authorHandle ? `@${inboxItem.authorHandle}` : "unknown")} on ${inboxItem.platform}` : ""}
          </div>
          {inboxItem ? <p className="text-ink-2 whitespace-pre-wrap break-words">{inboxItem.text}</p> : <Link to={`/projects/${projectId}/inbox`} className="text-ink-2 hover:underline">Open in inbox</Link>}
        </div>
        <div className="border-t border-line pt-2">
          <div className="text-[11px] text-muted font-medium mb-0.5">Reply to send</div>
          <p className="text-ink whitespace-pre-wrap break-words">{pl.text}</p>
        </div>
        {inboxItem?.url && <ExtLink href={inboxItem.url} className="text-[12px]">View on platform</ExtLink>}
      </div>
    );
  if (a.type === "merge" || a.type === "code_change") return <CodeChangeRef projectId={projectId} changeId={pl.codeChangeId} />;
  if (a.type === "deploy")
    return (
      <div className={box}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Badge tone={pl.mode === "rollback" ? "yellow" : "red"}>{pl.mode === "rollback" ? "Rollback" : "Promote to production"}</Badge>
          <span className="font-mono text-[11.5px] text-muted">{pl.deploymentId}</span>
          <Link to={`/projects/${projectId}/website?tab=deployments`} className="inline-flex items-center gap-1 text-ink font-medium hover:underline">
            View deployments <ArrowRight size={11} />
          </Link>
        </div>
      </div>
    );
  return <JsonView value={pl} label="Payload" />;
}

function CodeChangeRef({ projectId, changeId }: { projectId: string; changeId?: string }) {
  const { data } = useQuery({
    queryKey: ["code-change", projectId, changeId],
    queryFn: () => api.get<{ change: { id: string; title: string; status: string; prUrl: string | null; prNumber: number | null; repo: string; branch: string; baseBranch: string; checks: { summary?: string } | null } }>(p(projectId, `/code-changes/${changeId}`)),
    enabled: !!changeId,
  });
  const c = data?.change;
  return (
    <div className="rounded-lg border border-line bg-subtle px-3.5 py-2.5 text-[12.5px] flex flex-wrap items-center gap-x-4 gap-y-1">
      {c ? (
        <>
          <span className="font-mono text-[11.5px] text-ink-2">
            {c.repo} · {c.branch} → {c.baseBranch}
          </span>
          <StatusBadge status={c.status} />
          {c.checks?.summary && <Badge tone={c.checks.summary === "success" ? "green" : c.checks.summary === "failure" ? "red" : "gray"}>checks {c.checks.summary}</Badge>}
          {c.prUrl && <ExtLink href={c.prUrl}>PR #{c.prNumber}</ExtLink>}
        </>
      ) : (
        <span className="text-muted">Code change {changeId}</span>
      )}
      {changeId && (
        <Link to={`/projects/${projectId}/website?tab=code&change=${changeId}`} className="inline-flex items-center gap-1 text-ink font-medium hover:underline">
          Review diff <ArrowRight size={11} />
        </Link>
      )}
    </div>
  );
}

function ResultOutput({ output }: { output: unknown }) {
  const o = (output ?? {}) as Record<string, any>;
  const lines: string[] = [];
  if (o.merged) lines.push(`Merged${o.sha ? ` at ${String(o.sha).slice(0, 7)}` : ""}.`);
  if (o.alreadyMerged) lines.push("Pull request was already merged.");
  if (o.released) lines.push("Post released for publishing.");
  if (o.prUrl) lines.push(`Pull request opened: ${o.prUrl}`);
  if (o.rollback) lines.push(String(o.rollback));
  return (
    <div className="rounded-lg border border-[#cfe3cf] bg-green-bg/40 px-3.5 py-2.5">
      <div className="text-[11.5px] font-medium text-green-fg mb-0.5">Executed</div>
      {lines.map((l, i) => (
        <p key={i} className="text-[12.5px] text-ink-2 break-words">
          {l}
        </p>
      ))}
      <JsonView value={output} label="Raw output" className="mt-1" />
    </div>
  );
}
