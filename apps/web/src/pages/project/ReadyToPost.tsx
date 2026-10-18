import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowSquareOut, CheckCircle, Copy, DownloadSimple, FileArchive, FilmStrip, ImageSquare, LinkSimple, ListChecks, PaperPlaneTilt, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/AppShell";
import { Badge, Button, Card, CardBody, Dialog, DialogContent, Empty, Field, Input, PageHeader, Skeleton } from "@/components/ui";
import { PlatformIcon } from "@/components/common";
import { api, p } from "@/lib/api";
import { cn, fmtDate, toastError } from "@/lib/utils";
import { onServerEvent } from "@/hooks/useEvents";

type DeskItem = {
  targetId: string;
  postId: string;
  platform: string;
  platformName: string;
  title: string;
  type: string;
  campaign: { id: string; name: string } | null;
  dueAt: string | null;
  state: "overdue" | "due" | "upcoming";
  caption: string;
  captionLength: number;
  captionLimit: number | null;
  thread: string[] | null;
  videoTitle: string | null;
  media: { assetId: string; name: string; kind: string; mimeType: string; width: number | null; height: number | null; sizeBytes: number; durationSec: number | null }[];
  checklist: string[];
};

const STATE: Record<DeskItem["state"], { label: string; tone: "red" | "yellow" | "gray" }> = {
  overdue: { label: "Overdue", tone: "red" },
  due: { label: "Due now", tone: "yellow" },
  upcoming: { label: "Upcoming", tone: "gray" },
};

const fmtBytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Couldn't access the clipboard — select the text and copy it manually.");
  }
}

function MarkPostedDialog({ projectId, item, open, onOpenChange }: { projectId: string; item: DeskItem; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [url, setUrl] = React.useState("");
  const [when, setWhen] = React.useState("");
  const save = useMutation({
    mutationFn: () => api.post<{ url: string }>(p(projectId, `/ready/${item.targetId}/posted`), { url: url.trim(), ...(when ? { postedAt: new Date(when).toISOString() } : {}) }),
    onSuccess: () => {
      toast.success(`Marked as posted on ${item.platformName}. Tracking starts now — see Analytics → Post performance.`);
      onOpenChange(false);
      setUrl("");
      qc.invalidateQueries({ queryKey: ["ready", projectId] });
      qc.invalidateQueries({ queryKey: ["posted", projectId] });
    },
    onError: (e) => toastError(e),
  });
  const hint: Record<string, string> = {
    instagram: "https://www.instagram.com/p/… or /reel/…",
    tiktok: "https://www.tiktok.com/@you/video/… (short vm.tiktok.com links work too)",
    x: "https://x.com/you/status/…",
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Mark as posted on ${item.platformName}`}
        description="Paste the link to the live post. It's checked against the platform, removed from this page and tracked in Analytics."
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={save.isPending} disabled={url.trim().length < 10} onClick={() => save.mutate()}>
              <CheckCircle size={14} weight="fill" /> Mark as posted
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Post URL">
            <Input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder={hint[item.platform] ?? "https://…"} className="font-mono text-[12.5px]" onKeyDown={(e) => e.key === "Enter" && url.trim().length >= 10 && save.mutate()} />
          </Field>
          <Field label="Posted at (optional)" hint="Leave empty if you just posted it.">
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="w-[230px]" />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeskCard({ projectId, item }: { projectId: string; item: DeskItem }) {
  const [posting, setPosting] = React.useState(false);
  const [showChecklist, setShowChecklist] = React.useState(false);
  const over = item.captionLimit != null && item.captionLength > item.captionLimit;
  const base = `/api${p(projectId, `/ready/${item.targetId}`)}`;
  return (
    <Card className={cn(item.state === "overdue" && "border-red-fg/30")}>
      <CardBody className="pt-4 space-y-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="h-9 w-9 rounded-lg border border-line bg-subtle flex items-center justify-center shrink-0">
            <PlatformIcon platform={item.platform} size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-semibold text-ink">{item.title || "Untitled post"}</span>
              <Badge tone={STATE[item.state].tone}>{STATE[item.state].label}</Badge>
              <Badge tone="gray">{item.platformName}</Badge>
              {item.campaign && (
                <Link to={`/projects/${projectId}/campaigns/${item.campaign.id}`} className="text-[12px] text-muted underline underline-offset-2">
                  {item.campaign.name}
                </Link>
              )}
            </div>
            <div className="text-[12px] text-muted mt-0.5">
              {item.dueAt ? `Planned for ${fmtDate(item.dueAt)}` : "Post whenever you're ready"} · {item.type}
              {" · "}
              <Link to={`/projects/${projectId}/content/${item.postId}`} className="underline underline-offset-2">
                Edit post
              </Link>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button asChild size="sm">
              <a href={`${base}/bundle`} download>
                <FileArchive size={13} /> Download all
              </a>
            </Button>
            <Button size="sm" variant="primary" onClick={() => setPosting(true)}>
              <LinkSimple size={13} weight="bold" /> I posted it
            </Button>
          </div>
        </div>

        {item.media.length > 0 && (
          <div className="flex flex-wrap gap-2.5">
            {item.media.map((m, i) => (
              <div key={m.assetId} className="w-[150px] rounded-lg border border-line overflow-hidden bg-surface">
                <div className="relative h-[150px] bg-subtle flex items-center justify-center">
                  {m.kind === "video" ? (
                    <video src={`/api${p(projectId, `/assets/${m.assetId}/file`)}`} className="h-full w-full object-cover" muted preload="metadata" />
                  ) : (
                    <img src={`/api${p(projectId, `/assets/${m.assetId}/file`)}`} alt={m.name} className="h-full w-full object-cover" loading="lazy" />
                  )}
                  <span className="absolute top-1.5 left-1.5 text-[10.5px] font-mono bg-black/60 text-white rounded px-1">{String(i + 1).padStart(2, "0")}</span>
                  <span className="absolute top-1.5 right-1.5 text-white drop-shadow">{m.kind === "video" ? <FilmStrip size={14} /> : <ImageSquare size={14} />}</span>
                </div>
                <div className="p-2 space-y-1">
                  <div className="text-[11.5px] text-ink truncate" title={m.name}>
                    {m.name}
                  </div>
                  <div className="text-[10.5px] text-muted">
                    {m.width && m.height ? `${m.width}×${m.height}` : ""}
                    {m.durationSec ? ` · ${Math.round(m.durationSec)}s` : ""} · {fmtBytes(m.sizeBytes)}
                  </div>
                  <a href={`${base}/media/${m.assetId}`} download className="inline-flex items-center gap-1 text-[11.5px] text-ink underline underline-offset-2">
                    <DownloadSimple size={11} /> {m.kind === "video" ? "Download" : `${item.platformName}-ready`}
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-lg border border-line bg-subtle">
          <div className="flex items-center justify-between px-3 py-2 border-b border-line">
            <span className="text-[12px] font-medium text-ink">{item.thread ? `Thread (${item.thread.length} parts)` : "Caption"}</span>
            <div className="flex items-center gap-2">
              {item.captionLimit != null && !item.thread && (
                <span className={cn("text-[11.5px] font-mono", over ? "text-red-fg" : "text-muted")}>
                  {item.captionLength}/{item.captionLimit}
                </span>
              )}
              <Button size="sm" variant="ghost" onClick={() => copy(item.thread ? item.thread.join("\n\n") : item.caption, item.thread ? "Thread" : "Caption")}>
                <Copy size={12} /> Copy
              </Button>
            </div>
          </div>
          {item.thread ? (
            <div className="divide-y divide-line">
              {item.thread.map((t, i) => (
                <div key={i} className="px-3 py-2 flex gap-2">
                  <span className="text-[11px] font-mono text-muted pt-0.5">{i + 1}</span>
                  <p className="flex-1 text-[12.5px] whitespace-pre-wrap text-ink-2">{t}</p>
                  <Button size="icon-sm" variant="ghost" aria-label={`Copy part ${i + 1}`} onClick={() => copy(t, `Part ${i + 1}`)}>
                    <Copy size={12} />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-3 py-2.5 text-[12.5px] whitespace-pre-wrap text-ink-2 max-h-[220px] overflow-y-auto scrollbar-thin">{item.caption || <span className="text-muted">No caption</span>}</p>
          )}
          {item.videoTitle && (
            <div className="px-3 py-2 border-t border-line flex items-center gap-2 text-[12px]">
              <span className="text-muted">Video title:</span>
              <span className="flex-1 text-ink-2">{item.videoTitle}</span>
              <Button size="icon-sm" variant="ghost" aria-label="Copy title" onClick={() => copy(item.videoTitle!, "Title")}>
                <Copy size={12} />
              </Button>
            </div>
          )}
        </div>
        {over && (
          <div className="flex gap-2 text-[12px] text-red-fg">
            <Warning size={14} className="shrink-0 mt-0.5" /> The caption is longer than {item.platformName} allows — edit the post before publishing.
          </div>
        )}

        <div>
          <button className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-ink" onClick={() => setShowChecklist((v) => !v)}>
            <ListChecks size={13} /> {showChecklist ? "Hide" : "Show"} {item.platformName} posting checklist
          </button>
          {showChecklist && (
            <ul className="mt-2 space-y-1 text-[12.5px] text-ink-2">
              {item.checklist.map((c) => (
                <li key={c} className="flex gap-2">
                  <span className="text-muted">□</span> {c}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardBody>
      <MarkPostedDialog projectId={projectId} item={item} open={posting} onOpenChange={setPosting} />
    </Card>
  );
}

export default function ReadyToPost() {
  const { projectId } = useParams() as { projectId: string };
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ready", projectId], queryFn: () => api.get<{ items: DeskItem[]; counts: { due: number; upcoming: number } }>(p(projectId, "/ready")) });
  React.useEffect(() => onServerEvent((e) => e.type === "post.updated" && qc.invalidateQueries({ queryKey: ["ready", projectId] })), [qc, projectId]);
  const [filter, setFilter] = React.useState<"all" | "instagram" | "tiktok" | "x">("all");
  const items = (q.data?.items ?? []).filter((i) => filter === "all" || i.platform === filter);
  const due = items.filter((i) => i.state !== "upcoming");
  const upcoming = items.filter((i) => i.state === "upcoming");
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Publishing desk"
        title="Ready to post"
        description="Everything you publish yourself. Download the platform-ready files, copy the caption, post it, then paste the link here. It moves to Analytics, where its performance is tracked."
        actions={
          <Button asChild variant="ghost">
            <Link to={`/projects/${projectId}/analytics`}>
              Post performance <ArrowSquareOut size={12} />
            </Link>
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {(["all", "instagram", "tiktok", "x"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cn("px-3 py-1 rounded-md border text-[12.5px] flex items-center gap-1.5", filter === f ? "bg-ink text-white border-ink" : "border-line text-muted hover:text-ink")}>
            {f !== "all" && <PlatformIcon platform={f} size={12} />}
            {({ all: "All", instagram: "Instagram", tiktok: "TikTok", x: "X" } as const)[f]}
          </button>
        ))}
        <span className="ml-auto text-[12px] text-muted">
          {q.data ? `${q.data.counts.due} due · ${q.data.counts.upcoming} upcoming` : ""}
        </span>
      </div>
      {q.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : !items.length ? (
        <Empty
          icon={<PaperPlaneTilt size={22} />}
          title="Nothing to post right now"
          description="Open a post and choose “Send to Ready to post”, or schedule it for a platform you publish manually. It appears here at the planned time."
          action={
            <Button asChild variant="primary">
              <Link to={`/projects/${projectId}/content`}>Go to content</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          {due.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-[12px] uppercase tracking-[0.08em] text-muted font-medium">Post now</h2>
              {due.map((i) => (
                <DeskCard key={i.targetId} projectId={projectId} item={i} />
              ))}
            </section>
          )}
          {upcoming.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-[12px] uppercase tracking-[0.08em] text-muted font-medium">Coming up</h2>
              {upcoming.map((i) => (
                <DeskCard key={i.targetId} projectId={projectId} item={i} />
              ))}
            </section>
          )}
        </div>
      )}
    </PageContainer>
  );
}
