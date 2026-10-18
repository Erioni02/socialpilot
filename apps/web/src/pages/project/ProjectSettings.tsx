import * as React from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { NotePencil, PushPin, PushPinSlash, Trash, Plus, Robot, Pause, Play } from "@phosphor-icons/react";
import { api, p } from "@/lib/api";
import { ago, cn, fmtNum, fmtUsd, titleCase, toastError } from "@/lib/utils";
import { PageContainer } from "@/components/layout/AppShell";
import { SectionTitle, useMeta, useProject } from "@/components/common";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  Empty,
  Field,
  Input,
  PageHeader,
  Progress,
  SetupCallout,
  Skeleton,
  Switch,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Td,
  Textarea,
  Th,
} from "@/components/ui";
import { ProfileEditor, profileFromProject, profilePayload, type ProfileValue } from "@/components/projects/ProfileEditor";
import { PolicyEditor } from "@/components/projects/PolicyEditor";
import { AiConfigEditor } from "@/components/projects/Providers";

// ───────────── Profile ─────────────
function ProfileTab({ project }: { project: any }) {
  const qc = useQueryClient();
  const [value, setValue] = React.useState<ProfileValue>(() => profileFromProject(project));
  const [dirty, setDirty] = React.useState(false);
  React.useEffect(() => {
    if (!dirty) setValue(profileFromProject(project));
  }, [project.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => api.patch(p(project.id), profilePayload(value)),
    onSuccess: () => {
      setDirty(false);
      toast.success("Profile saved");
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e) => toastError(e),
  });
  const src = project.profileSource as string | null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        Profile source:
        <Badge tone={src === "ai" ? "purple" : src === "heuristic" ? "yellow" : "gray"}>{src === "ai" ? "AI proposal, confirmed" : src === "heuristic" ? "Heuristic extraction" : src === "manual" ? "Manual" : "Not set"}</Badge>
        <span className="text-faint">· updated {ago(project.updatedAt)}</span>
      </div>
      <Card className="p-5 sm:p-6">
        <ProfileEditor
          value={value}
          onChange={(v) => {
            setValue(v);
            setDirty(true);
          }}
        />
      </Card>
      <div className="sticky bottom-0 -mx-1 px-1 py-3 bg-canvas/90 backdrop-blur flex items-center justify-end gap-2">
        {dirty && <span className="text-[12px] text-muted mr-auto">Unsaved changes</span>}
        {dirty && (
          <Button
            variant="ghost"
            onClick={() => {
              setValue(profileFromProject(project));
              setDirty(false);
            }}
          >
            Discard
          </Button>
        )}
        <Button variant="primary" loading={save.isPending} disabled={!dirty || !value.name.trim()} onClick={() => save.mutate()}>
          Save profile
        </Button>
      </div>
    </div>
  );
}

// ───────────── Permissions ─────────────
function PauseCard({ project }: { project: any }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (paused: boolean) => api.put(p(project.id, "/paused"), { paused }),
    onSuccess: (_r, paused) => {
      toast.success(paused ? "Project paused" : "Project resumed");
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["dashboard", project.id] });
    },
    onError: (e) => toastError(e),
  });
  return (
    <Card className={cn("p-4 flex flex-wrap items-center gap-3", project.paused && "border-[#f0e2b6] bg-yellow-bg/40")}>
      {project.paused ? <Pause size={16} weight="fill" className="text-yellow-fg" /> : <Play size={16} weight="fill" className="text-muted" />}
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium text-ink">{project.paused ? "Project is paused" : "Project is active"}</div>
        <p className="text-[12px] text-muted">Pausing holds automations, scheduled publishing and agent actions for this project only. The global emergency stop is in the top bar.</p>
      </div>
      <Switch checked={!!project.paused} disabled={m.isPending} onCheckedChange={(v) => m.mutate(v)} label={<span className="text-[12.5px] text-ink-2">Paused</span>} />
    </Card>
  );
}

// ───────────── AI & budget ─────────────
type BudgetResp = {
  today: number;
  month: number;
  dailyLimit: number;
  monthlyLimit: number;
  taskLimit: number;
  last30Days: { provider: string; model: string; kind: string; _count: number; _sum: { costUsd: number | null; inputTokens: number | null; outputTokens: number | null; units: number | null } }[];
};

function BudgetCard({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({ queryKey: ["project", projectId, "budget"], queryFn: () => api.get<BudgetResp>(p(projectId, "/budget")) });
  if (isLoading || !data) return <Skeleton className="h-48" />;
  const rows = [...data.last30Days].sort((a, b) => (b._sum.costUsd ?? 0) - (a._sum.costUsd ?? 0));
  const total = rows.reduce((s, r) => s + (r._sum.costUsd ?? 0), 0);
  const bars = [
    { label: "Today", used: data.today, limit: data.dailyLimit },
    { label: "This month", used: data.month, limit: data.monthlyLimit },
  ];
  return (
    <Card>
      <CardHeader title="Budget usage" description="Recorded cost of AI and media calls made for this project." action={<Link to="?tab=permissions" className="text-[12px] text-muted hover:text-ink">Change limits</Link>} />
      <CardBody className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {bars.map((b) => {
            const v = b.limit > 0 ? (b.used / b.limit) * 100 : 0;
            return (
              <div key={b.label}>
                <div className="flex justify-between text-[12.5px] mb-1.5">
                  <span className="text-ink-2">{b.label}</span>
                  <span className="text-muted tabular-nums">
                    {fmtUsd(b.used)} of {fmtUsd(b.limit)}
                  </span>
                </div>
                <Progress value={v} tone={v >= 90 ? "red" : v >= 70 ? "yellow" : "ink"} />
              </div>
            );
          })}
        </div>
        <div>
          <div className="text-[12px] font-medium text-ink-2 mb-1">Last 30 days by model · {fmtUsd(total)}</div>
          {rows.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Provider</Th>
                  <Th>Model</Th>
                  <Th>Kind</Th>
                  <Th className="text-right">Calls</Th>
                  <Th className="text-right">Tokens in / out</Th>
                  <Th className="text-right">Units</Th>
                  <Th className="text-right">Cost</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.provider}-${r.model}-${r.kind}`}>
                    <Td>{titleCase(r.provider)}</Td>
                    <Td className="font-mono text-[12px]">{r.model}</Td>
                    <Td className="text-muted">{r.kind}</Td>
                    <Td className="text-right tabular-nums">{fmtNum(r._count)}</Td>
                    <Td className="text-right tabular-nums text-muted">
                      {fmtNum(r._sum.inputTokens ?? 0)} / {fmtNum(r._sum.outputTokens ?? 0)}
                    </Td>
                    <Td className="text-right tabular-nums text-muted">{r._sum.units ? fmtNum(r._sum.units) : "—"}</Td>
                    <Td className="text-right tabular-nums font-medium text-ink">{fmtUsd(r._sum.costUsd ?? 0)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="text-[12.5px] text-muted py-3">No AI usage recorded in the last 30 days.</p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

// ───────────── Agents ─────────────
type AgentCfg = { agentType: string; enabled: boolean; instructions: string; model: string | null };

function AgentRow({ projectId, cfg, textModels }: { projectId: string; cfg: AgentCfg; textModels: { id: string; label: string }[] }) {
  const { data: meta } = useMeta();
  const qc = useQueryClient();
  const [v, setV] = React.useState(cfg);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => setV(cfg), [cfg]);
  const dirty = v.enabled !== cfg.enabled || v.instructions !== cfg.instructions || (v.model ?? "") !== (cfg.model ?? "");
  const save = useMutation({
    mutationFn: (next: AgentCfg) => api.put(p(projectId, `/agents/${cfg.agentType}`), { enabled: next.enabled, instructions: next.instructions, model: next.model?.trim() ? next.model.trim() : null }),
    onSuccess: () => {
      toast.success(`${meta?.agents[cfg.agentType]?.name ?? cfg.agentType} saved`);
      qc.invalidateQueries({ queryKey: ["project", projectId, "agents"] });
    },
    onError: (e) => toastError(e),
  });
  const info = meta?.agents[cfg.agentType];
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start gap-3">
        <Robot size={16} className={cn("mt-0.5 shrink-0", v.enabled ? "text-ink-2" : "text-faint")} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("text-[13.5px] font-medium", v.enabled ? "text-ink" : "text-muted")}>{info?.name ?? titleCase(cfg.agentType)}</span>
            {cfg.model && <Badge tone="blue">{cfg.model}</Badge>}
            {cfg.instructions && <Badge>Custom instructions</Badge>}
          </div>
          <p className="text-[12px] text-muted">{info?.description}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
          <NotePencil size={13} /> {open ? "Close" : "Configure"}
        </Button>
        <Switch
          checked={v.enabled}
          disabled={save.isPending}
          onCheckedChange={(enabled) => {
            const next = { ...cfg, enabled };
            setV((s) => ({ ...s, enabled }));
            save.mutate(next);
          }}
        />
      </div>
      {open && (
        <div className="mt-3 ml-7 grid gap-3">
          <Field label="Custom instructions" hint="Added to this agent's system prompt for this project only.">
            <Textarea value={v.instructions} maxLength={5000} onChange={(e) => setV((s) => ({ ...s, instructions: e.target.value }))} placeholder="e.g. Always write in British English. Prefer short sentences." />
          </Field>
          <Field label="Model override" hint="Leave empty to use the project's text model.">
            <Input list={`agent-models-${cfg.agentType}`} value={v.model ?? ""} onChange={(e) => setV((s) => ({ ...s, model: e.target.value }))} placeholder="project default" className="font-mono text-[12.5px] max-w-sm" />
            <datalist id={`agent-models-${cfg.agentType}`}>
              {textModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </datalist>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={!dirty} onClick={() => setV(cfg)}>
              Reset
            </Button>
            <Button variant="primary" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate(v)}>
              Save agent
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AgentsTab({ projectId }: { projectId: string }) {
  const { data: meta } = useMeta();
  const { data, isLoading } = useQuery({ queryKey: ["project", projectId, "agents"], queryFn: () => api.get<{ agents: AgentCfg[] }>(p(projectId, "/agents")) });
  const textModels = React.useMemo(() => (meta ? Object.values(meta.aiProviders).flatMap((c: any) => c.models.filter((m: any) => m.kind === "text")) : []), [meta]);
  if (isLoading || !data) return <Skeleton className="h-96" />;
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-muted">Disabled agents are not used by the operator or automations. Every agent still follows the project's permissions and approvals.</p>
      <Card className="divide-y divide-line">
        {data.agents.map((a) => (
          <AgentRow key={a.agentType} projectId={projectId} cfg={a} textModels={textModels} />
        ))}
      </Card>
    </div>
  );
}

// ───────────── Notes ─────────────
type Note = { id: string; title: string; body: string; pinned: boolean; author: string; updatedAt: string };

function NoteEditor({ initial, onSave, onCancel, saving }: { initial?: Partial<Note>; onSave: (n: { title: string; body: string; pinned: boolean }) => void; onCancel?: () => void; saving?: boolean }) {
  const [title, setTitle] = React.useState(initial?.title ?? "");
  const [body, setBody] = React.useState(initial?.body ?? "");
  const [pinned, setPinned] = React.useState(initial?.pinned ?? false);
  return (
    <form
      className="space-y-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) onSave({ title: title.trim(), body, pinned });
      }}
    >
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title — e.g. Pricing & positioning" maxLength={200} autoFocus className="font-medium" />
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Facts, decisions, context the agents should always know." className="min-h-[120px]" />
      <div className="flex items-center gap-2">
        <Checkbox checked={pinned} onCheckedChange={setPinned} label={<span className="text-[12.5px] text-ink-2">Pin to top</span>} />
        <div className="flex-1" />
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" loading={saving} disabled={!title.trim()}>
          Save note
        </Button>
      </div>
    </form>
  );
}

function NotesTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const key = ["project", projectId, "notes"];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => api.get<{ notes: Note[] }>(p(projectId, "/notes")) });
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<Note | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const create = useMutation({
    mutationFn: (n: { title: string; body: string; pinned: boolean }) => api.post(p(projectId, "/notes"), n),
    onSuccess: () => {
      setCreating(false);
      toast.success("Note added");
      refresh();
    },
    onError: (e) => toastError(e),
  });
  const update = useMutation({
    mutationFn: ({ id, ...n }: { id: string; title?: string; body?: string; pinned?: boolean }) => api.patch(p(projectId, `/notes/${id}`), n),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
    onError: (e) => toastError(e),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(p(projectId, `/notes/${id}`)),
    onSuccess: () => {
      setDeleting(null);
      toast.success("Note deleted");
      refresh();
    },
    onError: (e) => toastError(e),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-muted max-w-xl">Persistent business context. Agents read these notes before every task — use them for facts, decisions and things to avoid.</p>
        {!creating && (
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus size={13} weight="bold" /> New note
          </Button>
        )}
      </div>
      {creating && (
        <Card className="p-4">
          <NoteEditor onSave={(n) => create.mutate(n)} onCancel={() => setCreating(false)} saving={create.isPending} />
        </Card>
      )}
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : !data?.notes.length ? (
        !creating && (
          <Card>
            <Empty icon={<NotePencil size={18} />} title="No notes yet" description="Add pricing, positioning, launch dates or anything else the AI should remember." />
          </Card>
        )
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.notes.map((n) => (
            <Card key={n.id} className="p-4 flex flex-col">
              {editing === n.id ? (
                <NoteEditor initial={n} onSave={(v) => update.mutate({ id: n.id, ...v })} onCancel={() => setEditing(null)} saving={update.isPending} />
              ) : (
                <>
                  <div className="flex items-start gap-2">
                    <h3 className="text-[13.5px] font-semibold text-ink flex-1">{n.title}</h3>
                    {n.pinned && <PushPin size={13} weight="fill" className="text-ink-2 mt-0.5" />}
                  </div>
                  <p className="text-[12.5px] text-ink-2 whitespace-pre-wrap mt-1.5 line-clamp-[10] flex-1">{n.body || <span className="text-faint">Empty</span>}</p>
                  <div className="flex items-center gap-1 mt-3 pt-2.5 border-t border-line">
                    <span className="text-[11px] text-faint flex-1">
                      {n.author === "user" ? "You" : titleCase(n.author.replace(/^agent:/, ""))} · {ago(n.updatedAt)}
                    </span>
                    <Button size="icon-sm" variant="ghost" onClick={() => update.mutate({ id: n.id, pinned: !n.pinned })} aria-label={n.pinned ? "Unpin" : "Pin"}>
                      {n.pinned ? <PushPinSlash size={13} /> : <PushPin size={13} />}
                    </Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => setEditing(n.id)} aria-label="Edit">
                      <NotePencil size={13} />
                    </Button>
                    <Button size="icon-sm" variant="danger-ghost" onClick={() => setDeleting(n)} aria-label="Delete">
                      <Trash size={13} />
                    </Button>
                  </div>
                </>
              )}
            </Card>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this note?"
        description={deleting ? `“${deleting.title}” will be removed permanently.` : undefined}
        confirmLabel="Delete note"
        danger
        loading={del.isPending}
        onConfirm={() => {
          if (deleting) del.mutate(deleting.id);
        }}
      />
    </div>
  );
}

// ───────────── Danger zone ─────────────
function DangerTab({ project }: { project: any }) {
  const [open, setOpen] = React.useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => api.del(p(project.id), { confirm: project.name }),
    onSuccess: () => {
      toast.success(`${project.name} deleted`);
      qc.removeQueries({ queryKey: ["project", project.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      navigate("/");
    },
    onError: (e) => toastError(e),
  });
  return (
    <Card className="border-[#f3cfd1]">
      <CardHeader title="Delete project" description="Removes the project with all its posts, assets, campaigns, tasks, notes and integrations. Published posts stay on the social platforms. This cannot be undone." />
      <CardBody>
        <Button variant="danger" onClick={() => setOpen(true)}>
          <Trash size={13} /> Delete {project.name}
        </Button>
      </CardBody>
      <ConfirmDialog open={open} onOpenChange={setOpen} title={`Delete ${project.name}?`} description="This permanently deletes the project and everything in it." phrase={project.name} confirmLabel="Delete project" danger loading={del.isPending} onConfirm={() => del.mutate()} />
    </Card>
  );
}

const TABS = [
  ["profile", "Profile & brand"],
  ["permissions", "Permissions & limits"],
  ["ai", "AI & budget"],
  ["agents", "Agents"],
  ["notes", "Notes"],
  ["danger", "Danger zone"],
] as const;

export default function ProjectSettings() {
  const { projectId } = useParams();
  const [params, setParams] = useSearchParams();
  const { data, isLoading, error } = useProject(projectId);
  const tab = TABS.some(([k]) => k === params.get("tab")) ? params.get("tab")! : "profile";
  const project = data?.project;

  return (
    <PageContainer>
      <PageHeader
        eyebrow={project?.name ?? "Project"}
        title="Project settings"
        description="Business profile, autonomy, AI models, agents and context for this project."
        actions={
          project &&
          !project.setupComplete && (
            <Button asChild size="sm">
              <Link to={`/projects/${projectId}/setup?step=${Math.max(3, project.setupStep ?? 3)}`}>Continue setup</Link>
            </Button>
          )
        }
      />
      {error ? (
        <SetupCallout tone="red" title="Could not load the project">
          {(error as Error).message}
        </SetupCallout>
      ) : isLoading || !project ? (
        <div className="space-y-3">
          <Skeleton className="h-9" />
          <Skeleton className="h-96" />
        </div>
      ) : (
        <Tabs
          value={tab}
          onValueChange={(v) => {
            const next = new URLSearchParams(params);
            next.set("tab", v);
            setParams(next, { replace: true });
          }}
        >
          <TabsList className="overflow-x-auto scrollbar-thin">
            {TABS.map(([k, l]) => (
              <TabsTrigger key={k} value={k} className={k === "danger" ? "data-[state=active]:text-red-fg data-[state=active]:border-red-fg" : undefined}>
                {l}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="profile">
            <ProfileTab project={project} />
          </TabsContent>
          <TabsContent value="permissions" className="space-y-6">
            <PauseCard project={project} />
            <PolicyEditor projectId={project.id} initial={data?.policy} />
          </TabsContent>
          <TabsContent value="ai" className="space-y-6">
            <section>
              <SectionTitle action={<Link to="/settings?tab=ai" className="text-[11.5px] text-muted hover:text-ink">Manage API keys →</Link>}>Models for this project</SectionTitle>
              <AiConfigEditor projectId={project.id} initial={project.aiConfig} />
            </section>
            <BudgetCard projectId={project.id} />
          </TabsContent>
          <TabsContent value="agents">
            <AgentsTab projectId={project.id} />
          </TabsContent>
          <TabsContent value="notes">
            <NotesTab projectId={project.id} />
          </TabsContent>
          <TabsContent value="danger">
            <DangerTab project={project} />
          </TabsContent>
        </Tabs>
      )}
    </PageContainer>
  );
}
