import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, CheckCircle, Circle, CircleDashed, CircleNotch, Prohibit, Robot, SealCheck, Wrench, XCircle, ChatText, Warning, Lightning, X as XIcon, MinusCircle, PaperPlaneTilt, Sparkle } from "@phosphor-icons/react";
import { PageContainer } from "@/components/layout/AppShell";
import { Badge, Button, Card, ConfirmDialog, Empty, PageHeader, Select, SetupCallout, Skeleton, StatusBadge, Switch, Textarea } from "@/components/ui";
import { CommandBar, SectionTitle, useMeta } from "@/components/common";
import { api, p } from "@/lib/api";
import { ago, cn, fmtDate, fmtUsd, toastError } from "@/lib/utils";
import { JsonView, ListSkeleton, Pills, actorText, durationText, useParam } from "@/components/ops/shared";

type Task = {
  id: string;
  agentType: string;
  title: string;
  instruction: string;
  status: string;
  plan: { title: string; status: string; note?: string }[] | null;
  result: { summary?: string; completed?: string[]; outstanding?: string[] } | null;
  summary: string | null;
  error: string | null;
  costUsd: number;
  model: string | null;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  cancelRequested: boolean;
};
type Step = { id: string; seq: number; type: string; tool: string | null; input: any; output: any; status: string; createdAt: string };
type Approval = { id: string; type: string; title: string; status: string; createdAt: string };
type AgentCfg = { agentType: string; enabled: boolean; instructions: string; model: string | null };

const RUNNING = ["queued", "planning", "running"];
const FILTERS = [
  { value: "all", label: "All", q: "" },
  { value: "active", label: "Running", q: "queued,planning,running" },
  { value: "awaiting_approval", label: "Awaiting approval", q: "awaiting_approval" },
  { value: "completed", label: "Completed", q: "completed" },
  { value: "failed", label: "Failed", q: "failed" },
  { value: "cancelled", label: "Cancelled", q: "cancelled" },
] as const;
type FilterValue = (typeof FILTERS)[number]["value"];

export default function Agents() {
  const { projectId = "" } = useParams();
  const [taskId, setTaskId] = useParam("task");
  const [prompt, setPrompt] = useParam("prompt");
  const [agentParam] = useParam("agent");
  const [agentPrefill, setAgentPrefill] = React.useState("general");
  const topRef = React.useRef<HTMLDivElement>(null);
  const { data: meta } = useMeta();

  return (
    <PageContainer wide>
      <div ref={topRef} />
      <PageHeader eyebrow="Project" title="Agents & tasks" description="Give the AI real work. Every task runs with project-scoped tools, a visible plan and a full step log. Outbound actions go to the approval queue." />
      {prompt ? (
        <PrefilledCommand
          key={agentPrefill}
          projectId={projectId}
          initial={prompt}
          defaultAgent={agentParam ?? agentPrefill}
          onDismiss={() => setPrompt(null, { replace: true })}
          onCreated={(id) => {
            setPrompt(null, { replace: true });
            setTaskId(id);
          }}
        />
      ) : (
        <CommandBar key={agentPrefill} projectId={projectId} defaultAgent={agentPrefill} onCreated={(id) => setTaskId(id)} />
      )}

      <AgentRoster
        projectId={projectId}
        onAssign={(t) => {
          setAgentPrefill(t);
          topRef.current?.scrollIntoView({ behavior: "smooth" });
          toast(`Command bar set to ${meta?.agents[t]?.name ?? t}`);
        }}
      />

      <div className="mt-10 grid lg:grid-cols-[minmax(320px,400px)_1fr] gap-6 items-start">
        <TaskList projectId={projectId} selected={taskId} onSelect={(id) => setTaskId(id)} />
        <div className="min-w-0 lg:sticky lg:top-4">
          {taskId ? (
            <TaskDetail projectId={projectId} taskId={taskId} onClose={() => setTaskId(null)} />
          ) : (
            <Card>
              <Empty icon={<Robot size={18} />} title="Select a task" description="Pick a task to see its plan, live step log, cost and linked approvals." />
            </Card>
          )}
        </div>
      </div>
    </PageContainer>
  );
}

function AgentRoster({ projectId, onAssign }: { projectId: string; onAssign: (agentType: string) => void }) {
  const qc = useQueryClient();
  const { data: meta } = useMeta();
  const { data, isLoading } = useQuery({ queryKey: ["project", projectId, "agents"], queryFn: () => api.get<{ agents: AgentCfg[] }>(p(projectId, "/agents")) });
  const toggle = useMutation({
    mutationFn: (a: AgentCfg & { next: boolean }) => api.put(p(projectId, `/agents/${a.agentType}`), { enabled: a.next, instructions: a.instructions ?? "", model: a.model ?? null }),
    onSuccess: (_r, a) => {
      toast.success(`${meta?.agents[a.agentType]?.name ?? a.agentType} ${a.next ? "enabled" : "disabled"}`);
      qc.invalidateQueries({ queryKey: ["project", projectId, "agents"] });
    },
    onError: (e) => toastError(e),
  });
  return (
    <section className="mt-10">
      <SectionTitle action={<Link to={`/projects/${projectId}/settings`} className="text-[12px] text-muted hover:text-ink">Agent instructions →</Link>}>Agent roster</SectionTitle>
      {isLoading || !meta ? (
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {(data?.agents ?? []).map((a) => {
            const label = meta.agents[a.agentType];
            return (
              <Card key={a.agentType} className={cn("px-4 py-3.5 flex flex-col", !a.enabled && "opacity-60")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[13px] font-semibold text-ink">{label?.name ?? a.agentType}</div>
                  <Switch checked={a.enabled} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate({ ...a, next: v })} />
                </div>
                <p className="text-[12px] text-muted mt-1 line-clamp-2 flex-1">{label?.description}</p>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-[11px] text-faint">{a.instructions ? "Custom instructions" : a.model ? a.model : "Default config"}</span>
                  <Button size="sm" variant="ghost" disabled={!a.enabled} onClick={() => onAssign(a.agentType)}>
                    Assign task <ArrowRight size={12} />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TaskList({ projectId, selected, onSelect }: { projectId: string; selected: string | null; onSelect: (id: string) => void }) {
  const [filter, setFilter] = React.useState<FilterValue>("all");
  const { data: meta } = useMeta();
  const q = FILTERS.find((f) => f.value === filter)!.q;
  const { data, isLoading } = useQuery({
    queryKey: ["tasks", projectId, filter],
    queryFn: () => api.get<{ tasks: Task[] }>(p(projectId, `/tasks?limit=100${q ? `&status=${q}` : ""}`)),
    refetchInterval: (query) => ((query.state.data as { tasks: Task[] } | undefined)?.tasks.some((t) => RUNNING.includes(t.status)) ? 3000 : false),
  });
  return (
    <div className="min-w-0">
      <SectionTitle>Tasks</SectionTitle>
      <Pills value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f.value, label: f.label }))} className="mb-3" />
      {isLoading ? (
        <ListSkeleton rows={6} />
      ) : !data?.tasks.length ? (
        <Card>
          <Empty icon={<Lightning size={18} />} title="No tasks here" description={filter === "all" ? "Use the command bar above to start your first agent task." : "Nothing matches this filter."} />
        </Card>
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {data.tasks.map((t) => (
            <button key={t.id} onClick={() => onSelect(t.id)} className={cn("w-full text-left px-4 py-3 hover:bg-subtle transition-colors", selected === t.id && "bg-canvas")}>
              <div className="flex items-start gap-2">
                <TaskStatusIcon status={t.status} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-ink line-clamp-2">{t.title}</div>
                  <div className="text-[11.5px] text-muted mt-0.5 flex flex-wrap gap-x-2">
                    <span>{meta?.agents[t.agentType]?.name ?? t.agentType}</span>
                    <span>·</span>
                    <span>{ago(t.createdAt)}</span>
                    {t.costUsd > 0 && (
                      <>
                        <span>·</span>
                        <span className="tabular-nums">{fmtUsd(t.costUsd)}</span>
                      </>
                    )}
                    {t.createdBy !== "user" && (
                      <>
                        <span>·</span>
                        <span>{actorText(t.createdBy, meta?.agents)}</span>
                      </>
                    )}
                  </div>
                </div>
                <StatusBadge status={t.status} className="shrink-0" />
              </div>
            </button>
          ))}
        </Card>
      )}
    </div>
  );
}

function TaskStatusIcon({ status }: { status: string }) {
  const cls = "mt-0.5 shrink-0";
  if (RUNNING.includes(status)) return <CircleNotch size={15} className={cn(cls, "animate-spin text-blue-fg")} />;
  if (status === "completed") return <CheckCircle size={15} weight="fill" className={cn(cls, "text-green-fg")} />;
  if (status === "failed") return <XCircle size={15} weight="fill" className={cn(cls, "text-red-fg")} />;
  if (status === "awaiting_approval") return <SealCheck size={15} weight="fill" className={cn(cls, "text-yellow-fg")} />;
  return <Prohibit size={15} className={cn(cls, "text-faint")} />;
}

function TaskDetail({ projectId, taskId, onClose }: { projectId: string; taskId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: meta } = useMeta();
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["task", projectId, taskId],
    queryFn: () => api.get<{ task: Task & { steps: Step[] }; approvals: Approval[] }>(p(projectId, `/tasks/${taskId}`)),
    refetchInterval: (query) => {
      const s = (query.state.data as { task: Task } | undefined)?.task.status;
      return s && RUNNING.includes(s) ? 3000 : false;
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.post<{ cancelled: boolean }>(p(projectId, `/tasks/${taskId}/cancel`)),
    onSuccess: (r) => {
      setConfirmCancel(false);
      toast[r.cancelled ? "success" : "warning"](r.cancelled ? "Cancellation requested — the agent stops before its next tool call" : "Task is no longer running");
      qc.invalidateQueries({ queryKey: ["task"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e) => toastError(e),
  });

  // Keep the elapsed time ticking while running.
  const [, setTick] = React.useState(0);
  const running = !!data && RUNNING.includes(data.task.status);
  React.useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  if (isLoading)
    return (
      <Card className="p-5 space-y-3">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </Card>
    );
  if (error || !data)
    return (
      <Card className="p-5">
        <SetupCallout tone="red" title="Could not load task">
          {(error as Error)?.message}
        </SetupCallout>
      </Card>
    );

  const { task, approvals } = data;
  const steps = task.steps ?? [];
  const result = task.result;

  return (
    <Card className="overflow-hidden">
      <div className="px-5 pt-4 pb-4 border-b border-line">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <StatusBadge status={task.status} />
              <Badge tone="gray">{meta?.agents[task.agentType]?.name ?? task.agentType}</Badge>
              {task.cancelRequested && RUNNING.includes(task.status) && <Badge tone="yellow">Cancelling</Badge>}
            </div>
            <h2 className="text-[16px] font-semibold text-ink leading-snug">{task.title}</h2>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {running && (
              <Button size="sm" variant="danger-ghost" onClick={() => setConfirmCancel(true)} disabled={task.cancelRequested}>
                <Prohibit size={14} /> Cancel
              </Button>
            )}
            <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close">
              <XIcon size={14} />
            </Button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Meta label="Cost">{fmtUsd(task.costUsd)}</Meta>
          <Meta label="Model">{task.model ?? "—"}</Meta>
          <Meta label="Duration">{durationText(task.startedAt, task.finishedAt)}</Meta>
          <Meta label="Requested">{`${actorText(task.createdBy, meta?.agents)} · ${fmtDate(task.createdAt, "MMM d, HH:mm")}`}</Meta>
        </div>
      </div>

      <div className="px-5 py-4 space-y-6">
        <div>
          <SectionTitle>Instruction</SectionTitle>
          <p className="text-[13px] text-ink-2 whitespace-pre-wrap">{task.instruction}</p>
        </div>

        {task.error && (
          <SetupCallout tone="red" title="Task failed">
            <span className="break-words">{task.error}</span>
          </SetupCallout>
        )}

        {(result?.summary || task.summary) && (
          <div>
            <SectionTitle>Result</SectionTitle>
            <p className="text-[13px] text-ink-2 whitespace-pre-wrap">{result?.summary ?? task.summary}</p>
            {!!result?.completed?.length && (
              <div className="mt-3">
                <div className="text-[11.5px] text-muted font-medium mb-1">Completed</div>
                <ul className="space-y-1">
                  {result.completed.map((c, i) => (
                    <li key={i} className="flex gap-2 text-[12.5px] text-ink-2">
                      <CheckCircle size={14} weight="fill" className="text-green-fg mt-0.5 shrink-0" />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!!result?.outstanding?.length && (
              <div className="mt-3">
                <div className="text-[11.5px] text-muted font-medium mb-1">Outstanding</div>
                <ul className="space-y-1">
                  {result.outstanding.map((c, i) => (
                    <li key={i} className="flex gap-2 text-[12.5px] text-ink-2">
                      <Circle size={14} className="text-yellow-fg mt-0.5 shrink-0" />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {approvals.length > 0 && (
          <div>
            <SectionTitle action={<Link to={`/projects/${projectId}/approvals`} className="text-[12px] text-muted hover:text-ink">Open approvals →</Link>}>Linked approvals</SectionTitle>
            <div className="rounded-lg border border-line divide-y divide-line">
              {approvals.map((a) => (
                <Link key={a.id} to={`/projects/${projectId}/approvals`} className="flex items-center gap-2 px-3 py-2 hover:bg-subtle">
                  <Badge tone="purple">{a.type.replace(/_/g, " ")}</Badge>
                  <span className="text-[12.5px] text-ink flex-1 min-w-0 truncate">{a.title}</span>
                  <StatusBadge status={a.status} />
                </Link>
              ))}
            </div>
          </div>
        )}

        {task.plan && task.plan.length > 0 && (
          <div>
            <SectionTitle>Plan</SectionTitle>
            <ol className="space-y-1.5">
              {task.plan.map((s, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <PlanIcon status={s.status} />
                  <div className="min-w-0">
                    <span className={cn("text-[13px]", s.status === "done" ? "text-muted line-through decoration-line-strong" : s.status === "in_progress" ? "text-ink font-medium" : "text-ink-2")}>{s.title}</span>
                    {s.note && <div className="text-[12px] text-muted">{s.note}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div>
          <SectionTitle action={running ? <span className="text-[11.5px] text-blue-fg flex items-center gap-1"><CircleNotch size={12} className="animate-spin" /> Live</span> : undefined}>Step log</SectionTitle>
          {steps.length === 0 ? (
            <p className="text-[12.5px] text-muted">{task.status === "queued" ? "Waiting for a worker to pick up the task…" : "No steps recorded."}</p>
          ) : (
            <ol className="relative border-l border-line ml-2 space-y-3">
              {steps.map((s) => (
                <StepItem key={s.id} step={s} />
              ))}
            </ol>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this task?"
        description="The agent stops before its next tool call. Work already done (drafts, assets, approval requests) is kept."
        confirmLabel="Cancel task"
        danger
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />
    </Card>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted font-medium">{label}</div>
      <div className="text-[12.5px] text-ink tabular-nums truncate mt-0.5">{children}</div>
    </div>
  );
}

function PlanIcon({ status }: { status: string }) {
  const cls = "mt-0.5 shrink-0";
  switch (status) {
    case "done":
      return <CheckCircle size={15} weight="fill" className={cn(cls, "text-green-fg")} />;
    case "in_progress":
      return <CircleNotch size={15} className={cn(cls, "text-blue-fg animate-spin")} />;
    case "blocked":
      return <Warning size={15} weight="fill" className={cn(cls, "text-red-fg")} />;
    case "skipped":
      return <MinusCircle size={15} className={cn(cls, "text-faint")} />;
    default:
      return <CircleDashed size={15} className={cn(cls, "text-faint")} />;
  }
}

function StepItem({ step }: { step: Step }) {
  const dot = (cls: string, icon: React.ReactNode) => <span className={cn("absolute -left-[9px] top-0.5 h-[17px] w-[17px] rounded-full border flex items-center justify-center bg-surface", cls)}>{icon}</span>;
  const time = <span className="text-[11px] text-faint ml-auto shrink-0 tabular-nums">{fmtDate(step.createdAt, "HH:mm:ss")}</span>;

  if (step.type === "message") {
    const role = step.input?.role ?? step.output?.role;
    const text = step.input?.text ?? step.output?.text ?? "";
    return (
      <li className="pl-5 relative">
        {dot("border-line text-muted", <ChatText size={10} weight="bold" />)}
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[11.5px] font-medium text-muted">{role === "user" ? "Instruction" : "Agent"}</span>
          {time}
        </div>
        <p className={cn("text-[12.5px] whitespace-pre-wrap break-words", role === "user" ? "text-muted" : "text-ink-2")}>{text}</p>
      </li>
    );
  }
  if (step.type === "tool_call" || step.type === "tool_result") {
    const isResult = step.type === "tool_result";
    const failed = step.status === "error";
    return (
      <li className="pl-5 relative">
        {dot(failed ? "border-[#f3cfd1] text-red-fg" : isResult ? "border-[#cfe3cf] text-green-fg" : "border-line text-ink-2", failed ? <XIcon size={9} weight="bold" /> : isResult ? <CheckCircle size={10} weight="fill" /> : <Wrench size={10} weight="bold" />)}
        <div className="flex items-center gap-2">
          <span className={cn("text-[12px]", failed ? "text-red-fg" : "text-ink-2")}>{isResult ? (failed ? "Failed" : "Result") : "Call"}</span>
          <code className="font-mono text-[11.5px] rounded bg-canvas border border-line px-1.5 py-px text-ink">{step.tool}</code>
          {time}
        </div>
        {failed && step.output?.error && <p className="text-[12px] text-red-fg mt-1 break-words">{String(step.output.error)}</p>}
        <JsonView value={isResult ? step.output : step.input} label={isResult ? "Output" : "Input"} className="mt-1" />
      </li>
    );
  }
  if (step.type === "error") {
    return (
      <li className="pl-5 relative">
        {dot("border-[#f3cfd1] text-red-fg", <Warning size={10} weight="fill" />)}
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-red-fg">Error{step.output?.code ? ` · ${step.output.code}` : ""}</span>
          {time}
        </div>
        <p className="text-[12.5px] text-red-fg mt-0.5 break-words">{step.output?.error ?? "Unknown error"}</p>
      </li>
    );
  }
  if (step.type === "summary") {
    return (
      <li className="pl-5 relative">
        {dot("border-ink bg-ink text-white", <CheckCircle size={10} weight="fill" />)}
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-ink">Finished</span>
          {time}
        </div>
        <p className="text-[12.5px] text-ink-2 mt-0.5 whitespace-pre-wrap">{step.output?.summary}</p>
      </li>
    );
  }
  return (
    <li className="pl-5 relative">
      {dot("border-line text-muted", <Circle size={8} weight="fill" />)}
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-muted">{step.type}</span>
        {time}
      </div>
      <JsonView value={step.output ?? step.input} className="mt-1" />
    </li>
  );
}

const AGENT_TYPES = ["general", "marketing_strategy", "trend_research", "content_creation", "image_editing", "video_creation", "social_publishing", "community_management", "website_audit", "website_code", "analytics", "growth_experiments"];

/** Command input prefilled from ?prompt= (deep links from other pages). Creates a real task via POST /tasks. */
function PrefilledCommand({ projectId, initial, defaultAgent, onCreated, onDismiss }: { projectId: string; initial: string; defaultAgent: string; onCreated: (id: string) => void; onDismiss: () => void }) {
  const qc = useQueryClient();
  const { data: meta } = useMeta();
  const [text, setText] = React.useState(initial);
  const [agent, setAgent] = React.useState(AGENT_TYPES.includes(defaultAgent) ? defaultAgent : "general");
  const create = useMutation({
    mutationFn: () => api.post<{ task: { id: string } }>(p(projectId, "/tasks"), { instruction: text.trim(), agentType: agent }),
    onSuccess: (r) => {
      toast.success("Task started");
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onCreated(r.task.id);
    },
    onError: (e) => toastError(e),
  });
  const ok = text.trim().length >= 3;
  return (
    <div className="rounded-xl border border-ink/30 bg-surface">
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
        <span className="text-[11.5px] text-muted">Prefilled instruction — review and edit before running</span>
        <Button size="icon-sm" variant="ghost" onClick={onDismiss} aria-label="Discard prefilled instruction">
          <XIcon size={13} />
        </Button>
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
        className="border-0 focus:ring-0 resize-none bg-transparent min-h-[88px]"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ok) create.mutate();
        }}
      />
      <div className="flex items-center gap-2 px-3 pb-2.5">
        <Sparkle size={14} className="text-muted" weight="fill" />
        <Select value={agent} onChange={(e) => setAgent(e.target.value)} className="h-7 w-auto text-[12px] py-0">
          {AGENT_TYPES.map((a) => (
            <option key={a} value={a}>
              {a === "general" ? "Operator (all agents)" : meta?.agents[a]?.name ?? a}
            </option>
          ))}
        </Select>
        <div className="flex-1" />
        <Button variant="primary" size="sm" loading={create.isPending} disabled={!ok} onClick={() => create.mutate()}>
          <PaperPlaneTilt size={13} weight="fill" /> Run
        </Button>
      </div>
    </div>
  );
}
