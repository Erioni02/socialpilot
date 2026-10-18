import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowsClockwise,
  ChatsCircle,
  CheckCircle,
  EyeSlash,
  FloppyDisk,
  Info,
  PaperPlaneTilt,
  Robot,
  Siren,
  Sparkle,
  ArrowCounterClockwise,
  ChartPieSlice,
} from "@phosphor-icons/react";
import { INBOX_CLASSES } from "@socialpilot/shared";
import { PageContainer } from "@/components/layout/AppShell";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, Empty, PageHeader, Select, SetupCallout, Skeleton, StatusBadge, Textarea, type Tone } from "@/components/ui";
import { PlatformIcon, SectionTitle, useMeta, useProject } from "@/components/common";
import { api, p } from "@/lib/api";
import { cn, fmtNum, PLATFORM_LABEL, titleCase, toastError } from "@/lib/utils";
import { ExtLink, MethodBadge, TimeAgo } from "@/components/insights/shared";

type InboxItem = {
  id: string;
  integrationId: string;
  platform: string;
  remoteId: string;
  kind: string;
  postUrl: string | null;
  authorName: string | null;
  authorHandle: string | null;
  text: string;
  url: string | null;
  receivedAt: string;
  classification: string | null;
  sentiment: string | null;
  priority: number;
  status: string;
  draftReply: string | null;
  repliedAt: string | null;
};
type InboxIntegration = { id: string; provider: string; status: string; scopes: string[]; lastSyncAt: string | null; accountHandle: string | null };
type Summary = {
  counts: Record<string, number>;
  method: "none" | "counts_only" | "ai";
  basedOn?: number;
  summary: null | { themes: { theme: string; count: number; examples: string[] }[]; faqs: string[]; contentIdeas: string[]; risks: string[] };
};

const STATUSES = ["new", "drafted", "pending_approval", "replied", "escalated", "ignored"];
const CLASS_TONE: Record<string, Tone> = { question: "blue", product_interest: "green", praise: "purple", complaint: "yellow", sensitive: "red", spam: "gray", other: "gray" };
const PRIORITY = ["Low", "Normal", "High", "Urgent"];

function ClassBadge({ c }: { c: string | null }) {
  if (!c) return <Badge tone="gray">unclassified</Badge>;
  return <Badge tone={CLASS_TONE[c] ?? "gray"}>{c.replace(/_/g, " ")}</Badge>;
}

function hasScopes(cap: any, scopes: string[]) {
  return !cap?.scopes?.length || cap.scopes.every((s: string) => scopes.includes(s));
}

// ───────────── Integration status strip ─────────────
function IntegrationStrip({ projectId, integrations }: { projectId: string; integrations: InboxIntegration[] }) {
  const { data: meta } = useMeta();
  if (!integrations.length)
    return (
      <SetupCallout
        title="No social accounts connected"
        action={
          <Button asChild size="sm">
            <Link to={`/projects/${projectId}/integrations`}>Connect accounts</Link>
          </Button>
        }
      >
        Connect Instagram or X with OAuth to pull comments and mentions into this inbox.
      </SetupCallout>
    );
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {integrations.map((i) => {
        const caps = meta?.capabilities?.[i.provider] ?? {};
        const comments = caps.list_comments;
        const mentions = caps.list_mentions;
        const reply = caps.reply_comment;
        const publicOnly = i.status === "public_only";
        const rows = [
          { label: "Comments", cap: comments },
          { label: "Mentions", cap: mentions },
          { label: "Replies", cap: reply },
        ];
        return (
          <Card key={i.id} className="px-4 py-3">
            <div className="flex items-center gap-2">
              <PlatformIcon platform={i.provider} size={15} />
              <span className="text-[13px] font-medium text-ink truncate">{PLATFORM_LABEL[i.provider] ?? i.provider}</span>
              {i.accountHandle && <span className="text-[12px] text-muted truncate">@{i.accountHandle}</span>}
              <div className="flex-1" />
              <StatusBadge status={i.status} />
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {rows.map((r) => {
                const ok = !publicOnly && !!r.cap?.supported && hasScopes(r.cap, i.scopes);
                const note = publicOnly
                  ? "Public profile only — connect with OAuth to read comments."
                  : !r.cap?.supported
                    ? [r.cap?.notes, r.cap?.alternative].filter(Boolean).join(" ") || "Not supported by this platform's API"
                    : !hasScopes(r.cap, i.scopes)
                      ? `Missing scopes: ${r.cap.scopes.filter((s: string) => !i.scopes.includes(s)).join(", ")} — reconnect to grant them.`
                      : r.cap?.notes || "Available";
                return (
                  <span key={r.label} title={note}>
                    <Badge tone={ok ? "green" : "gray"} className="normal-case tracking-normal text-[11px]">
                      {r.label}{ok ? "" : " unavailable"}
                    </Badge>
                  </span>
                );
              })}
            </div>
            <div className="text-[11.5px] text-muted mt-2">
              {i.provider === "tiktok" ? (
                <>
                  TikTok's API doesn't expose comments to third-party apps.{" "}
                  <a href="https://www.tiktok.com/tiktokstudio" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-ink-2">
                    Answer in TikTok Studio
                  </a>
                </>
              ) : publicOnly ? (
                <>
                  Public profile only.{" "}
                  <Link to={`/projects/${projectId}/integrations`} className="underline underline-offset-2 text-ink-2">
                    Connect with OAuth
                  </Link>
                </>
              ) : i.lastSyncAt ? (
                <TimeAgo date={i.lastSyncAt} prefix="Last synced " />
              ) : (
                "Never synced"
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ───────────── Detail pane ─────────────
function Detail({ projectId, item, canReply, replyNote }: { projectId: string; item: InboxItem; canReply: boolean; replyNote?: string }) {
  const qc = useQueryClient();
  const { data: proj } = useProject(projectId);
  const [text, setText] = React.useState(item.draftReply ?? "");
  const [confirm, setConfirm] = React.useState(false);
  React.useEffect(() => setText(item.draftReply ?? ""), [item.id, item.draftReply]);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["inbox", projectId] });

  const draft = useMutation({
    mutationFn: () => api.post<{ draft: string }>(p(projectId, `/inbox/${item.id}/draft`)),
    onSuccess: (r) => {
      setText(r.draft);
      invalidate();
    },
    onError: (e) => toastError(e),
  });
  const setStatus = useMutation({
    mutationFn: (body: { status?: string; draftReply?: string }) => api.post(p(projectId, `/inbox/${item.id}/status`), body),
    onSuccess: (_r, body) => {
      toast.success(body.status ? `Marked ${body.status}` : "Draft saved");
      invalidate();
    },
    onError: (e) => toastError(e),
  });
  const send = useMutation({
    mutationFn: () => api.post<{ replyId?: string; url?: string; pendingApproval?: string }>(p(projectId, `/inbox/${item.id}/reply`), { text: text.trim() }),
    onSuccess: (r) => {
      setConfirm(false);
      invalidate();
      if (r.pendingApproval) toast.message("Reply sent for approval");
      else toast.success("Reply sent", r.url ? { action: { label: "View", onClick: () => window.open(r.url, "_blank", "noopener") } } : undefined);
    },
    onError: (e) => toastError(e),
  });

  const agentRule = proj?.effective?.reply;
  const aiClassified = item.sentiment != null;
  const done = item.status === "replied";

  return (
    <Card className="flex flex-col">
      <div className="px-5 pt-4 pb-3 border-b border-line">
        <div className="flex items-center gap-2 min-w-0">
          <PlatformIcon platform={item.platform} size={16} />
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold text-ink truncate">{item.authorName || (item.authorHandle ? `@${item.authorHandle}` : "Unknown author")}</div>
            <div className="text-[11.5px] text-muted flex items-center gap-1.5">
              {item.authorHandle && item.authorName && <span>@{item.authorHandle}</span>}
              <span>{titleCase(item.kind)}</span>
              <span className="text-faint">·</span>
              <TimeAgo date={item.receivedAt} />
            </div>
          </div>
          <div className="flex-1" />
          <StatusBadge status={item.status} />
        </div>
      </div>
      <div className="px-5 py-4 space-y-4">
        <p className="text-[14px] text-ink leading-relaxed whitespace-pre-wrap break-words">{item.text}</p>
        <div className="flex flex-wrap items-center gap-3 text-[12px]">
          {item.url && (
            <ExtLink href={item.url} className="text-ink-2" icon>
              Open original
            </ExtLink>
          )}
          {item.postUrl && (
            <ExtLink href={item.postUrl} className="text-muted" icon>
              View post
            </ExtLink>
          )}
        </div>
        <div className="rounded-lg bg-subtle border border-line px-3 py-2.5 flex flex-wrap items-center gap-2 text-[12px]">
          <ClassBadge c={item.classification} />
          {item.sentiment && <Badge tone={item.sentiment === "positive" ? "green" : item.sentiment === "negative" ? "red" : "gray"}>{item.sentiment}</Badge>}
          <span className="text-muted">Priority: {PRIORITY[item.priority] ?? item.priority}</span>
          <span className="flex-1" />
          <span className="text-faint text-[11.5px]">{item.classification ? (aiClassified ? "Classified by AI" : "Classified by keyword rules") : "Not classified yet"}</span>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[12px] font-medium text-ink-2">Reply</span>
            {!done && (
              <Button size="sm" variant="ghost" loading={draft.isPending} onClick={() => draft.mutate()}>
                <Sparkle size={13} weight="fill" /> {text ? "Redraft with AI" : "Draft with AI"}
              </Button>
            )}
          </div>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={done ? "" : "Write a reply, or draft one with AI and edit it."} className="min-h-[110px]" disabled={done} maxLength={2000} />
          <div className="flex items-center justify-between mt-1 text-[11px] text-faint">
            <span>{item.platform === "x" ? `${text.length}/280` : `${text.length} characters`}</span>
            {item.draftReply && text !== item.draftReply && !done && <span>Unsaved changes</span>}
          </div>
          {!canReply && <p className="text-[12px] text-yellow-fg mt-1.5">{replyNote ?? "Replies are not available for this account."}</p>}
          {item.status === "pending_approval" && (
            <p className="text-[12px] text-muted mt-1.5">
              A reply is waiting for approval.{" "}
              <Link to={`/projects/${projectId}/approvals`} className="underline underline-offset-2 text-ink-2">
                Review approvals
              </Link>
            </p>
          )}
        </div>
      </div>
      <div className="mt-auto px-4 py-3 border-t border-line flex flex-wrap items-center gap-1.5">
        {!done && (
          <>
            <Button size="sm" variant="primary" disabled={!canReply || text.trim().length < 1 || text.length > 2000} onClick={() => setConfirm(true)}>
              <PaperPlaneTilt size={13} weight="fill" /> Send reply
            </Button>
            <Button size="sm" disabled={!text.trim() || text === item.draftReply} loading={setStatus.isPending && setStatus.variables?.draftReply != null} onClick={() => setStatus.mutate({ draftReply: text, status: "drafted" })}>
              <FloppyDisk size={13} weight="bold" /> Save draft
            </Button>
          </>
        )}
        <div className="flex-1" />
        {item.status !== "escalated" && !done && (
          <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ status: "escalated" })}>
            <Siren size={13} weight="bold" /> Escalate
          </Button>
        )}
        {item.status !== "ignored" && !done && (
          <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ status: "ignored" })}>
            <EyeSlash size={13} weight="bold" /> Ignore
          </Button>
        )}
        {(item.status === "ignored" || item.status === "escalated") && (
          <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ status: "new" })}>
            <ArrowCounterClockwise size={13} weight="bold" /> Reopen
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Reply on ${PLATFORM_LABEL[item.platform] ?? item.platform}?`}
        confirmLabel="Send now"
        loading={send.isPending}
        onConfirm={() => send.mutate()}
      >
        <div className="space-y-3 text-[13px] text-ink-2">
          <div className="rounded-lg border border-line bg-subtle px-3 py-2">
            <div className="text-[11px] text-muted mb-1">Replying to {item.authorHandle ? `@${item.authorHandle}` : "this comment"}</div>
            <p className="whitespace-pre-wrap">{text.trim()}</p>
          </div>
          <p>
            This reply is sent by you and posts publicly <strong className="text-ink font-medium">right away</strong>. It can't be unsent from SocialPilot.
          </p>
          <p className="text-[12.5px] text-muted flex gap-1.5">
            <Info size={14} className="shrink-0 mt-[1px]" />
            <span>
              Project policy for agent replies:{" "}
              {agentRule == null
                ? "loading…"
                : !agentRule.allowed
                  ? `agents can't reply (${agentRule.reason ?? "permission off"}).`
                  : agentRule.requiresApproval
                    ? "agents' replies wait for your approval before they're sent."
                    : "agents may reply without approval within daily limits."}
            </span>
          </p>
        </div>
      </ConfirmDialog>
    </Card>
  );
}

// ───────────── Side cards ─────────────
function AutoReplyCard({ projectId }: { projectId: string }) {
  const { data } = useProject(projectId);
  const policy = data?.policy;
  const cats: string[] = policy?.autoReplyCategories ?? [];
  const reply = data?.effective?.reply;
  const active = cats.length > 0 && policy?.autonomyLevel === 4 && reply?.allowed && !reply?.requiresApproval;
  return (
    <Card>
      <CardHeader title="Auto-replies" description="Agents may answer approved categories automatically." action={<Badge tone={active ? "green" : "gray"}>{active ? "On" : "Off"}</Badge>} />
      <CardBody className="space-y-2 text-[12.5px] text-ink-2">
        {!policy ? (
          <Skeleton className="h-12" />
        ) : (
          <>
            <div>
              <span className="text-muted">Categories: </span>
              {cats.length ? cats.map((c) => <ClassBadge key={c} c={c} />).reduce<React.ReactNode[]>((a, b, i) => (i ? [...a, " ", b] : [b]), []) : <span>none (disabled by default)</span>}
            </div>
            <div>
              <span className="text-muted">Daily reply limit: </span>
              {fmtNum(policy.limits?.dailyReplies)}
            </div>
            {!active && (
              <p className="text-[12px] text-muted leading-relaxed">
                Auto-replies run only at autonomy level 4, with the Reply permission on, reply approvals off and at least one category selected. Complaints, sensitive comments and spam are never auto-answered.
              </p>
            )}
          </>
        )}
        <Button asChild size="sm" variant="link" className="h-auto">
          <Link to={`/projects/${projectId}/settings`}>Change in project settings</Link>
        </Button>
      </CardBody>
    </Card>
  );
}

function FeedbackCard({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [enabled, setEnabled] = React.useState(false);
  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ["inbox", projectId, "summary"],
    queryFn: () => api.get<Summary>(p(projectId, "/inbox/summary")),
    enabled,
    staleTime: 10 * 60_000,
  });
  React.useEffect(() => {
    if (error) toastError(error);
  }, [error]);
  const toPost = (idea: string) => navigate(`/projects/${projectId}/agents?prompt=${encodeURIComponent(`Draft a social post based on this idea from customer feedback: ${idea}`)}`);
  const entries = Object.entries(data?.counts ?? {}).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  const s = data?.summary;

  return (
    <Card>
      <CardHeader
        title="Feedback summary"
        description="What people are saying across the last 150 items."
        action={
          data ? (
            <Button size="icon-sm" variant="ghost" aria-label="Refresh summary" onClick={() => refetch()} disabled={isFetching}>
              <ArrowsClockwise size={13} weight="bold" className={cn(isFetching && "animate-spin")} />
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-4">
        {!enabled ? (
          <div className="text-[12.5px] text-muted space-y-2.5">
            <p>Counts by class, plus AI themes, FAQs, content ideas and risks when an AI provider is configured.</p>
            <Button size="sm" onClick={() => setEnabled(true)}>
              <ChartPieSlice size={13} weight="bold" /> Summarize feedback
            </Button>
          </div>
        ) : isFetching && !data ? (
          <div className="space-y-2">
            <Skeleton className="h-4" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-16" />
          </div>
        ) : data ? (
          <>
            {data.method === "none" ? (
              <p className="text-[12.5px] text-muted">No inbox items yet.</p>
            ) : (
              <div className="space-y-1.5">
                {entries.map(([k, n]) => (
                  <div key={k} className="flex items-center gap-2 text-[12px]">
                    <span className="w-[112px] shrink-0">
                      <ClassBadge c={k === "unclassified" ? null : k} />
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-black/[0.05] overflow-hidden">
                      <div className="h-full bg-ink/70 rounded-full" style={{ width: `${total ? (n / total) * 100 : 0}%` }} />
                    </div>
                    <span className="w-8 text-right tabular-nums text-muted">{n}</span>
                  </div>
                ))}
              </div>
            )}
            {data.method === "counts_only" && <p className="text-[12px] text-muted">Counts only — add an AI provider in Settings to get themes, FAQs and content ideas.</p>}
            {s && (
              <div className="space-y-3.5 pt-1 border-t border-line">
                <div className="flex items-center gap-1.5 pt-3">
                  <MethodBadge method="ai" />
                  <span className="text-[11.5px] text-muted">AI summary of {data.basedOn} items — interpretation, not measurement.</span>
                </div>
                {s.themes.length > 0 && (
                  <div>
                    <SectionTitle>Themes</SectionTitle>
                    <ul className="space-y-1.5">
                      {s.themes.map((t) => (
                        <li key={t.theme} className="text-[12.5px]">
                          <span className="text-ink font-medium">{t.theme}</span> <span className="text-muted">· ~{t.count}</span>
                          {t.examples[0] && <div className="text-[11.5px] text-muted italic line-clamp-1">“{t.examples[0]}”</div>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {s.faqs.length > 0 && (
                  <div>
                    <SectionTitle>Frequent questions</SectionTitle>
                    <ul className="list-disc pl-4 space-y-0.5 text-[12.5px] text-ink-2">
                      {s.faqs.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {s.contentIdeas.length > 0 && (
                  <div>
                    <SectionTitle>Content ideas</SectionTitle>
                    <ul className="space-y-1.5">
                      {s.contentIdeas.map((idea) => (
                        <li key={idea} className="flex items-start gap-2 text-[12.5px] text-ink-2">
                          <span className="flex-1">{idea}</span>
                          <Button size="sm" variant="ghost" className="h-6 px-1.5 shrink-0" onClick={() => toPost(idea)} title="Ask an agent to draft a post">
                            <Robot size={12} weight="bold" /> Post
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {s.risks.length > 0 && (
                  <div>
                    <SectionTitle>Risks</SectionTitle>
                    <ul className="list-disc pl-4 space-y-0.5 text-[12.5px] text-red-fg">
                      {s.risks.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <Button size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

// ───────────── Page ─────────────
export default function Inbox() {
  const { projectId } = useParams() as { projectId: string };
  const qc = useQueryClient();
  const { data: meta } = useMeta();
  const [status, setStatus] = React.useState("new,drafted,pending_approval,escalated");
  const [platform, setPlatform] = React.useState("");
  const [klass, setKlass] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  if (platform) qs.set("platform", platform);
  if (klass) qs.set("classification", klass);
  const { data, isLoading } = useQuery({
    queryKey: ["inbox", projectId, { status, platform, klass }],
    queryFn: () => api.get<{ items: InboxItem[]; integrations: InboxIntegration[] }>(p(projectId, `/inbox?${qs.toString()}`)),
    placeholderData: (prev) => prev,
  });
  const sync = useMutation({
    mutationFn: () => api.post<{ jobIds: string[] }>(p(projectId, "/inbox/sync")),
    onSuccess: (r) => {
      toast.success(`Syncing ${r.jobIds.length} account${r.jobIds.length === 1 ? "" : "s"}`, { description: "New comments appear here as they arrive." });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["inbox", projectId] }), 4000);
    },
    onError: (e) => toastError(e),
  });

  const items = data?.items ?? [];
  const integrations = data?.integrations ?? [];
  const selected = items.find((i) => i.id === selectedId) ?? items[0] ?? null;
  const integrationOf = (id: string) => integrations.find((x) => x.id === id);

  const replyAvailability = (item: InboxItem): { ok: boolean; note?: string } => {
    const cap = meta?.capabilities?.[item.platform]?.reply_comment;
    const integ = integrationOf(item.integrationId);
    if (!cap?.supported) return { ok: false, note: cap?.alternative ?? `${PLATFORM_LABEL[item.platform] ?? item.platform} doesn't support replies through its API.` };
    if (!integ) return { ok: false, note: "This account is disconnected. Reconnect it on the Integrations page." };
    if (!hasScopes(cap, integ.scopes)) return { ok: false, note: `Missing permission to reply (${cap.scopes.filter((s: string) => !integ.scopes.includes(s)).join(", ")}). Reconnect the account.` };
    return { ok: true };
  };

  return (
    <PageContainer wide>
      <PageHeader
        title="Inbox"
        description="Comments and mentions from your connected social accounts, triaged and ready to answer."
        actions={
          <Button onClick={() => sync.mutate()} loading={sync.isPending} disabled={!integrations.some((i) => i.status === "connected")}>
            <ArrowsClockwise size={14} weight="bold" /> Sync now
          </Button>
        }
      />

      <div className="space-y-6">
        {isLoading ? (
          <div className="grid sm:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : (
          <IntegrationStrip projectId={projectId} integrations={integrations} />
        )}

        <div className="grid xl:grid-cols-[minmax(0,1fr)_300px] gap-6 items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto h-8" aria-label="Status">
                <option value="new,drafted,pending_approval,escalated">Open</option>
                <option value="">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </Select>
              <Select value={platform} onChange={(e) => setPlatform(e.target.value)} className="w-auto h-8" aria-label="Platform">
                <option value="">All platforms</option>
                {["instagram", "x", "tiktok"].map((pl) => (
                  <option key={pl} value={pl}>
                    {PLATFORM_LABEL[pl]}
                  </option>
                ))}
              </Select>
              <Select value={klass} onChange={(e) => setKlass(e.target.value)} className="w-auto h-8" aria-label="Classification">
                <option value="">All classes</option>
                {INBOX_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {titleCase(c)}
                  </option>
                ))}
              </Select>
              <span className="text-[12px] text-muted ml-auto">{items.length} item{items.length === 1 ? "" : "s"}</span>
            </div>

            <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-4 items-start">
              <Card className="overflow-hidden">
                {isLoading ? (
                  <div className="divide-y divide-line">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="px-4 py-3 space-y-2">
                        <Skeleton className="h-3 w-32" />
                        <Skeleton className="h-4 w-full" />
                      </div>
                    ))}
                  </div>
                ) : items.length ? (
                  <ul className="max-h-[70vh] overflow-y-auto scrollbar-thin">
                    {items.map((it) => (
                      <li key={it.id}>
                        <button
                          onClick={() => setSelectedId(it.id)}
                          className={cn("w-full text-left px-4 py-3 border-b border-line last:border-0 transition-colors", selected?.id === it.id ? "bg-canvas" : "hover:bg-subtle")}
                        >
                          <div className="flex items-center gap-1.5 text-[12px]">
                            <PlatformIcon platform={it.platform} size={13} className="text-ink-2" />
                            <span className="font-medium text-ink truncate">{it.authorHandle ? `@${it.authorHandle}` : it.authorName ?? "Unknown"}</span>
                            {it.priority >= 2 && <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", it.priority >= 3 ? "bg-red-fg" : "bg-yellow-fg")} title={`${PRIORITY[it.priority]} priority`} />}
                            <span className="flex-1" />
                            <TimeAgo date={it.receivedAt} className="text-[11px] text-faint shrink-0" />
                          </div>
                          <p className="text-[12.5px] text-ink-2 mt-1 line-clamp-2 leading-snug">{it.text}</p>
                          <div className="flex items-center gap-1 mt-1.5">
                            <ClassBadge c={it.classification} />
                            {it.status !== "new" && <StatusBadge status={it.status} />}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty
                    icon={<ChatsCircle size={18} />}
                    title={status ? "Nothing to handle" : "No comments yet"}
                    description={integrations.length ? "Sync now to pull the latest comments and mentions, or widen the filters." : "Connect a social account to start receiving comments."}
                    action={
                      integrations.some((i) => i.status === "connected") ? (
                        <Button size="sm" loading={sync.isPending} onClick={() => sync.mutate()}>
                          <ArrowsClockwise size={13} weight="bold" /> Sync now
                        </Button>
                      ) : undefined
                    }
                  />
                )}
              </Card>
              <div className="lg:sticky lg:top-4">
                {selected ? (
                  (() => {
                    const ra = replyAvailability(selected);
                    return <Detail key={selected.id} projectId={projectId} item={selected} canReply={ra.ok} replyNote={ra.note} />;
                  })()
                ) : (
                  !isLoading && (
                    <Card>
                      <Empty icon={<CheckCircle size={18} />} title="Select a comment" description="Its full text, classification and reply editor appear here." />
                    </Card>
                  )
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <AutoReplyCard projectId={projectId} />
            <FeedbackCard projectId={projectId} />
            <p className="text-[11.5px] text-faint px-1 leading-relaxed flex gap-1.5">
              <Info size={12} className="shrink-0 mt-[2px]" />
              Comments are untrusted user content: SocialPilot never follows instructions inside them.
            </p>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
