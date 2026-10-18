import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowClockwise, ArrowSquareOut, CheckCircle, Copy, FileText, FilmStrip, Image as ImageIcon, MusicNote, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";
import { PLATFORM_LIMITS } from "@socialpilot/shared/src/capabilities";
import { SOCIAL_PLATFORMS, POST_TYPES, type SocialPlatform } from "@socialpilot/shared/src/enums";
import { api, p, assetUrl } from "@/lib/api";
import { cn, copy, fmtDate, PLATFORM_LABEL, toastError } from "@/lib/utils";
import { Badge, Button, Checkbox, Dialog, DialogContent, Empty, Field, Input, Select, Skeleton, Spinner, StatusBadge } from "@/components/ui";
import { PlatformIcon } from "@/components/common";
import { onServerEvent } from "@/hooks/useEvents";

export { PLATFORM_LIMITS, SOCIAL_PLATFORMS, POST_TYPES };
export type { SocialPlatform };

// ───────────── Types (mirror the API's Prisma models) ─────────────
export type Target = {
  id: string;
  postId: string;
  platform: SocialPlatform;
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  remoteUrl: string | null;
  lastError: string | null;
  attempts: number;
  metrics?: Record<string, number> | null;
};
export type Variant = { text?: string; thread?: string[]; title?: string; privacyLevel?: string };
export type Post = {
  id: string;
  projectId: string;
  campaignId: string | null;
  campaign?: { id: string; name: string; slug?: string } | null;
  title: string;
  type: string;
  body: string;
  platforms: SocialPlatform[];
  variants: Partial<Record<SocialPlatform, Variant>>;
  hashtags: string[];
  cta: string;
  link: string | null;
  mediaAssetIds: string[];
  notes: string;
  status: string;
  scheduledAt: string | null;
  timezone: string;
  queueId: string | null;
  qualityReport: any;
  version: number;
  createdBy: string;
  approvalId: string | null;
  createdAt: string;
  updatedAt: string;
  targets?: Target[];
  versions?: { id: string; version: number; snapshot: any; createdBy: string; createdAt: string }[];
};
export type Campaign = {
  id: string;
  name: string;
  slug: string;
  objective: string;
  targetAudience: string;
  startDate: string | null;
  endDate: string | null;
  platforms: SocialPlatform[];
  pillars: string[];
  guidelines: string;
  budgetUsd: number | null;
  status: string;
  plan: any;
  createdAt: string;
  _count?: { posts: number; assets: number };
};
export type AssetVersion = {
  id: string;
  version: number;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  operation: string;
  params?: any;
  provider?: string | null;
  model?: string | null;
  prompt?: string | null;
  costUsd?: number;
  createdBy?: string;
  createdAt?: string;
};
export type Asset = {
  id: string;
  name: string;
  kind: "image" | "video" | "audio" | "document" | string;
  folder: string;
  campaignId: string | null;
  tags: string[];
  currentVersionId: string | null;
  source: string;
  status: "ready" | "processing" | "failed" | string;
  approvalStatus?: string;
  error: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  versions: AssetVersion[];
};

export const POST_STATUS_OPTIONS = ["draft", "in_review", "approved", "scheduled", "publishing", "published", "partially_published", "failed", "cancelled", "manual_handoff"];
export const TIKTOK_PRIVACY = ["SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "PUBLIC_TO_EVERYONE"];

export const CAMPAIGN_STATUSES = ["planning", "active", "paused", "completed", "archived"];
export function dateRange(c: { startDate: string | null; endDate: string | null }) {
  if (!c.startDate && !c.endDate) return "No dates";
  return `${c.startDate ? fmtDate(c.startDate, "MMM d") : "…"} – ${c.endDate ? fmtDate(c.endDate, "MMM d, yyyy") : "…"}`;
}

export function postLabel(post: Pick<Post, "title" | "body">) {
  return post.title?.trim() || post.body?.trim().slice(0, 70) || "Untitled post";
}

// ───────────── Queries ─────────────
export function useCampaigns(projectId: string) {
  return useQuery({ queryKey: ["campaigns", projectId], queryFn: () => api.get<{ campaigns: Campaign[] }>(p(projectId, "/campaigns")) });
}
export function useAssets(projectId: string, filters: { kind?: string; folder?: string; campaignId?: string; q?: string } = {}) {
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => !!v) as [string, string][]).toString();
  return useQuery({
    queryKey: ["assets", projectId, filters],
    queryFn: () => api.get<{ assets: Asset[]; folders: { folder: string; count: number }[] }>(p(projectId, `/assets${qs ? `?${qs}` : ""}`)),
  });
}

// ───────────── Timezone helpers (no extra deps) ─────────────
export function zonedParts(date: Date, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday),
  };
}
export function tzOffsetMin(date: Date, tz: string) {
  const z = zonedParts(date, tz);
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}
/** "YYYY-MM-DDTHH:mm" wall time in `tz` → UTC Date. */
export function zonedToUtc(local: string, tz: string): Date {
  const [d, t = "00:00"] = local.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, day, h, mi);
  const off = tzOffsetMin(new Date(guess), tz);
  let res = guess - off * 60000;
  const off2 = tzOffsetMin(new Date(res), tz);
  if (off2 !== off) res = guess - off2 * 60000;
  return new Date(res);
}
const pad = (n: number) => String(n).padStart(2, "0");
/** UTC Date → "YYYY-MM-DDTHH:mm" in `tz` (for datetime-local inputs). */
export function toZonedInput(date: Date, tz: string) {
  const z = zonedParts(date, tz);
  return `${z.year}-${pad(z.month)}-${pad(z.day)}T${pad(z.hour)}:${pad(z.minute)}`;
}
export function dayKey(date: Date, tz: string) {
  const z = zonedParts(date, tz);
  return `${z.year}-${pad(z.month)}-${pad(z.day)}`;
}
export function fmtTz(d: string | Date | null | undefined, tz: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) {
  if (!d) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(new Date(d));
  } catch {
    return new Date(d).toLocaleString();
  }
}
export function timezones(): string[] {
  try {
    const list = (Intl as any).supportedValuesOf?.("timeZone") as string[] | undefined;
    if (list?.length) return list.includes("UTC") ? list : ["UTC", ...list];
  } catch {
    /* ignore */
  }
  return ["UTC", "Europe/London", "Europe/Berlin", "Europe/Paris", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Tokyo", "Asia/Singapore", "Australia/Sydney"];
}
export function TimezoneSelect({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const zones = React.useMemo(() => {
    const z = timezones();
    return z.includes(value) ? z : [value, ...z];
  }, [value]);
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      {zones.map((z) => (
        <option key={z} value={z}>
          {z}
        </option>
      ))}
    </Select>
  );
}

// ───────────── Small visual pieces ─────────────
export function PlatformIcons({ platforms, size = 14, className }: { platforms: string[]; size?: number; className?: string }) {
  if (!platforms?.length) return <span className="text-[12px] text-faint">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-ink-2", className)}>
      {platforms.map((pl) => (
        <span key={pl} title={PLATFORM_LABEL[pl] ?? pl}>
          <PlatformIcon platform={pl} size={size} />
        </span>
      ))}
    </span>
  );
}

export function PlatformToggle({ value, onChange, options = [...SOCIAL_PLATFORMS], disabled }: { value: string[]; onChange: (v: SocialPlatform[]) => void; options?: string[]; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((pl) => {
        const on = value.includes(pl);
        return (
          <button
            key={pl}
            type="button"
            disabled={disabled}
            onClick={() => onChange((on ? value.filter((x) => x !== pl) : [...value, pl]) as SocialPlatform[])}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 h-8 text-[12.5px] transition-colors disabled:opacity-50",
              on ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2 hover:border-line-strong",
            )}
          >
            <PlatformIcon platform={pl} size={13} /> {PLATFORM_LABEL[pl] ?? pl}
          </button>
        );
      })}
    </div>
  );
}

export const STATUS_DOT: Record<string, string> = {
  draft: "bg-gray-fg/50",
  in_review: "bg-yellow-fg",
  approved: "bg-green-fg",
  scheduled: "bg-blue-fg",
  publishing: "bg-blue-fg",
  published: "bg-green-fg",
  partially_published: "bg-yellow-fg",
  failed: "bg-red-fg",
  cancelled: "bg-faint",
  manual_handoff: "bg-yellow-fg",
};
export const STATUS_CHIP: Record<string, string> = {
  draft: "bg-gray-bg text-gray-fg border-[#e4e4e1]",
  in_review: "bg-yellow-bg text-yellow-fg border-[#f0e2b6]",
  approved: "bg-green-bg text-green-fg border-[#d5e3d3]",
  scheduled: "bg-blue-bg text-blue-fg border-[#c7e5f7]",
  publishing: "bg-blue-bg text-blue-fg border-[#c7e5f7]",
  published: "bg-green-bg text-green-fg border-[#d5e3d3]",
  partially_published: "bg-yellow-bg text-yellow-fg border-[#f0e2b6]",
  failed: "bg-red-bg text-red-fg border-[#f3cfd1]",
  cancelled: "bg-gray-bg text-faint border-[#e4e4e1]",
  manual_handoff: "bg-yellow-bg text-yellow-fg border-[#f0e2b6]",
};

/** Thumbnail for an asset; uses the current version id so edits bust the browser cache. */
export function AssetThumb({ projectId, asset, className, fit = "cover", showStatus = true }: { projectId: string; asset: Asset; className?: string; fit?: "cover" | "contain"; showStatus?: boolean }) {
  const src = asset.currentVersionId ? assetUrl(projectId, asset.id, asset.currentVersionId) : null;
  const objFit = fit === "cover" ? "object-cover" : "object-contain";
  return (
    <div className={cn("relative overflow-hidden bg-canvas flex items-center justify-center", className)}>
      {src && asset.kind === "image" ? (
        <img src={src} alt={asset.name} loading="lazy" className={cn("h-full w-full", objFit)} />
      ) : src && asset.kind === "video" ? (
        <video src={src} muted preload="metadata" className={cn("h-full w-full", objFit)} />
      ) : (
        <span className="text-muted">
          {asset.kind === "video" ? <FilmStrip size={20} /> : asset.kind === "audio" ? <MusicNote size={20} /> : asset.kind === "image" ? <ImageIcon size={20} /> : <FileText size={20} />}
        </span>
      )}
      {showStatus && asset.status === "processing" && (
        <div className="absolute inset-0 bg-surface/70 flex flex-col items-center justify-center gap-1 text-[11px] text-ink-2">
          <Spinner size={16} />
          Processing
        </div>
      )}
      {showStatus && asset.status === "failed" && (
        <div className="absolute inset-0 bg-red-bg/80 flex flex-col items-center justify-center gap-1 px-2 text-center text-[11px] text-red-fg" title={asset.error ?? ""}>
          <Warning size={16} weight="bold" />
          Failed
        </div>
      )}
      {asset.kind === "video" && src && (
        <span className="absolute bottom-1 left-1 rounded bg-ink/70 px-1 text-[10px] text-white">
          <FilmStrip size={10} className="inline -mt-px" /> video
        </span>
      )}
    </div>
  );
}

/** Multi-select asset picker from the project's media library. */
export function MediaPickerDialog({
  projectId,
  open,
  onOpenChange,
  initial = [],
  onPick,
  kind,
  single,
  title = "Choose media",
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: string[];
  onPick: (ids: string[], assets: Asset[]) => void;
  kind?: string;
  single?: boolean;
  title?: string;
}) {
  const [sel, setSel] = React.useState<string[]>(initial);
  const [filterKind, setFilterKind] = React.useState(kind ?? "");
  const [q, setQ] = React.useState("");
  React.useEffect(() => {
    if (open) setSel(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const { data, isLoading } = useQuery({
    queryKey: ["assets", projectId, "picker", filterKind, q],
    queryFn: () => api.get<{ assets: Asset[] }>(p(projectId, `/assets?limit=200${filterKind ? `&kind=${filterKind}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`)),
    enabled: open,
  });
  const assets = data?.assets ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        description={single ? "Select one asset." : "Select assets in the order you want them attached."}
        className="max-w-3xl"
        footer={
          <>
            <span className="mr-auto text-[12px] text-muted self-center">{sel.length} selected</span>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                onPick(sel, sel.map((id) => assets.find((a) => a.id === id)).filter(Boolean) as Asset[]);
                onOpenChange(false);
              }}
            >
              Use selection
            </Button>
          </>
        }
      >
        <div className="flex gap-2 mb-3">
          <Input placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
          {!kind && (
            <Select value={filterKind} onChange={(e) => setFilterKind(e.target.value)} className="w-36">
              <option value="">All kinds</option>
              <option value="image">Images</option>
              <option value="video">Videos</option>
              <option value="document">Documents</option>
              <option value="audio">Audio</option>
            </Select>
          )}
        </div>
        {isLoading ? (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square" />
            ))}
          </div>
        ) : !assets.length ? (
          <Empty title="No media yet" description="Upload or generate assets in the AI Workspace." action={<Button asChild size="sm"><Link to={`/projects/${projectId}/workspace`}>Open workspace</Link></Button>} />
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {assets.map((a) => {
              const idx = sel.indexOf(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  disabled={a.status !== "ready"}
                  onClick={() => setSel((s) => (idx >= 0 ? s.filter((x) => x !== a.id) : single ? [a.id] : [...s, a.id]))}
                  className={cn("relative rounded-lg border text-left overflow-hidden disabled:opacity-50", idx >= 0 ? "border-ink ring-2 ring-ink/20" : "border-line hover:border-line-strong")}
                >
                  <AssetThumb projectId={projectId} asset={a} className="aspect-square" />
                  <div className="px-1.5 py-1 text-[11px] truncate text-ink-2">{a.name}</div>
                  {idx >= 0 && <span className="absolute top-1 right-1 h-5 min-w-5 px-1 rounded-full bg-ink text-white text-[10.5px] flex items-center justify-center">{single ? <CheckCircle size={12} weight="fill" /> : idx + 1}</span>}
                </button>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Targets & publishing actions ─────────────
/** Shows the exact text to publish by hand, copy buttons, and marks the target as published. */
export function ManualPublishDialog({ projectId, target, open, onOpenChange }: { projectId: string; target: Target | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [url, setUrl] = React.useState("");
  React.useEffect(() => {
    if (open) setUrl("");
  }, [open]);
  const { data, isLoading } = useQuery({
    queryKey: ["post", projectId, target?.postId],
    queryFn: () => api.get<{ post: Post; previews: Record<string, { text: string; thread?: string[]; title?: string }> }>(p(projectId, `/posts/${target!.postId}`)),
    enabled: open && !!target,
  });
  const m = useMutation({
    mutationFn: () => api.post(p(projectId, `/targets/${target!.id}/manual-published`), url.trim() ? { url: url.trim() } : {}),
    onSuccess: () => {
      toast.success("Marked as published");
      ["post", "posts", "calendar", "campaign"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onOpenChange(false);
    },
    onError: (e) => toastError(e),
  });
  const preview = target ? data?.previews?.[target.platform] : undefined;
  const parts = preview?.thread?.length ? preview.thread : preview ? [preview.text] : [];
  const media = data?.post.mediaAssetIds ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Publish manually on ${target ? PLATFORM_LABEL[target.platform] ?? target.platform : ""}`}
        description="SocialPilot doesn't post for you. Copy the exact text below, post it yourself, then paste the post link so its performance is tracked in Analytics."
        className="max-w-xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
              <CheckCircle size={14} weight="bold" /> Mark as published
            </Button>
          </>
        }
      >
        {target?.lastError && <p className="text-[12.5px] text-muted mb-3">Why manual: {target.lastError}</p>}
        {isLoading ? (
          <Skeleton className="h-28" />
        ) : (
          <div className="space-y-2">
            {parts.map((t, i) => (
              <div key={i} className="rounded-lg border border-line bg-subtle">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-line">
                  <span className="text-[11.5px] text-muted">{parts.length > 1 ? `Part ${i + 1} of ${parts.length}` : "Caption"} · {t.length} chars</span>
                  <Button size="sm" variant="ghost" onClick={() => copy(t)}>
                    <Copy size={12} /> Copy
                  </Button>
                </div>
                <pre className="whitespace-pre-wrap font-sans text-[13px] text-ink-2 px-3 py-2">{t}</pre>
              </div>
            ))}
            {media.length > 0 && (
              <div>
                <p className="text-[12px] text-muted mb-1.5">Attached media — download and upload with the post:</p>
                <div className="flex flex-wrap gap-2">
                  {media.map((id, i) => (
                    <a key={id} href={assetUrl(projectId, id, undefined, true)} className="text-[12px] underline underline-offset-2 text-ink-2">
                      Media {i + 1}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <Field label="Published URL (optional)" className="mt-4">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </Field>
      </DialogContent>
    </Dialog>
  );
}

export function TargetsList({ projectId, targets, tz, compact }: { projectId: string; targets: Target[]; tz: string; compact?: boolean }) {
  const qc = useQueryClient();
  const [manual, setManual] = React.useState<Target | null>(null);
  const retry = useMutation({
    mutationFn: (id: string) => api.post(p(projectId, `/targets/${id}/retry`)),
    onSuccess: () => {
      toast.success("Retry queued");
      ["post", "posts", "calendar", "campaign"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => toastError(e),
  });
  if (!targets.length) return <p className="text-[12.5px] text-muted">Not scheduled on any platform yet.</p>;
  return (
    <div className="divide-y divide-line rounded-lg border border-line bg-surface">
      {targets.map((t) => (
        <div key={t.id} className={cn("flex flex-wrap items-start gap-x-3 gap-y-1.5", compact ? "px-3 py-2" : "px-3.5 py-2.5")}>
          <div className="flex items-center gap-2 min-w-[110px]">
            <PlatformIcon platform={t.platform} size={14} />
            <span className="text-[13px] font-medium text-ink">{PLATFORM_LABEL[t.platform] ?? t.platform}</span>
          </div>
          <StatusBadge status={t.status} />
          <div className="text-[12px] text-muted flex-1 min-w-[140px]">
            {t.publishedAt ? <>Published {fmtTz(t.publishedAt, tz)}</> : t.scheduledAt ? <>Scheduled {fmtTz(t.scheduledAt, tz)}</> : "—"}
            {t.attempts > 0 && <span className="ml-1.5 text-faint">· {t.attempts} attempt{t.attempts > 1 ? "s" : ""}</span>}
          </div>
          <div className="flex items-center gap-1">
            {t.remoteUrl && (
              <Button asChild size="sm" variant="ghost">
                <a href={t.remoteUrl} target="_blank" rel="noreferrer">
                  <ArrowSquareOut size={12} /> View
                </a>
              </Button>
            )}
            {t.status === "failed" && (
              <Button size="sm" variant="secondary" loading={retry.isPending && retry.variables === t.id} onClick={() => retry.mutate(t.id)}>
                <ArrowClockwise size={12} /> Retry
              </Button>
            )}
            {t.status === "manual" && (
              <Button size="sm" variant="secondary" onClick={() => setManual(t)}>
                <Copy size={12} /> Publish manually
              </Button>
            )}
          </div>
          {t.lastError && <p className={cn("basis-full text-[12px]", t.status === "failed" ? "text-red-fg" : "text-muted")}>{t.lastError}</p>}
        </div>
      ))}
      <ManualPublishDialog projectId={projectId} target={manual} open={!!manual} onOpenChange={(v) => !v && setManual(null)} />
    </div>
  );
}

export type ScheduleResult = { postId: string; needsApproval: boolean; approvalId?: string; targets: { platform: string; status: string; lastError?: string }[] };

/** Schedule (or reschedule) a post in a chosen timezone. Reschedule = unschedule first, then schedule. */
export function ScheduleDialog({
  projectId,
  post,
  defaultTz,
  open,
  onOpenChange,
  reschedule,
  onDone,
}: {
  projectId: string;
  post: Pick<Post, "id" | "platforms" | "scheduledAt" | "timezone" | "status">;
  defaultTz: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  reschedule?: boolean;
  onDone?: (r: ScheduleResult) => void;
}) {
  const qc = useQueryClient();
  const [tz, setTz] = React.useState(post.timezone || defaultTz);
  const [when, setWhen] = React.useState("");
  const [platforms, setPlatforms] = React.useState<string[]>(post.platforms);
  const [result, setResult] = React.useState<ScheduleResult | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const z = post.timezone || defaultTz;
    setTz(z);
    setPlatforms(post.platforms);
    setResult(null);
    const base = post.scheduledAt && new Date(post.scheduledAt) > new Date() ? new Date(post.scheduledAt) : new Date(Date.now() + 3600_000);
    setWhen(toZonedInput(base, z));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const m = useMutation({
    mutationFn: async () => {
      if (reschedule && ["scheduled", "in_review", "manual_handoff"].includes(post.status)) await api.post(p(projectId, `/posts/${post.id}/unschedule`));
      return api.post<ScheduleResult>(p(projectId, `/posts/${post.id}/schedule`), { scheduledAt: zonedToUtc(when, tz).toISOString(), timezone: tz, platforms });
    },
    onSuccess: (r) => {
      setResult(r);
      ["post", "posts", "calendar", "campaign"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(r.needsApproval ? "Scheduled — waiting for approval" : "Scheduled");
      onDone?.(r);
    },
    onError: (e: any) => {
      toastError(e);
      if (Array.isArray(e?.details)) e.details.forEach((c: any) => c?.message && toast.error(c.message));
    },
  });
  const utc = when ? zonedToUtc(when, tz) : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={reschedule ? "Change planned time" : "Plan post"}
        description="The post runs through the quality check first. At the planned time it appears on Ready to post with platform-ready media and the caption — SocialPilot never posts for you."
        footer={
          result ? (
            <Button variant="primary" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={m.isPending} disabled={!when || !platforms.length} onClick={() => m.mutate()}>
                {reschedule ? "Reschedule" : "Schedule"}
              </Button>
            </>
          )
        }
      >
        {result ? (
          <div className="space-y-3">
            {result.needsApproval && <p className="text-[12.5px] text-yellow-fg">An approval request was created — targets stay pending until it's approved.</p>}
            <div className="divide-y divide-line rounded-lg border border-line">
              {result.targets.map((t) => (
                <div key={t.platform} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <PlatformIcon platform={t.platform} size={13} />
                    <span className="text-[13px] font-medium">{PLATFORM_LABEL[t.platform] ?? t.platform}</span>
                    <StatusBadge status={t.status === "manual" ? "manual_handoff" : t.status} />
                  </div>
                  {t.lastError && <p className="text-[12px] text-muted mt-1">{t.lastError}</p>}
                </div>
              ))}
            </div>
            {result.targets.some((t) => t.status === "manual") && (
              <p className="text-[12px] text-muted">Manual handoffs: at the scheduled time you'll get a notification with the exact text to post; mark it published from the calendar or editor.</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Date & time">
                <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              </Field>
              <Field label="Timezone">
                <TimezoneSelect value={tz} onChange={(z) => setTz(z)} />
              </Field>
            </div>
            {utc && <p className="text-[12px] text-muted -mt-2">= {utc.toUTCString()}{utc < new Date() && <span className="text-red-fg"> · in the past</span>}</p>}
            <Field label="Platforms" hint="Publish to a subset of the post's platforms if needed.">
              <div className="flex flex-wrap gap-3">
                {post.platforms.map((pl) => (
                  <Checkbox
                    key={pl}
                    checked={platforms.includes(pl)}
                    onCheckedChange={(v) => setPlatforms((s) => (v ? [...s, pl] : s.filter((x) => x !== pl)))}
                    label={
                      <span className="inline-flex items-center gap-1.5">
                        <PlatformIcon platform={pl} size={13} /> {PLATFORM_LABEL[pl] ?? pl}
                      </span>
                    }
                  />
                ))}
              </div>
            </Field>
            {!post.platforms.length && <p className="text-[12.5px] text-red-fg">Select platforms on the post before scheduling.</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CharCount({ n, max, className }: { n: number; max: number; className?: string }) {
  const over = n > max;
  const near = !over && n > max * 0.9;
  return <span className={cn("tabular-nums text-[11.5px]", over ? "text-red-fg font-medium" : near ? "text-yellow-fg" : "text-muted", className)}>{n}/{max}</span>;
}

export function KindBadge({ kind }: { kind: string }) {
  return <Badge tone={kind === "image" ? "blue" : kind === "video" ? "purple" : "gray"}>{kind}</Badge>;
}

/** Tracks long-running jobs started from this page; fires when the worker reports completion/failure over SSE. */
export function useJobWatcher(onDone?: (jobId: string, ok: boolean, error?: string, name?: string) => void) {
  const [pending, setPending] = React.useState<Record<string, string>>({});
  const ref = React.useRef<Record<string, string>>({});
  const cb = React.useRef(onDone);
  cb.current = onDone;
  React.useEffect(
    () =>
      onServerEvent((e) => {
        if (e?.type !== "job.completed" && e?.type !== "job.failed") return;
        const id = e.data?.id as string | undefined;
        if (!id || !(id in ref.current)) return;
        const { [id]: _drop, ...rest } = ref.current;
        ref.current = rest;
        setPending(rest);
        cb.current?.(id, e.type === "job.completed", e.data?.error, e.data?.name);
      }),
    [],
  );
  const track = React.useCallback((jobId: string, label: string) => {
    ref.current = { ...ref.current, [jobId]: label };
    setPending(ref.current);
  }, []);
  return { pending, track, isPending: (label: string) => Object.values(pending).includes(label) };
}
