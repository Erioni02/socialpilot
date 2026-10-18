import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, CaretDown, CheckCircle, Clock, Lightning, MinusCircle, Play, Plus, Trash, XCircle, Warning, ShieldCheck, FloppyDisk, Sparkle } from "@phosphor-icons/react";
import { PageContainer } from "@/components/layout/AppShell";
import { Badge, Button, Card, Checkbox, ConfirmDialog, Empty, Field, Input, PageHeader, Popover, PopoverContent, PopoverTrigger, Select, SetupCallout, Skeleton, StatusBadge, Switch, Textarea } from "@/components/ui";
import { PlatformIcon, SectionTitle, useMe, useMeta, useProject } from "@/components/common";
import { api, p } from "@/lib/api";
import { ago, cn, fmtDate, fmtUsd, toastError } from "@/lib/utils";
import { ListSkeleton, durationText, useParam } from "@/components/ops/shared";
import { CRON_PRESETS, STEP_META, STEP_TYPES, defaultConfig, describeTrigger, type StepField } from "@/components/ops/automationSteps";

type Step = { id: string; type: string; config: Record<string, any> };
type Trigger = { type: "cron" | "manual"; cron?: string; timezone: string };
type Draft = { name: string; description: string; trigger: Trigger; steps: Step[]; active: boolean; allowAutoPublish: boolean };
type Run = { id: string; status: string; trigger: string; log: { step: string; type: string; status: "ok" | "error" | "skipped"; message: string; at: string }[]; error: string | null; startedAt: string; finishedAt: string | null };
type Automation = Draft & { id: string; lastRunAt: string | null; nextRunAt: string | null; createdAt: string; updatedAt: string; runs: Run[] };

const PHRASE = "ALLOW AUTO PUBLISH";
const PLATFORMS = ["x", "instagram", "tiktok"] as const;
const AGENTS = ["general", "marketing_strategy", "trend_research", "content_creation", "image_editing", "video_creation", "social_publishing", "community_management", "website_audit", "website_code", "analytics", "growth_experiments"];
const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const browserTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};
const TIMEZONES: string[] = (() => {
  try {
    return ((Intl as any).supportedValuesOf?.("timeZone") as string[]) ?? [];
  } catch {
    return [];
  }
})();

function toDraft(a: Partial<Draft>, tz: string): Draft {
  return {
    name: a.name ?? "",
    description: a.description ?? "",
    trigger: { type: a.trigger?.type ?? "manual", cron: a.trigger?.cron, timezone: a.trigger?.timezone || tz },
    steps: (a.steps ?? []).map((s) => ({ id: s.id || newId(), type: s.type, config: { ...(s.config ?? {}) } })),
    active: a.active ?? false,
    allowAutoPublish: a.allowAutoPublish ?? false,
  };
}

export default function Automations() {
  const { projectId = "" } = useParams();
  const [sel, setSel] = useParam("automation");
  const { data: me } = useMe();
  const { data: proj } = useProject(projectId);
  const tz = proj?.project?.timezone || browserTz();
  const { data, isLoading } = useQuery({ queryKey: ["automations", projectId], queryFn: () => api.get<{ automations: Automation[]; templates: Draft[] }>(p(projectId, "/automations")) });
  const [seed, setSeed] = React.useState<{ key: number; draft: Draft } | null>(null);

  const automations = data?.automations ?? [];
  const selected = sel && sel !== "new" ? automations.find((a) => a.id === sel) : undefined;

  const startNew = (from?: Draft) => {
    setSeed({ key: Date.now(), draft: toDraft(from ? { ...from, active: false, allowAutoPublish: false } : { name: "", steps: [], trigger: { type: "manual", timezone: tz } }, tz) });
    setSel("new");
  };

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Project"
        title="Automations"
        description="Chain real steps into a pipeline that runs on a schedule or on demand. Every step honours project permissions, limits, budgets and the emergency stop."
        actions={
          <Button variant="primary" onClick={() => startNew()}>
            <Plus size={14} weight="bold" /> New automation
          </Button>
        }
      />

      {me?.emergencyStop && (
        <div className="mb-6">
          <SetupCallout tone="red" title="Emergency stop is active">
            All automations are paused and runs are skipped until operations are resumed from the top bar.
          </SetupCallout>
        </div>
      )}

      <div className="grid lg:grid-cols-[300px_1fr] gap-6 items-start">
        <aside className="space-y-6 min-w-0">
          <div>
            <SectionTitle>Your automations</SectionTitle>
            {isLoading ? (
              <ListSkeleton rows={3} />
            ) : !automations.length ? (
              <Card>
                <Empty icon={<Lightning size={18} />} title="No automations yet" description="Start from the morning autopilot template or build your own." className="py-8" />
              </Card>
            ) : (
              <Card className="divide-y divide-line overflow-hidden">
                {automations.map((a) => {
                  const last = a.runs?.[0];
                  return (
                    <button key={a.id} onClick={() => setSel(a.id)} className={cn("w-full text-left px-4 py-3 hover:bg-subtle", sel === a.id && "bg-canvas")}>
                      <div className="flex items-center gap-2">
                        <span className={cn("h-2 w-2 rounded-full shrink-0", a.active ? "bg-green-fg" : "bg-line-strong")} />
                        <span className="text-[13px] font-medium text-ink truncate flex-1">{a.name}</span>
                        {a.allowAutoPublish && <Badge tone="red">Auto</Badge>}
                      </div>
                      <div className="text-[11.5px] text-muted mt-1 pl-4">{describeTrigger(a.trigger)}</div>
                      <div className="text-[11.5px] text-muted mt-0.5 pl-4 flex flex-wrap gap-x-2 items-center">
                        {a.active && a.nextRunAt && <span>Next {ago(a.nextRunAt)}</span>}
                        {last ? (
                          <span className="inline-flex items-center gap-1">
                            Last run {ago(last.startedAt)} <StatusBadge status={last.status} />
                          </span>
                        ) : (
                          <span>Never run</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </Card>
            )}
          </div>

          <div>
            <SectionTitle>Templates</SectionTitle>
            {isLoading ? (
              <Skeleton className="h-28 rounded-xl" />
            ) : (
              (data?.templates ?? []).map((t) => (
                <Card key={t.name} className="px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <Sparkle size={14} weight="fill" className="text-muted" />
                    <span className="text-[13px] font-semibold text-ink">{t.name}</span>
                  </div>
                  <p className="text-[12px] text-muted mt-1">{t.description}</p>
                  <div className="text-[11.5px] text-faint mt-2">
                    {t.steps.length} steps · {describeTrigger(t.trigger)}
                  </div>
                  <Button size="sm" className="mt-3 w-full" onClick={() => startNew(t)}>
                    Use template
                  </Button>
                </Card>
              ))
            )}
          </div>
        </aside>

        <div className="min-w-0">
          {sel === "new" ? (
            <Builder key={seed?.key ?? "new"} projectId={projectId} initial={seed?.draft ?? toDraft({}, tz)} onSaved={(id) => setSel(id, { replace: true })} onDeleted={() => setSel(null)} />
          ) : selected ? (
            <>
              <Builder key={selected.id} projectId={projectId} automation={selected} initial={toDraft(selected, tz)} onSaved={() => {}} onDeleted={() => setSel(null)} />
              <RunHistory projectId={projectId} automationId={selected.id} />
            </>
          ) : sel && !isLoading ? (
            <Card>
              <Empty title="Automation not found" description="It may have been deleted." />
            </Card>
          ) : (
            <Card>
              <Empty
                icon={<Lightning size={18} />}
                title="Select or create an automation"
                description="Automations draft content, sync data and run agents on a schedule. Outbound actions still follow your approval rules."
                action={
                  <Button variant="primary" onClick={() => startNew(data?.templates?.[0])} disabled={!data?.templates?.length}>
                    Start from the morning template
                  </Button>
                }
              />
            </Card>
          )}
        </div>
      </div>
    </PageContainer>
  );
}

function Builder({ projectId, automation, initial, onSaved, onDeleted }: { projectId: string; automation?: Automation; initial: Draft; onSaved: (id: string) => void; onDeleted: () => void }) {
  const qc = useQueryClient();
  const { data: proj } = useProject(projectId);
  const { data: me } = useMe();
  const [d, setD] = React.useState<Draft>(initial);
  const [dirty, setDirty] = React.useState(!automation);
  const [open, setOpen] = React.useState<string | null>(null);
  const [confirmation, setConfirmation] = React.useState<string>("");
  const [askPhrase, setAskPhrase] = React.useState<null | "enable" | "save">(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const update = (patch: Partial<Draft>) => {
    setD((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const setSteps = (fn: (s: Step[]) => Step[]) => update({ steps: fn(d.steps) });
  const insertStep = (type: string, at: number) => {
    const step = { id: newId(), type, config: defaultConfig(type) };
    setSteps((s) => [...s.slice(0, at), step, ...s.slice(at)]);
    setOpen(step.id);
  };
  const move = (i: number, dir: -1 | 1) =>
    setSteps((s) => {
      const n = [...s];
      const j = i + dir;
      if (j < 0 || j >= n.length) return s;
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });

  const save = useMutation({
    mutationFn: (conf?: string) => {
      const body = { ...d, trigger: d.trigger.type === "manual" ? { type: "manual", timezone: d.trigger.timezone } : d.trigger, ...(d.allowAutoPublish ? { confirmation: conf ?? confirmation } : {}) };
      return automation ? api.put<{ automation: Automation }>(p(projectId, `/automations/${automation.id}`), body) : api.post<{ automation: Automation }>(p(projectId, "/automations"), body);
    },
    onSuccess: (r) => {
      setDirty(false);
      toast.success(automation ? "Automation saved" : "Automation created");
      qc.invalidateQueries({ queryKey: ["automations", projectId] });
      onSaved(r.automation.id);
    },
    onError: (e) => toastError(e),
  });
  const run = useMutation({
    mutationFn: () => api.post<{ jobId: string }>(p(projectId, `/automations/${automation!.id}/run`)),
    onSuccess: () => {
      toast.success("Run started — progress appears in the run history");
      qc.invalidateQueries({ queryKey: ["automation-runs", projectId, automation!.id] });
    },
    onError: (e) => toastError(e),
  });
  const del = useMutation({
    mutationFn: () => api.del(p(projectId, `/automations/${automation!.id}`)),
    onSuccess: () => {
      setConfirmDelete(false);
      toast.success("Automation deleted");
      qc.invalidateQueries({ queryKey: ["automations", projectId] });
      onDeleted();
    },
    onError: (e) => toastError(e),
  });

  const problems: string[] = [];
  if (!d.name.trim()) problems.push("Add a name");
  if (!d.steps.length) problems.push("Add at least one step");
  if (d.trigger.type === "cron" && !d.trigger.cron?.trim()) problems.push("Enter a cron expression");
  const agentStepMissing = d.steps.some((s) => s.type === "agent_task" && !String(s.config.instruction ?? "").trim());
  if (agentStepMissing) problems.push("Agent task steps need an instruction");

  const trySave = () => {
    if (d.allowAutoPublish && confirmation !== PHRASE) setAskPhrase("save");
    else save.mutate(undefined);
  };

  const policy = proj?.policy;
  const limits = policy?.limits;
  const publishEff = proj?.effective?.publish;
  const hasOutbound = d.steps.some((s) => STEP_META[s.type]?.outbound);

  return (
    <div className="space-y-6">
      <Card>
        <div className="px-5 py-4 border-b border-line flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-[240px] space-y-2">
            <Input value={d.name} onChange={(e) => update({ name: e.target.value })} placeholder="Automation name" className="text-[15px] font-semibold h-9" maxLength={200} />
            <Textarea value={d.description} onChange={(e) => update({ description: e.target.value })} placeholder="What does this automation do? (optional)" className="min-h-[44px] text-[12.5px]" maxLength={2000} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {automation && (
              <>
                <Button size="sm" onClick={() => run.mutate()} loading={run.isPending} disabled={dirty || !!me?.emergencyStop}>
                  <Play size={13} weight="fill" /> Run now
                </Button>
                <Button size="icon-sm" variant="danger-ghost" onClick={() => setConfirmDelete(true)} aria-label="Delete automation">
                  <Trash size={14} />
                </Button>
              </>
            )}
            <Button size="sm" variant="primary" onClick={trySave} loading={save.isPending} disabled={problems.length > 0 || (!dirty && !!automation)}>
              <FloppyDisk size={13} weight="bold" /> {automation ? "Save" : "Create"}
            </Button>
          </div>
        </div>
        {(dirty || problems.length > 0) && (
          <div className="px-5 py-2 border-b border-line bg-subtle text-[12px] text-muted flex flex-wrap gap-x-3">
            {dirty && automation && <span className="text-yellow-fg">Unsaved changes{automation ? " — save before running" : ""}</span>}
            {problems.map((x) => (
              <span key={x}>· {x}</span>
            ))}
          </div>
        )}

        <div className="grid xl:grid-cols-[1fr_300px]">
          {/* Canvas */}
          <div className="px-5 py-6 bg-[radial-gradient(circle,_#e7e6e2_1px,_transparent_1px)] [background-size:16px_16px] min-w-0">
            <div className="max-w-[560px] mx-auto">
              <TriggerNode trigger={d.trigger} active={d.active} onChange={(t) => update({ trigger: t })} onActive={(v) => update({ active: v })} />
              {d.steps.map((s, i) => (
                <React.Fragment key={s.id}>
                  <Connector onInsert={(type) => insertStep(type, i)} />
                  <StepNode
                    index={i}
                    step={s}
                    total={d.steps.length}
                    open={open === s.id}
                    autoPublish={d.allowAutoPublish}
                    onToggle={() => setOpen(open === s.id ? null : s.id)}
                    onMove={(dir) => move(i, dir)}
                    onRemove={() => setSteps((x) => x.filter((y) => y.id !== s.id))}
                    onConfig={(config) => setSteps((x) => x.map((y) => (y.id === s.id ? { ...y, config } : y)))}
                  />
                </React.Fragment>
              ))}
              <Connector onInsert={(type) => insertStep(type, d.steps.length)} last label={d.steps.length ? "Add step" : "Add the first step"} />
            </div>
          </div>

          {/* Side panel: safety */}
          <div className="border-t xl:border-t-0 xl:border-l border-line px-5 py-5 space-y-5">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-ink">Allow automatic publishing</span>
                <Switch checked={d.allowAutoPublish} onCheckedChange={(v) => (v ? setAskPhrase("enable") : update({ allowAutoPublish: false }))} />
              </div>
              <p className="text-[12px] text-muted mt-1.5">
                Off: every post this automation schedules goes to the approval queue. On: scheduled posts follow the project's own rules — they still respect permissions, daily limits and publishing hours, and still need approval unless the project is at autonomy level 4 with publish approvals turned off.
              </p>
              {d.allowAutoPublish && publishEff && (
                <p className={cn("text-[12px] mt-1.5", publishEff.allowed && !publishEff.requiresApproval ? "text-red-fg" : "text-ink-2")}>
                  {!publishEff.allowed ? `Publishing is currently blocked: ${publishEff.reason ?? "permission disabled"}.` : publishEff.requiresApproval ? "With current project settings, posts will still require approval." : "With current project settings, posts will publish without approval."}
                </p>
              )}
              {hasOutbound && !d.allowAutoPublish && (
                <p className="text-[12px] text-green-fg mt-1.5 flex items-center gap-1">
                  <ShieldCheck size={13} weight="fill" /> Outbound steps will request approval.
                </p>
              )}
            </div>

            <div>
              <SectionTitle action={<Link to={`/projects/${projectId}/settings`} className="text-[12px] text-muted hover:text-ink">Edit →</Link>}>Project limits</SectionTitle>
              {!policy ? (
                <Skeleton className="h-28" />
              ) : (
                <dl className="text-[12.5px] space-y-1.5">
                  <LimitRow label="Autonomy level">{policy.autonomyLevel}</LimitRow>
                  <LimitRow label="Posts per day">{limits?.dailyPosts ?? "—"}</LimitRow>
                  <LimitRow label="Replies per day">{limits?.dailyReplies ?? "—"}</LimitRow>
                  <LimitRow label="AI spend per day">{limits ? fmtUsd(limits.dailyAiSpendUsd) : "—"}</LimitRow>
                  <LimitRow label="Publishing hours">{limits?.publishHours ? `${String(limits.publishHours.start).padStart(2, "0")}:00–${String(limits.publishHours.end).padStart(2, "0")}:00` : "—"}</LimitRow>
                  <LimitRow label="Publish approval">{policy.approvals?.publish ? "Required" : "Off"}</LimitRow>
                  {!!limits?.allowedTopics?.length && <LimitRow label="Allowed topics">{limits.allowedTopics.join(", ")}</LimitRow>}
                  {!!limits?.blockedTopics?.length && <LimitRow label="Blocked topics">{limits.blockedTopics.join(", ")}</LimitRow>}
                </dl>
              )}
            </div>

            {automation && (
              <div className="text-[12px] text-muted space-y-1 border-t border-line pt-4">
                <div>Created {fmtDate(automation.createdAt)}</div>
                <div>Last run {automation.lastRunAt ? ago(automation.lastRunAt) : "never"}</div>
                <div>Next run {automation.active && automation.nextRunAt ? fmtDate(automation.nextRunAt) : automation.active ? "—" : "inactive"}</div>
              </div>
            )}
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={!!askPhrase}
        onOpenChange={(o) => !o && setAskPhrase(null)}
        title="Allow automatic publishing?"
        description="Posts scheduled by this automation will no longer be forced into the approval queue. They still respect project permissions, daily limits, publishing hours and approval rules — approval is only skipped when the project is at autonomy level 4 with publish approvals off."
        confirmLabel={askPhrase === "save" ? "Confirm and save" : "Allow"}
        danger
        phrase={PHRASE}
        onConfirm={() => {
          setConfirmation(PHRASE);
          if (askPhrase === "enable") update({ allowAutoPublish: true });
          else save.mutate(PHRASE);
          setAskPhrase(null);
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${automation?.name}”?`}
        description="The automation and its run history are removed. Drafts and posts it created are kept."
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={() => del.mutate()}
      />
    </div>
  );
}

function LimitRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink text-right tabular-nums min-w-0 break-words">{children}</dd>
    </div>
  );
}

function TriggerNode({ trigger, active, onChange, onActive }: { trigger: Trigger; active: boolean; onChange: (t: Trigger) => void; onActive: (v: boolean) => void }) {
  const isPreset = CRON_PRESETS.some((p) => p.cron === trigger.cron);
  return (
    <div className="rounded-xl border border-ink/80 bg-surface shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-line">
        <div className="h-7 w-7 rounded-md bg-ink text-white flex items-center justify-center">
          <Clock size={14} weight="bold" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-ink">Trigger</div>
          <div className="text-[11.5px] text-muted">{describeTrigger(trigger)}</div>
        </div>
        <Switch checked={active} onCheckedChange={onActive} label={<span className="text-[12px] text-ink-2">{active ? "Active" : "Inactive"}</span>} />
      </div>
      <div className="px-4 py-3 space-y-3">
        <div className="inline-flex rounded-md border border-line p-0.5 bg-subtle">
          {(["manual", "cron"] as const).map((t) => (
            <button
              key={t}
              onClick={() => onChange({ ...trigger, type: t, cron: t === "cron" ? trigger.cron || CRON_PRESETS[0]!.cron : trigger.cron })}
              className={cn("px-3 h-7 rounded-[5px] text-[12px] font-medium", trigger.type === t ? "bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-muted hover:text-ink")}
            >
              {t === "manual" ? "Manual" : "Schedule"}
            </button>
          ))}
        </div>
        {trigger.type === "cron" ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {CRON_PRESETS.map((p) => (
                <button
                  key={p.cron}
                  onClick={() => onChange({ ...trigger, cron: p.cron })}
                  className={cn("h-7 px-2.5 rounded-full border text-[12px]", trigger.cron === p.cron ? "bg-ink text-white border-ink" : "border-line text-ink-2 hover:border-line-strong")}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <Field label="Cron expression" hint={isPreset ? "Preset selected — edit for a custom schedule" : "minute hour day month weekday · min. 15 minutes apart"}>
                <Input value={trigger.cron ?? ""} onChange={(e) => onChange({ ...trigger, cron: e.target.value })} className="font-mono text-[12px]" placeholder="0 8 * * *" />
              </Field>
              <Field label="Timezone">
                <Input value={trigger.timezone} onChange={(e) => onChange({ ...trigger, timezone: e.target.value })} list="sp-timezones" placeholder="UTC" />
                <datalist id="sp-timezones">
                  {TIMEZONES.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </Field>
            </div>
            {!active && <p className="text-[12px] text-yellow-fg">Inactive automations don't run on schedule. Turn on “Active” and save.</p>}
          </>
        ) : (
          <p className="text-[12px] text-muted">Runs only when you click “Run now”.</p>
        )}
      </div>
    </div>
  );
}

function Connector({ onInsert, last, label }: { onInsert: (type: string) => void; last?: boolean; label?: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex flex-col items-center">
      <div className="w-px h-4 bg-line-strong" />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {last ? (
            <button className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-dashed border-line-strong bg-surface text-[12px] text-ink-2 hover:border-ink hover:text-ink">
              <Plus size={12} weight="bold" /> {label}
            </button>
          ) : (
            <button className="h-5 w-5 rounded-full border border-line-strong bg-surface text-muted hover:text-ink hover:border-ink flex items-center justify-center" aria-label="Insert step">
              <Plus size={10} weight="bold" />
            </button>
          )}
        </PopoverTrigger>
        <PopoverContent align="center" className="w-[340px] p-1.5 max-h-[420px] overflow-y-auto scrollbar-thin">
          {Array.from(new Set(STEP_TYPES.map((s) => s.group))).map((g) => (
            <div key={g} className="mb-1">
              <div className="px-2 pt-1.5 pb-1 text-[10.5px] uppercase tracking-[0.08em] text-muted font-medium">{g}</div>
              {STEP_TYPES.filter((s) => s.group === g).map((s) => (
                <button
                  key={s.type}
                  onClick={() => {
                    onInsert(s.type);
                    setOpen(false);
                  }}
                  className="w-full text-left rounded-md px-2 py-1.5 hover:bg-canvas"
                >
                  <div className="text-[12.5px] font-medium text-ink flex items-center gap-1.5">
                    {s.label}
                    {s.outbound && <Badge tone="yellow">outbound</Badge>}
                  </div>
                  <div className="text-[11.5px] text-muted line-clamp-2">{s.description}</div>
                </button>
              ))}
            </div>
          ))}
        </PopoverContent>
      </Popover>
      {!last && <div className="w-px h-4 bg-line-strong" />}
    </div>
  );
}

function configSummary(step: Step): string {
  const c = step.config ?? {};
  switch (step.type) {
    case "find_opportunities":
      return `${c.count ?? 5} opportunities`;
    case "create_drafts":
      return `${c.count ?? 3} drafts · ${((c.platforms as string[]) ?? ["x"]).join(", ")}`;
    case "generate_media":
      return `up to ${c.maxImages ?? 2} images`;
    case "schedule_drafts":
      return `start in ${c.startInHours ?? 3}h, every ${c.spacingHours ?? 4}h`;
    case "agent_task":
      return c.instruction ? `“${String(c.instruction).slice(0, 60)}${String(c.instruction).length > 60 ? "…" : ""}”` : "No instruction yet";
    default:
      return "";
  }
}

function StepNode({
  index,
  step,
  total,
  open,
  autoPublish,
  onToggle,
  onMove,
  onRemove,
  onConfig,
}: {
  index: number;
  step: Step;
  total: number;
  open: boolean;
  autoPublish: boolean;
  onToggle: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onConfig: (c: Record<string, any>) => void;
}) {
  const meta = STEP_META[step.type];
  const summary = configSummary(step);
  return (
    <div className={cn("rounded-xl border bg-surface transition-colors", open ? "border-ink/50" : "border-line hover:border-line-strong")}>
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <span className="h-6 w-6 rounded-md bg-canvas border border-line text-[11px] font-semibold text-ink-2 flex items-center justify-center shrink-0 tabular-nums">{index + 1}</span>
        <button onClick={onToggle} className="flex-1 min-w-0 text-left">
          <div className="text-[13px] font-medium text-ink flex items-center gap-1.5">
            {meta?.label ?? step.type}
            {meta?.outbound && <Badge tone={autoPublish ? "red" : "yellow"}>{autoPublish ? "auto" : "approval"}</Badge>}
          </div>
          {summary && <div className="text-[11.5px] text-muted truncate">{summary}</div>}
        </button>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button size="icon-sm" variant="ghost" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up">
            <ArrowUp size={13} />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => onMove(1)} disabled={index === total - 1} aria-label="Move down">
            <ArrowDown size={13} />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={onToggle} aria-label="Configure">
            <CaretDown size={13} className={cn("transition-transform", open && "rotate-180")} />
          </Button>
          <Button size="icon-sm" variant="danger-ghost" onClick={onRemove} aria-label="Remove step">
            <Trash size={13} />
          </Button>
        </div>
      </div>
      {open && (
        <div className="px-3.5 pb-3.5 pt-1 border-t border-line">
          <p className="text-[12px] text-muted mt-2">{meta?.description}</p>
          {meta?.fields.length ? (
            <div className="grid sm:grid-cols-2 gap-3 mt-3">
              {meta.fields.map((f) => (
                <StepFieldInput key={f.key} field={f} value={step.config[f.key]} onChange={(v) => onConfig({ ...step.config, [f.key]: v })} />
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-faint mt-2">No configuration needed.</p>
          )}
        </div>
      )}
    </div>
  );
}

function StepFieldInput({ field, value, onChange }: { field: StepField; value: any; onChange: (v: any) => void }) {
  const { data: meta } = useMeta();
  if (field.kind === "number")
    return (
      <Field label={field.label} hint={`${field.min}–${field.max}`}>
        <Input
          type="number"
          min={field.min}
          max={field.max}
          value={value ?? field.default}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange(Number.isFinite(n) ? Math.max(field.min, Math.min(field.max, n)) : field.default);
          }}
        />
      </Field>
    );
  if (field.kind === "platforms") {
    const sel: string[] = Array.isArray(value) ? value : field.default;
    return (
      <Field label={field.label} className="sm:col-span-2">
        <div className="flex flex-wrap gap-4">
          {PLATFORMS.map((pl) => (
            <Checkbox
              key={pl}
              checked={sel.includes(pl)}
              onCheckedChange={(v) => onChange(v ? [...sel, pl] : sel.filter((x) => x !== pl))}
              label={
                <span className="inline-flex items-center gap-1">
                  <PlatformIcon platform={pl} size={13} /> {pl === "x" ? "X" : pl === "instagram" ? "Instagram" : "TikTok"}
                </span>
              }
            />
          ))}
        </div>
      </Field>
    );
  }
  if (field.kind === "textarea")
    return (
      <Field label={field.label} className="sm:col-span-2">
        <Textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} maxLength={4000} />
      </Field>
    );
  return (
    <Field label={field.label}>
      <Select value={value ?? field.default} onChange={(e) => onChange(e.target.value)}>
        {AGENTS.map((a) => (
          <option key={a} value={a}>
            {meta?.agents[a]?.name ?? a}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function RunHistory({ projectId, automationId }: { projectId: string; automationId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["automation-runs", projectId, automationId],
    queryFn: () => api.get<{ runs: Run[] }>(p(projectId, `/automations/${automationId}/runs`)),
    refetchInterval: (q) => ((q.state.data as { runs: Run[] } | undefined)?.runs.some((r) => r.status === "running") ? 3000 : false),
  });
  const [openId, setOpenId] = React.useState<string | null>(null);
  const runs = data?.runs ?? [];
  const expanded = openId ?? runs[0]?.id ?? null;
  return (
    <section className="mt-8">
      <SectionTitle>Run history</SectionTitle>
      {isLoading ? (
        <ListSkeleton rows={3} />
      ) : !runs.length ? (
        <Card>
          <Empty title="No runs yet" description="Click “Run now” or activate a schedule." className="py-8" />
        </Card>
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {runs.map((r) => {
            const isOpen = expanded === r.id;
            const counts = { ok: r.log.filter((l) => l.status === "ok").length, error: r.log.filter((l) => l.status === "error").length };
            return (
              <div key={r.id}>
                <button onClick={() => setOpenId(isOpen ? "__none" : r.id)} className="w-full text-left px-4 py-3 flex flex-wrap items-center gap-3 hover:bg-subtle">
                  <StatusBadge status={r.status} />
                  <span className="text-[12.5px] text-ink">{fmtDate(r.startedAt)}</span>
                  <span className="text-[12px] text-muted">{r.trigger === "manual" ? "Manual" : "Scheduled"}</span>
                  <span className="text-[12px] text-muted tabular-nums">{durationText(r.startedAt, r.finishedAt)}</span>
                  <span className="flex-1" />
                  <span className="text-[12px] text-muted">
                    {counts.ok} ok{counts.error ? ` · ${counts.error} failed` : ""}
                  </span>
                  <CaretDown size={12} className={cn("text-muted transition-transform", isOpen && "rotate-180")} />
                </button>
                {isOpen && (
                  <div className="px-4 pb-4">
                    {r.error && <p className="text-[12.5px] text-red-fg mb-2">{r.error}</p>}
                    {r.log.length ? (
                      <ol className="space-y-1.5">
                        {r.log.map((l, i) => (
                          <li key={i} className="flex items-start gap-2 text-[12.5px]">
                            {l.status === "ok" ? (
                              <CheckCircle size={15} weight="fill" className="text-green-fg mt-px shrink-0" />
                            ) : l.status === "error" ? (
                              <XCircle size={15} weight="fill" className="text-red-fg mt-px shrink-0" />
                            ) : (
                              <MinusCircle size={15} className="text-faint mt-px shrink-0" />
                            )}
                            <span className="font-medium text-ink shrink-0">{STEP_META[l.type]?.label ?? l.type}</span>
                            <span className={cn("min-w-0 break-words", l.status === "error" ? "text-red-fg" : "text-ink-2")}>{l.message}</span>
                            <span className="ml-auto text-[11px] text-faint shrink-0 tabular-nums">{fmtDate(l.at, "HH:mm:ss")}</span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-[12.5px] text-muted flex items-center gap-1.5">{r.status === "running" ? <><Warning size={13} /> Running — steps appear as they finish.</> : "No step log recorded."}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </section>
  );
}
