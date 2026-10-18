import * as React from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, CaretLeft, CaretRight, PencilSimple, Plus, Queue as QueueIcon, Trash, X as XIcon, XCircle } from "@phosphor-icons/react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/AppShell";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, Dialog, DialogContent, Empty, Field, Input, PageHeader, Select, Skeleton, StatusBadge, Switch } from "@/components/ui";
import { SectionTitle, useProject } from "@/components/common";
import { api, p } from "@/lib/api";
import { cn, PLATFORM_LABEL, toastError } from "@/lib/utils";
import {
  dayKey,
  fmtTz,
  PlatformIcons,
  PlatformToggle,
  postLabel,
  ScheduleDialog,
  STATUS_CHIP,
  STATUS_DOT,
  TargetsList,
  TimezoneSelect,
  zonedParts,
  zonedToUtc,
  type Post,
  type SocialPlatform,
} from "@/components/content/shared";

type Queue = { id: string; name: string; platforms: SocialPlatform[]; slots: { weekday: number; time: string }[]; timezone: string; active: boolean; createdAt: string };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");

// Civil-date arithmetic on "YYYY-MM-DD" keys (timezone-free).
const keyToUTC = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const utcToKey = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (k: string, n: number) => {
  const d = keyToUTC(k);
  d.setUTCDate(d.getUTCDate() + n);
  return utcToKey(d);
};
const weekday = (k: string) => keyToUTC(k).getUTCDay();

function eventDate(post: Post): string | null {
  if (post.scheduledAt) return post.scheduledAt;
  const t = (post.targets ?? []).map((x) => x.publishedAt ?? x.scheduledAt).filter(Boolean) as string[];
  return t.sort()[0] ?? null;
}

function PostChip({ post, tz, onClick, large }: { post: Post; tz: string; onClick: () => void; large?: boolean }) {
  const at = eventDate(post);
  return (
    <button onClick={onClick} className={cn("w-full text-left rounded-md border px-1.5 py-1 text-[11.5px] leading-tight transition-opacity hover:opacity-80", STATUS_CHIP[post.status] ?? STATUS_CHIP.draft)} title={`${postLabel(post)} — ${post.status.replace(/_/g, " ")}`}>
      <div className="flex items-center gap-1">
        <span className="tabular-nums font-medium shrink-0">{at ? fmtTz(at, tz, { hour: "2-digit", minute: "2-digit", hour12: false }) : ""}</span>
        <PlatformIcons platforms={post.platforms} size={10} className="gap-0.5 text-current" />
        {(post.targets ?? []).some((t) => t.status === "failed") && <span className="h-1.5 w-1.5 rounded-full bg-red-fg shrink-0" />}
        {(post.targets ?? []).some((t) => t.status === "manual") && <span className="h-1.5 w-1.5 rounded-full bg-yellow-fg shrink-0" />}
      </div>
      <div className={cn("truncate mt-0.5", large && "whitespace-normal line-clamp-3")}>{postLabel(post)}</div>
    </button>
  );
}

function PostPanel({ projectId, postId, tz, onClose }: { projectId: string; postId: string; tz: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["post", projectId, postId], queryFn: () => api.get<{ post: Post; approval: any }>(p(projectId, `/posts/${postId}`)) });
  const post = data?.post;
  const [reschedule, setReschedule] = React.useState(false);
  const unschedule = useMutation({
    mutationFn: () => api.post(p(projectId, `/posts/${postId}/unschedule`)),
    onSuccess: () => {
      ["post", "posts", "calendar", "campaign"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success("Unscheduled");
    },
    onError: (e) => toastError(e),
  });
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const canUnschedule = post && ["scheduled", "in_review", "manual_handoff", "partially_published"].includes(post.status) && (post.targets ?? []).some((t) => ["pending", "scheduled", "manual"].includes(t.status));
  const canReschedule = post && !["publishing", "published"].includes(post.status) && !(post.targets ?? []).some((t) => t.status === "published");
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-ink/10" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 w-full max-w-[440px] bg-surface border-l border-line shadow-pop flex flex-col animate-enter">
        <div className="flex items-start gap-3 px-5 py-4 border-b border-line">
          <div className="flex-1 min-w-0">
            {isLoading || !post ? (
              <Skeleton className="h-6 w-48" />
            ) : (
              <>
                <h2 className="text-[15px] font-semibold text-ink leading-snug">{postLabel(post)}</h2>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <StatusBadge status={post.status} />
                  <PlatformIcons platforms={post.platforms} size={13} />
                  {post.campaign && <span className="text-[12px] text-muted truncate">· {post.campaign.name}</span>}
                </div>
              </>
            )}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <XIcon size={15} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4 space-y-5">
          {post && (
            <>
              {post.scheduledAt && (
                <div className="text-[13px]">
                  <div className="text-[11.5px] text-muted">Scheduled for</div>
                  <div className="text-ink font-medium">{fmtTz(post.scheduledAt, tz, { weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                  <div className="text-[12px] text-muted">
                    {tz}
                    {post.timezone && post.timezone !== tz ? ` · ${fmtTz(post.scheduledAt, post.timezone)} in ${post.timezone}` : ""}
                  </div>
                </div>
              )}
              <p className="text-[13px] text-ink-2 whitespace-pre-wrap line-clamp-[10]">{post.body || <span className="text-muted">No text.</span>}</p>
              {data?.approval && (
                <div className="flex items-center gap-2 text-[12.5px]">
                  Approval <StatusBadge status={data.approval.status} />
                  <Link to={`/projects/${projectId}/approvals`} className="underline underline-offset-2 text-muted">
                    Open
                  </Link>
                </div>
              )}
              <div>
                <SectionTitle>Targets</SectionTitle>
                <TargetsList projectId={projectId} targets={(post.targets ?? []).filter((t) => t.status !== "cancelled")} tz={tz} compact />
              </div>
            </>
          )}
        </div>
        <div className="px-5 py-3 border-t border-line flex flex-wrap gap-2 bg-subtle">
          <Button asChild variant="primary" size="sm">
            <Link to={`/projects/${projectId}/content/${postId}`}>
              <PencilSimple size={13} /> Open editor
            </Link>
          </Button>
          {canReschedule && (
            <Button size="sm" variant="secondary" onClick={() => setReschedule(true)}>
              <CalendarPlus size={13} /> {post?.scheduledAt ? "Reschedule" : "Schedule"}
            </Button>
          )}
          {canUnschedule && (
            <Button size="sm" variant="secondary" loading={unschedule.isPending} onClick={() => unschedule.mutate()}>
              <XCircle size={13} /> Unschedule
            </Button>
          )}
        </div>
      </aside>
      {post && <ScheduleDialog projectId={projectId} post={post} defaultTz={tz} open={reschedule} onOpenChange={setReschedule} reschedule />}
    </div>
  );
}

function QueueDialog({ projectId, queue, open, onOpenChange, defaultTz }: { projectId: string; queue: Queue | null; open: boolean; onOpenChange: (v: boolean) => void; defaultTz: string }) {
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [platforms, setPlatforms] = React.useState<SocialPlatform[]>([]);
  const [tz, setTz] = React.useState(defaultTz);
  const [active, setActive] = React.useState(true);
  const [times, setTimes] = React.useState<string[]>(["09:00", "17:00"]);
  const [slots, setSlots] = React.useState<Set<string>>(new Set());
  const [newTime, setNewTime] = React.useState("12:00");
  React.useEffect(() => {
    if (!open) return;
    setName(queue?.name ?? "");
    setPlatforms(queue?.platforms ?? []);
    setTz(queue?.timezone ?? defaultTz);
    setActive(queue?.active ?? true);
    const ts = queue ? Array.from(new Set(queue.slots.map((s) => s.time.padStart(5, "0")))).sort() : ["09:00", "17:00"];
    setTimes(ts);
    setSlots(new Set(queue ? queue.slots.map((s) => `${s.weekday}|${s.time.padStart(5, "0")}`) : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const toggle = (k: string) => setSlots((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });
  const m = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        platforms,
        timezone: tz,
        active,
        slots: Array.from(slots)
          .filter((k) => times.includes(k.split("|")[1]))
          .map((k) => ({ weekday: Number(k.split("|")[0]), time: k.split("|")[1] })),
      };
      return queue ? api.patch(p(projectId, `/queues/${queue.id}`), body) : api.post(p(projectId, "/queues"), body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar", projectId, "queues"] });
      toast.success(queue ? "Queue updated" : "Queue created");
      onOpenChange(false);
    },
    onError: (e) => toastError(e),
  });
  const slotCount = Array.from(slots).filter((k) => times.includes(k.split("|")[1])).length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={queue ? "Edit queue" : "New recurring queue"}
        description="Weekly posting slots. Adding a draft to a queue schedules it at the next free slot."
        className="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={m.isPending} disabled={!name.trim() || !platforms.length || !slotCount} onClick={() => m.mutate()}>
              {queue ? "Save queue" : "Create queue"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekday tips" />
            </Field>
            <Field label="Timezone">
              <TimezoneSelect value={tz} onChange={setTz} />
            </Field>
          </div>
          <Field label="Platforms">
            <PlatformToggle value={platforms} onChange={setPlatforms} />
          </Field>
          <Field label={`Weekly slots (${slotCount})`} hint="Click cells to toggle a slot.">
            <div className="overflow-x-auto scrollbar-thin">
              <table className="text-[12px] border-collapse">
                <thead>
                  <tr>
                    <th />
                    {WEEKDAYS.map((d) => (
                      <th key={d} className="px-1 pb-1 font-medium text-muted w-11">
                        {d}
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {times.map((t) => (
                    <tr key={t}>
                      <td className="pr-2 tabular-nums text-ink-2">{t}</td>
                      {WEEKDAYS.map((_, wd) => {
                        const k = `${wd}|${t}`;
                        const on = slots.has(k);
                        return (
                          <td key={wd} className="p-0.5">
                            <button type="button" onClick={() => toggle(k)} className={cn("h-7 w-10 rounded-md border transition-colors", on ? "bg-ink border-ink" : "bg-surface border-line hover:border-line-strong")} aria-label={`${WEEKDAYS[wd]} ${t}`} aria-pressed={on} />
                          </td>
                        );
                      })}
                      <td className="pl-1">
                        <Button size="icon-sm" variant="ghost" aria-label="Remove time" onClick={() => setTimes((x) => x.filter((y) => y !== t))}>
                          <Trash size={12} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <Input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className="w-32" />
              <Button size="sm" variant="secondary" disabled={!newTime || times.includes(newTime)} onClick={() => setTimes((x) => [...x, newTime].sort())}>
                <Plus size={12} /> Add time
              </Button>
            </div>
          </Field>
          <Switch checked={active} onCheckedChange={setActive} label="Active" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddToQueueDialog({ projectId, queues, open, onOpenChange, tz }: { projectId: string; queues: Queue[]; open: boolean; onOpenChange: (v: boolean) => void; tz: string }) {
  const qc = useQueryClient();
  const [postId, setPostId] = React.useState("");
  const [queueId, setQueueId] = React.useState("");
  const active = queues.filter((q) => q.active);
  const { data, isLoading } = useQuery({ queryKey: ["posts", projectId, "queueable"], queryFn: () => api.get<{ posts: Post[] }>(p(projectId, "/posts?status=draft,approved&limit=200")), enabled: open });
  React.useEffect(() => {
    if (open) {
      setPostId("");
      setQueueId(active[0]?.id ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const m = useMutation({
    mutationFn: () => api.post<{ scheduledAt: string; needsApproval: boolean; targets: { platform: string; status: string }[] }>(p(projectId, `/posts/${postId}/queue`), { queueId }),
    onSuccess: (r) => {
      ["posts", "post", "calendar"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      const manual = r.targets.filter((t) => t.status === "manual").map((t) => PLATFORM_LABEL[t.platform]);
      toast.success(`Queued for ${fmtTz(r.scheduledAt, tz)}${manual.length ? ` — manual handoff on ${manual.join(", ")}` : ""}`);
      onOpenChange(false);
    },
    onError: (e: any) => {
      toastError(e);
      if (Array.isArray(e?.details)) e.details.forEach((c: any) => c?.message && toast.error(c.message));
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add a draft to a queue"
        description="The post is scheduled at the queue's next free slot on the queue's platforms, after passing the quality check."
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={m.isPending} disabled={!postId || !queueId} onClick={() => m.mutate()}>
              Add to queue
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Queue">
            <Select value={queueId} onChange={(e) => setQueueId(e.target.value)}>
              {!active.length && <option value="">No active queues</option>}
              {active.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name} — {q.platforms.map((x) => PLATFORM_LABEL[x]).join(", ")}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Draft">
            {isLoading ? (
              <Skeleton className="h-8.5" />
            ) : (
              <Select value={postId} onChange={(e) => setPostId(e.target.value)}>
                <option value="">{data?.posts.length ? "Choose a post…" : "No drafts or approved posts"}</option>
                {data?.posts.map((x) => (
                  <option key={x.id} value={x.id}>
                    {postLabel(x)} ({x.status})
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function QueuesSection({ projectId, tz }: { projectId: string; tz: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["calendar", projectId, "queues"], queryFn: () => api.get<{ queues: Queue[] }>(p(projectId, "/queues")) });
  const queues = data?.queues ?? [];
  const [edit, setEdit] = React.useState<Queue | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [toDelete, setToDelete] = React.useState<Queue | null>(null);
  const toggle = useMutation({
    mutationFn: (q: Queue) => api.patch(p(projectId, `/queues/${q.id}`), { active: !q.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["calendar", projectId, "queues"] }),
    onError: (e) => toastError(e),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(p(projectId, `/queues/${id}`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar", projectId, "queues"] });
      setToDelete(null);
      toast.success("Queue deleted");
    },
    onError: (e) => toastError(e),
  });
  return (
    <Card className="mt-6">
      <CardHeader
        title="Recurring queues"
        description="Reusable weekly slots — drop drafts in and they're scheduled at the next free time."
        icon={<QueueIcon size={15} className="text-muted" />}
        action={
          <>
            <Button size="sm" variant="secondary" disabled={!queues.some((q) => q.active)} onClick={() => setAddOpen(true)}>
              Add draft to queue
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setEdit(null);
                setEditOpen(true);
              }}
            >
              <Plus size={12} weight="bold" /> New queue
            </Button>
          </>
        }
      />
      <CardBody>
        {isLoading ? (
          <Skeleton className="h-20" />
        ) : !queues.length ? (
          <p className="text-[12.5px] text-muted">No queues yet.</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {queues.map((q) => {
              const byDay = WEEKDAYS.map((d, i) => ({ d, times: q.slots.filter((s) => s.weekday === i).map((s) => s.time).sort() }));
              return (
                <div key={q.id} className={cn("rounded-lg border border-line p-3.5", !q.active && "opacity-60")}>
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-medium text-ink truncate">{q.name}</div>
                      <div className="flex items-center gap-2 text-[12px] text-muted mt-0.5">
                        <PlatformIcons platforms={q.platforms} size={12} />
                        <span>· {q.timezone}</span>
                        <span>· {q.slots.length} slots/week</span>
                      </div>
                    </div>
                    <Switch checked={q.active} onCheckedChange={() => toggle.mutate(q)} />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Edit queue"
                      onClick={() => {
                        setEdit(q);
                        setEditOpen(true);
                      }}
                    >
                      <PencilSimple size={13} />
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Delete queue" onClick={() => setToDelete(q)}>
                      <Trash size={13} />
                    </Button>
                  </div>
                  <div className="grid grid-cols-7 gap-1 mt-3">
                    {byDay.map(({ d, times }) => (
                      <div key={d} className="text-center">
                        <div className="text-[10.5px] text-muted mb-1">{d}</div>
                        {times.length ? (
                          times.map((t) => (
                            <div key={t} className="text-[10.5px] tabular-nums rounded bg-canvas border border-line mb-0.5 py-px">
                              {t}
                            </div>
                          ))
                        ) : (
                          <div className="text-[10.5px] text-faint">—</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
      <QueueDialog projectId={projectId} queue={edit} open={editOpen} onOpenChange={setEditOpen} defaultTz={tz} />
      <AddToQueueDialog projectId={projectId} queues={queues} open={addOpen} onOpenChange={setAddOpen} tz={tz} />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Delete this queue?"
        description="Posts already scheduled from it keep their times."
        confirmLabel="Delete queue"
        danger
        loading={del.isPending}
        onConfirm={() => {
          if (toDelete) del.mutate(toDelete.id);
        }}
      />
    </Card>
  );
}

export default function CalendarPage() {
  const { projectId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { data: proj } = useProject(projectId);
  const tz: string = proj?.project?.timezone ?? "UTC";
  const todayKey = dayKey(new Date(), tz);
  const [view, setView] = React.useState<"month" | "week">(() => (params.get("view") === "week" ? "week" : "month"));
  const [anchor, setAnchor] = React.useState(todayKey);
  const selectedPost = params.get("post");
  const setSelected = (id: string | null) => {
    const n = new URLSearchParams(params);
    if (id) n.set("post", id);
    else n.delete("post");
    setParams(n, { replace: true });
  };

  const { start, end, cells } = React.useMemo(() => {
    if (view === "week") {
      const s = addDays(anchor, -weekday(anchor));
      return { start: s, end: addDays(s, 7), cells: Array.from({ length: 7 }, (_, i) => addDays(s, i)) };
    }
    const [y, m] = anchor.split("-").map(Number);
    const first = `${y}-${pad(m)}-01`;
    const s = addDays(first, -weekday(first));
    const nextMonth = utcToKey(new Date(Date.UTC(y, m, 1)));
    const lastCellEnd = addDays(nextMonth, (7 - weekday(nextMonth)) % 7);
    const n = Math.round((+keyToUTC(lastCellEnd) - +keyToUTC(s)) / 86400_000);
    return { start: s, end: lastCellEnd, cells: Array.from({ length: n }, (_, i) => addDays(s, i)) };
  }, [view, anchor]);
  const from = zonedToUtc(`${start}T00:00`, tz).toISOString();
  const to = zonedToUtc(`${end}T00:00`, tz).toISOString();
  const { data, isLoading } = useQuery({ queryKey: ["calendar", projectId, from, to], queryFn: () => api.get<{ posts: Post[]; timezone: string }>(p(projectId, `/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)), enabled: !!proj });

  const byDay = React.useMemo(() => {
    const map: Record<string, Post[]> = {};
    for (const post of data?.posts ?? []) {
      const at = eventDate(post);
      if (!at) continue;
      const k = dayKey(new Date(at), tz);
      (map[k] ??= []).push(post);
    }
    for (const k of Object.keys(map)) map[k].sort((a, b) => (eventDate(a) ?? "").localeCompare(eventDate(b) ?? ""));
    return map;
  }, [data, tz]);

  const move = (dir: number) => {
    if (view === "week") setAnchor((a) => addDays(a, 7 * dir));
    else {
      const [y, m] = anchor.split("-").map(Number);
      setAnchor(utcToKey(new Date(Date.UTC(y, m - 1 + dir, 1))));
    }
  };
  const [ay, am] = anchor.split("-").map(Number);
  const label =
    view === "month"
      ? new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(ay, am - 1, 1)))
      : `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(keyToUTC(start))} – ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(keyToUTC(addDays(end, -1)))}`;
  const nowParts = zonedParts(new Date(), tz);

  return (
    <PageContainer wide>
      <PageHeader
        title="Calendar"
        description={
          <>
            Scheduled and published posts in <span className="text-ink-2">{tz}</span> (project timezone, now {pad(nowParts.hour)}:{pad(nowParts.minute)}).
          </>
        }
        actions={
          <Button asChild variant="secondary">
            <Link to={`/projects/${projectId}/content?status=draft`}>Drafts</Link>
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex items-center">
          <Button size="icon-sm" variant="ghost" onClick={() => move(-1)} aria-label="Previous">
            <CaretLeft size={14} />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => move(1)} aria-label="Next">
            <CaretRight size={14} />
          </Button>
        </div>
        <h2 className="text-[16px] font-semibold text-ink min-w-[180px]">{label}</h2>
        <Button size="sm" variant="secondary" onClick={() => setAnchor(todayKey)}>
          Today
        </Button>
        <div className="flex-1" />
        <div className="hidden md:flex items-center gap-3 text-[11.5px] text-muted mr-2">
          {["draft", "in_review", "scheduled", "published", "failed", "manual_handoff"].map((s) => (
            <span key={s} className="inline-flex items-center gap-1">
              <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[s])} /> {s.replace(/_/g, " ")}
            </span>
          ))}
        </div>
        <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
          {(["month", "week"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={cn("px-3 h-7 rounded-[5px] text-[12.5px] capitalize", view === v ? "bg-ink text-white" : "text-ink-2 hover:bg-canvas")}>
              {v}
            </button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 border-b border-line bg-subtle">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-1.5 text-[11.5px] font-medium text-muted">
              {d}
            </div>
          ))}
        </div>
        {isLoading ? (
          <div className="p-4">
            <Skeleton className="h-[480px]" />
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {cells.map((k, i) => {
              const items = byDay[k] ?? [];
              const inMonth = view === "week" || Number(k.split("-")[1]) === am;
              const isToday = k === todayKey;
              const max = view === "month" ? 3 : 50;
              return (
                <div key={k} className={cn("border-line p-1.5 min-w-0", i % 7 !== 6 && "border-r", i < cells.length - 7 && "border-b", view === "month" ? "min-h-[112px]" : "min-h-[420px]", !inMonth && "bg-subtle/60")}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={cn("text-[12px] tabular-nums h-5 min-w-5 px-1 rounded-full inline-flex items-center justify-center", isToday ? "bg-ink text-white font-medium" : inMonth ? "text-ink-2" : "text-faint")}>{Number(k.split("-")[2])}</span>
                    {items.length > max && <span className="text-[10.5px] text-muted">+{items.length - max}</span>}
                  </div>
                  <div className="space-y-1">
                    {items.slice(0, max).map((post) => (
                      <PostChip key={post.id} post={post} tz={tz} onClick={() => setSelected(post.id)} large={view === "week"} />
                    ))}
                    {items.length > max && (
                      <button
                        className="text-[11px] text-muted hover:text-ink"
                        onClick={() => {
                          setAnchor(k);
                          setView("week");
                        }}
                      >
                        Show all
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      {!isLoading && !data?.posts.length && (
        <Empty title="Nothing scheduled in this period" description="Schedule posts from the editor or add drafts to a recurring queue." className="py-6" action={<Badge tone="gray">{tz}</Badge>} />
      )}

      <QueuesSection projectId={projectId} tz={tz} />

      {selectedPost && <PostPanel projectId={projectId} postId={selectedPost} tz={tz} onClose={() => setSelected(null)} />}
    </PageContainer>
  );
}
