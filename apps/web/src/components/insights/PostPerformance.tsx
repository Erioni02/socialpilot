import * as React from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { ArrowCounterClockwise, ArrowsClockwise, Camera, CheckCircle, Info, PencilSimple, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, Dialog, DialogContent, Empty, Field, Input, Skeleton, Table, Td, Th, Tooltip } from "@/components/ui";
import { PlatformIcon } from "@/components/common";
import { api, p } from "@/lib/api";
import { cn, fmtNum, toastError } from "@/lib/utils";
import { onServerEvent } from "@/hooks/useEvents";
import { axisProps, CHART, Legend, SERIES_COLORS, TimeAgo, tooltipProps } from "./shared";
import { RapidApiCard, useRapidStatus } from "./Audience";

type MetricMap = Record<string, number | null>;
type PostedPost = {
  targetId: string;
  postId: string;
  platform: string;
  title: string;
  type: string;
  campaign: { id: string; name: string } | null;
  url: string | null;
  publishedAt: string;
  manual: boolean;
  tracking: "auto" | "owner_input" | "pending" | "integration";
  trackingNote: string | null;
  metricsAt: string | null;
  source: string | null;
  metrics: MetricMap;
  engagement: number | null;
  engagementRate: number | null;
  series: ({ at: string } & Record<string, number | string>)[];
};
type Performance = {
  days: number;
  totals: { posts: number; views: number; engagement: number; needsInput: number };
  platforms: { platform: string; posts: number; views: number; likes: number; comments: number; shares: number; saves: number; avgEngagementRate: number | null; needsInput: number }[];
  posts: PostedPost[];
  top: PostedPost[];
  timing: { byWeekday: { key: string; posts: number; medianEngagementRate: number }[]; byHour: { key: string; posts: number; medianEngagementRate: number }[]; timezone: string } | null;
  coverage: Record<string, string>;
};

const PLATFORM_NAME: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", x: "X" };
const METRIC_FIELDS: [string, string][] = [
  ["views", "Views / plays"],
  ["reach", "Accounts reached"],
  ["impressions", "Impressions"],
  ["likes", "Likes"],
  ["comments", "Comments / replies"],
  ["shares", "Shares / reposts"],
  ["saves", "Saves / bookmarks"],
  ["profile_visits", "Profile visits"],
  ["follows", "Follows"],
  ["link_clicks", "Link clicks"],
];
const pct = (n: number | null | undefined) => (n == null ? "—" : `${(n * 100).toFixed(2)}%`);
const num = (n: number | null | undefined) => (n == null ? <span className="text-faint">—</span> : <span className="tabular-nums">{fmtNum(n)}</span>);

function Kpi({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="text-[11.5px] text-muted flex items-center gap-1">
        {label}
        {hint && (
          <Tooltip content={hint}>
            <Info size={11} className="text-faint" />
          </Tooltip>
        )}
      </div>
      <div className="text-[22px] font-semibold text-ink tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function TrackingBadge({ post }: { post: PostedPost }) {
  if (post.tracking === "auto") return <Badge tone="green">Auto-tracked</Badge>;
  if (post.tracking === "integration") return <Badge tone="blue">Connected account</Badge>;
  if (post.tracking === "pending") return <Badge tone="gray">Starting…</Badge>;
  return (
    <Tooltip content={post.trackingNote ?? "No public data for this post — add the numbers from your analytics."}>
      <span>
        <Badge tone="yellow">Needs your numbers</Badge>
      </span>
    </Tooltip>
  );
}

function MetricsDialog({ projectId, post, open, onOpenChange }: { projectId: string; post: PostedPost; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [source, setSource] = React.useState<"manual" | "screenshot">("manual");
  const [reading, setReading] = React.useState<{ confidence: string; notes: string } | null>(null);
  const [confirmUndo, setConfirmUndo] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (open) {
      setValues(Object.fromEntries(METRIC_FIELDS.map(([k]) => [k, post.metrics[k] != null ? String(post.metrics[k]) : ""])));
      setSource("manual");
      setReading(null);
    }
  }, [open, post]);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["posted", projectId] });
    qc.invalidateQueries({ queryKey: ["ready", projectId] });
  };
  const read = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.upload<{ values: Record<string, number>; confidence: string; notes: string }>(p(projectId, "/posted/metrics/read-screenshot"), fd);
    },
    onSuccess: (r) => {
      const found = Object.keys(r.values).length;
      if (!found) {
        toast.error("No metrics could be read from that screenshot. Try a clearer crop of the insights screen.");
        return;
      }
      setValues((v) => ({ ...v, ...Object.fromEntries(Object.entries(r.values).map(([k, n]) => [k, String(n)])) }));
      setSource("screenshot");
      setReading({ confidence: r.confidence, notes: r.notes });
      toast.success(`Read ${found} metric${found > 1 ? "s" : ""} — check them, then save`);
    },
    onError: (e) => toastError(e),
  });
  const save = useMutation({
    mutationFn: () => {
      const metrics = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, Math.round(Number(v.replace(/[,\s]/g, "")))]));
      if (Object.values(metrics).some((n) => !Number.isFinite(n) || n < 0)) throw new Error("Use whole, non-negative numbers");
      return api.put(p(projectId, `/posted/${post.targetId}/metrics`), { source, metrics });
    },
    onSuccess: () => {
      toast.success("Metrics saved");
      invalidate();
      onOpenChange(false);
    },
    onError: (e) => toastError(e),
  });
  const rapid = useRapidStatus();
  const live = useMutation({
    mutationFn: () => api.post<{ metrics: Record<string, { value: number }> }>(p(projectId, `/posted/${post.targetId}/refresh-rapidapi`)),
    onSuccess: (r) => {
      setValues((v) => ({ ...v, ...Object.fromEntries(Object.entries(r.metrics).map(([k, m]) => [k, String(m.value)])) }));
      toast.success("Live numbers saved from the statistics API");
      invalidate();
      qc.invalidateQueries({ queryKey: ["intel", "rapidapi"] });
    },
    onError: (e) => toastError(e),
  });
  const undo = useMutation({
    mutationFn: () => api.post(p(projectId, `/ready/${post.targetId}/unpost`)),
    onSuccess: () => {
      toast.success("Moved back to Ready to post");
      invalidate();
      setConfirmUndo(false);
      onOpenChange(false);
    },
    onError: (e) => toastError(e),
  });
  const series = post.series.filter((s) => typeof s.views === "number" || typeof s.likes === "number");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[760px]"
        title={
          <span className="flex items-center gap-2">
            <PlatformIcon platform={post.platform} size={15} /> {post.title || "Post"}
          </span>
        }
        description={
          <>
            Posted <TimeAgo date={post.publishedAt} /> ·{" "}
            {post.url && (
              <a href={post.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                open post
              </a>
            )}
            {post.source ? ` · latest numbers: ${post.source}` : ""}
          </>
        }
        footer={
          <div className="flex w-full items-center gap-2">
            {post.manual && (
              <Button variant="ghost" onClick={() => setConfirmUndo(true)}>
                <ArrowCounterClockwise size={13} /> Not posted / wrong link
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
                <CheckCircle size={14} weight="fill" /> Save metrics
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          {series.length >= 2 ? (
            <div>
              <Legend items={[{ label: "Views", color: SERIES_COLORS[0] }, { label: "Likes", color: SERIES_COLORS[1] }]} />
              <div className="h-[180px] mt-2">
                <ResponsiveContainer>
                  <LineChart data={series.map((s) => ({ ...s, t: new Date(s.at).getTime() }))}>
                    <CartesianGrid stroke={CHART.grid} vertical={false} />
                    <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" })} {...axisProps} />
                    <YAxis yAxisId="v" tickFormatter={(v) => fmtNum(v)} {...axisProps} width={44} />
                    <YAxis yAxisId="l" orientation="right" tickFormatter={(v) => fmtNum(v)} {...axisProps} width={44} />
                    <RTooltip {...tooltipProps} labelFormatter={(t) => new Date(Number(t)).toLocaleString()} formatter={(v) => fmtNum(Number(v))} />
                    <Line yAxisId="v" type="monotone" dataKey="views" name="Views" stroke={SERIES_COLORS[0]} dot={false} strokeWidth={2} connectNulls />
                    <Line yAxisId="l" type="monotone" dataKey="likes" name="Likes" stroke={SERIES_COLORS[1]} dot={false} strokeWidth={2} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <p className="text-[12.5px] text-muted">The growth chart appears after two snapshots. Fresh posts are checked every 20 minutes for 48 hours, then less often.</p>
          )}

          <div className="rounded-lg border border-line p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium text-ink">Add numbers only you can see</span>
              <span className="text-[12px] text-muted">from {PLATFORM_NAME[post.platform] ?? post.platform} analytics: upload a screenshot (AI reads it, you confirm) or type them.</span>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) read.mutate(f);
                  e.target.value = "";
                }}
              />
              <div className="ml-auto flex gap-1.5">
                {rapid.data?.configured && (post.platform === "instagram" || post.platform === "x") && post.url && (
                  <Tooltip content={`Live ${post.platform === "x" ? "views, likes, replies, reposts" : "likes, comments, views"} from the statistics API · 1 request (${rapid.data.budgetLeft} left this month)`}>
                    <span>
                      <Button size="sm" loading={live.isPending} disabled={rapid.data.budgetLeft < 1} onClick={() => live.mutate()}>
                        <ArrowsClockwise size={13} /> Live numbers
                      </Button>
                    </span>
                  </Tooltip>
                )}
                <Button size="sm" loading={read.isPending} onClick={() => fileRef.current?.click()}>
                  <Camera size={13} /> Read screenshot
                </Button>
              </div>
            </div>
            {reading && (
              <div className={cn("flex gap-2 text-[12px] rounded-md px-3 py-2", reading.confidence === "high" ? "bg-green-bg text-green-fg" : "bg-yellow-bg text-yellow-fg")}>
                <Warning size={14} className="shrink-0 mt-0.5" />
                <span>
                  Read with {reading.confidence} confidence. Check every value against the screenshot before saving.{reading.notes ? ` ${reading.notes}` : ""}
                </span>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {METRIC_FIELDS.map(([k, label]) => (
                <Field key={k} label={<span className="text-[11.5px]">{label}</span>}>
                  <Input inputMode="numeric" value={values[k] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} placeholder="—" className="h-8 tabular-nums" />
                </Field>
              ))}
            </div>
            <p className="text-[11.5px] text-muted">Leave unknown values empty — they're never treated as zero. Saved values are stored as a dated snapshot with their source.</p>
          </div>
        </div>
      </DialogContent>
      <ConfirmDialog
        open={confirmUndo}
        onOpenChange={setConfirmUndo}
        title="Move this back to Ready to post?"
        description="Use this if you haven't actually posted it yet or attached the wrong link. Snapshots already recorded stay in history."
        confirmLabel="Move back"
        loading={undo.isPending}
        onConfirm={() => undo.mutate()}
      />
    </Dialog>
  );
}

export function PostPerformance({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [days, setDays] = React.useState(30);
  const [platform, setPlatform] = React.useState("all");
  const [open, setOpen] = React.useState<PostedPost | null>(null);
  const q = useQuery({ queryKey: ["posted", projectId, days], queryFn: () => api.get<Performance>(p(projectId, `/posted?days=${days}`)), placeholderData: (prev) => prev, refetchInterval: 5 * 60_000 });
  React.useEffect(() => onServerEvent((e) => e.type === "post.updated" && qc.invalidateQueries({ queryKey: ["posted", projectId] })), [qc, projectId]);
  const refresh = useMutation({
    mutationFn: (targetId: string) => api.post<{ status?: string }>(p(projectId, `/posted/${targetId}/refresh`)),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["posted", projectId] });
      toast.success(r.status === "ok" || r.status === "partial" ? "Metrics updated" : "No public data right now — add the numbers manually");
    },
    onError: (e) => toastError(e),
  });
  const d = q.data;
  const posts = (d?.posts ?? []).filter((x) => platform === "all" || x.platform === platform);
  const needs = posts.filter((x) => x.tracking === "owner_input");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-line p-0.5 bg-surface">
          {[7, 30, 90].map((n) => (
            <button key={n} onClick={() => setDays(n)} className={cn("px-3 py-1 rounded-[5px] text-[12.5px]", days === n ? "bg-ink text-white" : "text-muted hover:text-ink")}>
              {n} days
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-md border border-line p-0.5 bg-surface">
          {["all", "instagram", "tiktok", "x"].map((pl) => (
            <button key={pl} onClick={() => setPlatform(pl)} className={cn("px-2.5 py-1 rounded-[5px] text-[12.5px] flex items-center gap-1", platform === pl ? "bg-ink text-white" : "text-muted hover:text-ink")}>
              {pl !== "all" && <PlatformIcon platform={pl} size={11} />}
              {pl === "all" ? "All" : PLATFORM_NAME[pl]}
            </button>
          ))}
        </div>
        <Link to={`/projects/${projectId}/ready`} className="ml-auto text-[12.5px] text-muted underline underline-offset-2">
          Ready to post →
        </Link>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-48" />
      ) : !d?.posts.length ? (
        <Empty title="No published posts in this period" description="Post something from Ready to post and paste its link. Its views, likes, comments and shares are tracked automatically where the platform shows them publicly." />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Posts published" value={fmtNum(posts.length)} />
            <Kpi label="Views" value={posts.some((x) => x.metrics.views != null) ? fmtNum(posts.reduce((s, x) => s + (x.metrics.views ?? 0), 0)) : "—"} hint="Sum of known view counts. Posts without a view count are not included (never counted as zero)." />
            <Kpi label="Engagements" value={posts.some((x) => x.engagement != null) ? fmtNum(posts.reduce((s, x) => s + (x.engagement ?? 0), 0)) : "—"} hint="Likes + comments + shares + saves, where known." />
            <Kpi
              label="Median engagement rate"
              value={(() => {
                const r = posts.map((x) => x.engagementRate).filter((x): x is number => x != null).sort((a, b) => a - b);
                return r.length ? pct(r.length % 2 ? r[(r.length - 1) / 2] : (r[r.length / 2 - 1] + r[r.length / 2]) / 2) : "—";
              })()}
              hint="Engagements ÷ views per post, median across posts that have both."
            />
          </div>

          {needs.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-yellow-fg/30 bg-yellow-bg px-4 py-3 text-[12.5px] text-yellow-fg">
              <Warning size={15} className="shrink-0" />
              <span className="flex-1">
                {needs.length} post{needs.length > 1 ? "s" : ""} need{needs.length > 1 ? "" : "s"} your numbers ({[...new Set(needs.map((x) => PLATFORM_NAME[x.platform]))].join(", ")} doesn't show them publicly). Upload an analytics screenshot or type them in.
              </span>
              <Button size="sm" onClick={() => setOpen(needs[0])}>
                <PencilSimple size={12} /> Add numbers
              </Button>
            </div>
          )}

          <Card>
            <CardHeader title="Posts" description="Newest first. Click a post for its growth chart and to add metrics from your analytics." />
            <CardBody className="p-0 overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Post</Th>
                    <Th>Posted</Th>
                    <Th className="text-right">Views</Th>
                    <Th className="text-right">Likes</Th>
                    <Th className="text-right">Comments</Th>
                    <Th className="text-right">Shares</Th>
                    <Th className="text-right">Saves</Th>
                    <Th className="text-right">Eng. rate</Th>
                    <Th>Data</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {posts.map((x) => (
                    <tr key={x.targetId} className="hover:bg-subtle cursor-pointer" onClick={() => setOpen(x)}>
                      <Td>
                        <div className="flex items-center gap-2 min-w-[220px] max-w-[340px]">
                          <PlatformIcon platform={x.platform} size={13} />
                          <span className="truncate text-ink">{x.title || "Untitled"}</span>
                        </div>
                        {x.campaign && <div className="text-[11px] text-muted pl-5">{x.campaign.name}</div>}
                      </Td>
                      <Td className="text-[12px] text-muted whitespace-nowrap">
                        <TimeAgo date={x.publishedAt} />
                      </Td>
                      <Td className="text-right">{num(x.metrics.views)}</Td>
                      <Td className="text-right">{num(x.metrics.likes)}</Td>
                      <Td className="text-right">{num(x.metrics.comments)}</Td>
                      <Td className="text-right">{num(x.metrics.shares)}</Td>
                      <Td className="text-right">{num(x.metrics.saves)}</Td>
                      <Td className="text-right tabular-nums">{pct(x.engagementRate)}</Td>
                      <Td>
                        <div className="flex flex-col gap-0.5">
                          <TrackingBadge post={x} />
                          {x.metricsAt && <TimeAgo date={x.metricsAt} prefix="updated " className="text-[10.5px] text-muted" />}
                        </div>
                      </Td>
                      <Td onClick={(e) => e.stopPropagation()}>
                        <Button size="icon-sm" variant="ghost" aria-label="Refresh metrics" loading={refresh.isPending && refresh.variables === x.targetId} onClick={() => refresh.mutate(x.targetId)} disabled={!x.url}>
                          <ArrowsClockwise size={13} />
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CardBody>
          </Card>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader title="By platform" />
              <CardBody className="p-0">
                <Table>
                  <thead>
                    <tr>
                      <Th>Platform</Th>
                      <Th className="text-right">Posts</Th>
                      <Th className="text-right">Views</Th>
                      <Th className="text-right">Likes</Th>
                      <Th className="text-right">Avg. eng. rate</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.platforms
                      .filter((x) => platform === "all" || x.platform === platform)
                      .map((x) => (
                        <tr key={x.platform}>
                          <Td>
                            <span className="flex items-center gap-1.5">
                              <PlatformIcon platform={x.platform} size={12} /> {PLATFORM_NAME[x.platform] ?? x.platform}
                            </span>
                          </Td>
                          <Td className="text-right tabular-nums">{x.posts}</Td>
                          <Td className="text-right">{num(x.views || null)}</Td>
                          <Td className="text-right">{num(x.likes || null)}</Td>
                          <Td className="text-right tabular-nums">{pct(x.avgEngagementRate)}</Td>
                        </tr>
                      ))}
                  </tbody>
                </Table>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Best posting times" description={d.timing ? `Median engagement rate by when you posted (${d.timing.timezone}). Groups need at least 2 posts.` : undefined} />
              <CardBody>
                {d.timing && (d.timing.byWeekday.length || d.timing.byHour.length) ? (
                  <div className="grid grid-cols-2 gap-4 text-[12.5px]">
                    {(
                      [
                        ["Day", d.timing.byWeekday],
                        ["Hour", d.timing.byHour],
                      ] as const
                    ).map(([label, rows]) => (
                      <div key={label}>
                        <div className="text-[11.5px] text-muted mb-1.5">{label}</div>
                        {rows.slice(0, 5).map((r, i) => (
                          <div key={r.key} className="flex items-center justify-between py-1 border-b border-line last:border-0">
                            <span className={cn(i === 0 && "font-medium text-ink")}>{label === "Hour" ? `${r.key}:00` : r.key}</span>
                            <span className="tabular-nums text-muted">
                              {pct(r.medianEngagementRate)} · {r.posts} posts
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12.5px] text-muted">Needs at least 6 posts with views and engagement in this period to say anything reliable.</p>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="text-[12px] text-muted space-y-1">
            {Object.entries(d.coverage).map(([k, v]) => (
              <div key={k} className="flex gap-1.5">
                <PlatformIcon platform={k} size={12} className="mt-0.5 shrink-0" />
                <span>
                  <span className="text-ink-2">{PLATFORM_NAME[k]}:</span> {v}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      <RapidApiCard />
      {open && <MetricsDialog projectId={projectId} post={open} open={!!open} onOpenChange={(v) => !v && setOpen(null)} />}
    </div>
  );
}
