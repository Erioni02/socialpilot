import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis } from "recharts";
import { ArrowSquareOut, ArrowsClockwise, Binoculars, DownloadSimple, Eye, EyeSlash, MagnifyingGlass, Trash, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ago, cn, fmtDate, fmtNum, fmtUsd, toastError } from "@/lib/utils";
import { onServerEvent } from "@/hooks/useEvents";
import { PlatformIcon } from "@/components/common";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Empty,
  Input,
  Select,
  SetupCallout,
  Skeleton,
  StatusBadge,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Td,
  Th,
  Tooltip,
} from "@/components/ui";
import { TrafficPanel } from "@/components/insights/TrafficPanel";

type MV = { value: number; approx?: boolean };
type Metrics = Partial<Record<string, MV>>;
type Outcome = {
  status: "ok" | "partial" | "unavailable" | "private" | "not_found" | "rate_limited" | "error";
  message?: string;
  result?: {
    platform: string;
    kind: string;
    externalId: string;
    url: string;
    title?: string;
    createdAt?: string;
    profile?: { handle?: string; displayName?: string; avatarUrl?: string; verified?: boolean; bio?: string };
    author?: { profile: { handle?: string; displayName?: string }; metrics: Metrics };
    metrics: Metrics;
    posts?: { id: string; url: string; text?: string; createdAt?: string; metrics: Metrics }[];
    unavailable: { metric: string; reason: string }[];
    sourceLabel: string;
    confidence: string;
  };
  paidOptions?: PaidOption[];
};
type SourceKey = "apify" | "socialcrawl" | "postpeer";
type PaidOption = { provider: string; label: string; requires: SourceKey; estimatedCostUsd?: number; estimatedCredits?: number; note: string };
type IntelConfig = { apifyConfigured: boolean; maxPaidChargeUsd: number; sources?: Record<SourceKey, boolean> };
const SOURCE_NAME: Record<SourceKey, string> = { apify: "Apify token", socialcrawl: "SocialCrawl key", postpeer: "PostPeer key" };
const costLabel = (p: PaidOption) => (p.estimatedCredits != null ? `${p.estimatedCredits} credit${p.estimatedCredits === 1 ? "" : "s"}` : `≈ ${fmtUsd(p.estimatedCostUsd ?? 0)}`);

/** Live credit balance for credit-based sources (free call). */
function CreditBalance({ source }: { source: SourceKey }) {
  const q = useQuery({ queryKey: ["intel", "balance", source], queryFn: () => api.get<{ credits: number }>(`/intel/balance/${source}`), enabled: source !== "apify", staleTime: 30_000, retry: false });
  if (source === "apify") return null;
  if (q.isLoading) return <span className="text-muted">checking balance…</span>;
  if (q.error) return <span className="text-red-fg">balance unavailable</span>;
  return <span className="text-muted">{fmtExact(q.data?.credits)} credits left</span>;
}

/** X accounts connected in PostPeer — PostPeer only reads analytics for these. */
function PostPeerPanel() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const q = useQuery({ queryKey: ["intel", "postpeer", "accounts"], queryFn: () => api.get<{ configured: boolean; accounts: { id: string; displayName: string | null; imageUrl: string | null }[] }>("/intel/postpeer/accounts"), retry: false });
  React.useEffect(() => {
    if (params.get("postpeer") === "connected") qc.invalidateQueries({ queryKey: ["intel", "postpeer"] });
  }, [params, qc]);
  const connect = useMutation({
    mutationFn: () => api.post<{ url: string }>("/intel/postpeer/connect"),
    onSuccess: (r) => {
      window.open(r.url, "_blank", "noopener");
      toast.message("Authorize X in the new tab, then come back and press Refresh.");
    },
    onError: (e) => toastError(e),
  });
  if (!q.data?.configured) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px] rounded-lg border border-line bg-surface px-4 py-2.5">
      <PlatformIcon platform="x" size={13} />
      <span className="text-ink font-medium">PostPeer X analytics</span>
      {q.data.accounts.length ? (
        <span className="text-muted">connected: {q.data.accounts.map((a) => a.displayName ?? a.id).join(", ")}</span>
      ) : (
        <span className="text-muted">no X account connected yet — PostPeer can only read accounts you connect</span>
      )}
      <span className="text-muted">·</span>
      <CreditBalance source="postpeer" />
      <div className="ml-auto flex gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => qc.invalidateQueries({ queryKey: ["intel", "postpeer"] })}>
          <ArrowsClockwise size={12} /> Refresh
        </Button>
        <Button size="sm" onClick={() => connect.mutate()} loading={connect.isPending}>
          {q.data.accounts.length ? "Connect another" : "Connect X"} <ArrowSquareOut size={12} />
        </Button>
      </div>
    </div>
  );
}

const PLATFORMS = [
  ["all", "All"],
  ["tiktok", "TikTok"],
  ["instagram", "Instagram"],
  ["x", "X"],
] as const;
const METRIC_LABEL: Record<string, string> = {
  views: "Views",
  likes: "Likes",
  comments: "Comments / replies",
  shares: "Shares",
  quotes: "Quotes",
  saves: "Saves",
  followers: "Followers",
  following: "Following",
  posts: "Posts",
  total_likes: "Total likes",
};
const CHART = { stroke: "#93cdf2", fill: "#13293a", grid: "#272a2f", axis: "#96968f" };

function MetricTile({ k, v }: { k: string; v?: MV }) {
  return (
    <div className="rounded-lg border border-line bg-subtle px-3 py-2.5">
      <div className="text-[11px] text-muted">{METRIC_LABEL[k] ?? k}</div>
      <div className="text-[19px] font-semibold text-ink tabular-nums">
        {v ? (
          <>
            {v.approx && <Tooltip content="Rounded by the platform (e.g. 9.0M)"><span className="text-muted">~</span></Tooltip>}
            {fmtExact(v.value)}
          </>
        ) : (
          <span className="text-faint text-[13px] font-normal">not available</span>
        )}
      </div>
    </div>
  );
}

function ConfidenceBadge({ c }: { c?: string }) {
  if (!c) return null;
  const tone = c === "exact" ? "green" : c === "rounded" ? "yellow" : "blue";
  const tip = c === "exact" ? "Counts exactly as the source reported them" : c === "rounded" ? "Some values are rounded by the platform" : "Only some metrics are available from this source";
  return (
    <Tooltip content={tip}>
      <span>
        <Badge tone={tone as any}>{c}</Badge>
      </span>
    </Tooltip>
  );
}

const er = (m: Metrics) => {
  if (!m.views?.value) return null;
  const parts = [m.likes, m.comments, m.shares].filter(Boolean) as MV[];
  return parts.length ? parts.reduce((s, x) => s + x.value, 0) / m.views.value : null;
};
/** Exact counts (no K/M compaction) so precise values aren't presented as rounded. */
const fmtExact = (n?: number | null) => (n == null ? "—" : new Intl.NumberFormat("en-US").format(n));
const pct = (n: number | null | undefined) => (n == null ? "—" : `${(n * 100).toFixed(2)}%`);

function AnalyzeBox({ onAnalyzed }: { onAnalyzed: (entityId: string | null) => void }) {
  const qc = useQueryClient();
  const [url, setUrl] = React.useState("");
  const [result, setResult] = React.useState<{ outcome: Outcome; entityId: string | null } | null>(null);
  const [paid, setPaid] = React.useState<PaidOption | null>(null);
  const [cap, setCap] = React.useState("0.10");
  const cfg = useQuery({ queryKey: ["intel", "config"], queryFn: () => api.get<IntelConfig>("/intel/config") });
  const hasKey = (s: SourceKey) => (s === "apify" ? !!cfg.data?.apifyConfigured : !!cfg.data?.sources?.[s]);
  const analyze = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ outcome: Outcome; entityId: string | null }>("/intel/analyze", body),
    onSuccess: (r) => {
      setResult(r);
      setPaid(null);
      qc.invalidateQueries({ queryKey: ["intel"] });
      if (r.outcome.status === "ok" || r.outcome.status === "partial") onAnalyzed(r.entityId);
    },
    onError: (e) => toastError(e),
  });
  const watch = useMutation({
    mutationFn: (id: string) => api.patch(`/intel/entities/${id}`, { watched: true }),
    onSuccess: () => {
      toast.success("Added to watchlist — snapshots every 6 hours from free sources");
      qc.invalidateQueries({ queryKey: ["intel"] });
    },
  });
  const o = result?.outcome;
  const r = o?.result;
  return (
    <Card>
      <CardBody className="pt-5">
        <form
          className="flex flex-col sm:flex-row gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) analyze.mutate({ url });
          }}
        >
          <div className="relative flex-1">
            <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a TikTok, Instagram or X profile / post / Reel URL" className="pl-9 h-10 text-[13.5px]" />
          </div>
          <Button variant="primary" size="lg" loading={analyze.isPending} disabled={!url.trim()} type="submit">
            Analyze
          </Button>
        </form>
        <p className="text-[11.5px] text-muted mt-2">Uses free public sources first. Nothing requires logging in to the platform. Paid sources (SocialCrawl, PostPeer, Apify) never run without your confirmation, and the watchlist only uses free sources.</p>

        {o && (
          <div className="mt-5 space-y-4 animate-enter">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={o.status === "ok" ? "completed" : o.status === "partial" ? "partially_published" : o.status === "rate_limited" ? "pending" : "failed"} />
              <span className="text-[12px] text-muted">{o.status.replace("_", " ")}</span>
              {r && <ConfidenceBadge c={r.confidence} />}
              {r && <span className="text-[12px] text-muted">Source: {r.sourceLabel}</span>}
            </div>
            {o.message && (
              <div className="flex gap-2 text-[13px] text-ink-2 rounded-lg border border-line bg-subtle px-4 py-3">
                <Warning size={16} className="text-yellow-fg shrink-0 mt-0.5" />
                <span>{o.message}</span>
              </div>
            )}
            {r && (
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  {r.profile?.avatarUrl ? <img src={r.profile.avatarUrl} alt="" className="h-11 w-11 rounded-full object-cover border border-line" referrerPolicy="no-referrer" /> : <div className="h-11 w-11 rounded-full bg-subtle border border-line flex items-center justify-center"><PlatformIcon platform={r.platform} size={18} /></div>}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[14px] font-semibold text-ink">
                      <PlatformIcon platform={r.platform} size={14} /> {r.profile?.displayName ?? r.profile?.handle ?? r.externalId}
                      {r.profile?.handle && <span className="text-muted font-normal">@{r.profile.handle}</span>}
                      {r.profile?.verified && <Badge tone="blue">verified</Badge>}
                    </div>
                    {r.title && <p className="text-[12.5px] text-ink-2 mt-0.5 line-clamp-2">{r.title}</p>}
                    <div className="text-[11.5px] text-muted mt-0.5">
                      {r.kind} · {r.createdAt ? `published ${fmtDate(r.createdAt)}` : "publish date not available"} ·{" "}
                      <a href={r.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                        open <ArrowSquareOut size={11} className="inline" />
                      </a>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    {result?.entityId && (
                      <Button size="sm" onClick={() => watch.mutate(result.entityId!)} loading={watch.isPending}>
                        <Eye size={13} /> Watch
                      </Button>
                    )}
                    {result?.entityId && (
                      <Button size="sm" variant="ghost" onClick={() => onAnalyzed(result.entityId)}>
                        Details
                      </Button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {(r.kind === "post" ? ["views", "likes", "comments", "shares", "saves"] : ["followers", "following", "posts", "total_likes"]).map((k) => (
                    <MetricTile key={k} k={k} v={r.metrics[k]} />
                  ))}
                </div>
                {r.kind === "post" && (
                  <div className="text-[12.5px] text-ink-2">
                    Engagement rate: <span className="font-semibold text-ink">{pct(er(r.metrics))}</span>{" "}
                    <span className="text-muted">{er(r.metrics) == null ? "(needs views)" : "(likes + comments + shares) ÷ views"}</span>
                  </div>
                )}
                {r.author && Object.keys(r.author.metrics).length > 0 && (
                  <div>
                    <div className="text-[12px] text-muted mb-1.5">Creator @{r.author.profile.handle} (from the same public page)</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {["followers", "following", "posts", "total_likes"].map((k) => (
                        <MetricTile key={k} k={k} v={r.author!.metrics[k]} />
                      ))}
                    </div>
                  </div>
                )}
                {!!r.posts?.length && <PostsTable posts={r.posts.map((p) => ({ ...p, platform: r.platform }))} />}
                {r.unavailable.length > 0 && (
                  <div className="text-[12px] text-muted space-y-0.5">
                    {r.unavailable.map((u) => (
                      <div key={u.metric}>
                        <span className="text-ink-2">{METRIC_LABEL[u.metric] ?? u.metric}:</span> {u.reason}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {o.paidOptions?.length ? (
              <div className="rounded-lg border border-line bg-subtle divide-y divide-line">
                <div className="px-4 pt-3 pb-2 text-[12.5px] font-medium text-ink">Optional paid sources — each runs once, only after you confirm</div>
                {o.paidOptions.map((p) => (
                  <div key={p.provider} className="px-4 py-2.5 flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[220px] text-[12.5px]">
                      <div className="text-ink">
                        {p.label} <span className="text-muted">· {costLabel(p)}</span>
                      </div>
                      <div className="text-muted">{p.note}</div>
                    </div>
                    {hasKey(p.requires) ? (
                      <Button size="sm" onClick={() => setPaid(p)}>
                        Fetch with {p.label}…
                      </Button>
                    ) : (
                      <Button asChild size="sm" variant="ghost">
                        <Link to="/settings?tab=data">Add {SOURCE_NAME[p.requires]}</Link>
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </CardBody>
      <ConfirmDialog
        open={!!paid}
        onOpenChange={(v) => !v && setPaid(null)}
        title="Use a paid source for this request?"
        description={
          paid
            ? paid.requires === "apify"
              ? `${paid.label} — ${paid.note}. Estimated ≈ ${fmtUsd(paid.estimatedCostUsd ?? 0)}, charged to your Apify account. Runs once; it is never scheduled automatically.`
              : `${paid.label} — ${paid.note}. Uses up to ${costLabel(paid)} from your ${paid.label} account (failed and not-found lookups are refunded). Runs once; it is never scheduled automatically.`
            : ""
        }
        confirmLabel="Fetch now"
        loading={analyze.isPending}
        onConfirm={() => {
          if (paid) analyze.mutate({ url, paidProvider: paid.provider, confirmPaid: true, ...(paid.requires === "apify" ? { maxChargeUsd: Number(cap) } : {}) });
        }}
      >
        {paid?.requires === "apify" ? (
          <label className="flex items-center gap-2 text-[12.5px]">
            Hard spend cap (USD)
            <Input type="number" min={0.01} max={cfg.data?.maxPaidChargeUsd ?? 1} step={0.01} value={cap} onChange={(e) => setCap(e.target.value)} className="w-24 h-7" />
          </label>
        ) : paid ? (
          <div className="text-[12.5px]">
            <CreditBalance source={paid.requires} />
          </div>
        ) : null}
      </ConfirmDialog>
    </Card>
  );
}

function PostsTable({ posts, onOpen }: { posts: { id: string; url: string; text?: string | null; createdAt?: string; metrics: Metrics; platform: string; entityId?: string; capturedAt?: string; source?: string }[]; onOpen?: (id: string) => void }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Post</Th>
          <Th className="text-right">Views</Th>
          <Th className="text-right">Likes</Th>
          <Th className="text-right">Comments</Th>
          <Th className="text-right">Shares</Th>
          <Th className="text-right">Eng. rate</Th>
          <Th>Updated</Th>
        </tr>
      </thead>
      <tbody>
        {posts.map((p) => (
          <tr key={p.id} className={cn(onOpen && p.entityId && "cursor-pointer hover:bg-subtle")} onClick={() => p.entityId && onOpen?.(p.entityId)}>
            <Td className="max-w-[340px]">
              <div className="flex items-center gap-1.5">
                <PlatformIcon platform={p.platform} size={13} />
                <a href={p.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="truncate text-ink hover:underline">
                  {p.text?.slice(0, 80) || p.url.replace(/^https:\/\/(www\.)?/, "")}
                </a>
              </div>
            </Td>
            {["views", "likes", "comments", "shares"].map((k) => (
              <Td key={k} className="text-right tabular-nums">
                {p.metrics[k] ? `${p.metrics[k]!.approx ? "~" : ""}${fmtExact(p.metrics[k]!.value)}` : <span className="text-faint">n/a</span>}
              </Td>
            ))}
            <Td className="text-right tabular-nums">{pct(er(p.metrics))}</Td>
            <Td className="text-muted whitespace-nowrap">{p.capturedAt ? ago(p.capturedAt) : p.createdAt ? fmtDate(p.createdAt, "MMM d, yyyy") : "—"}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function EntityDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["intel", "entity", id], queryFn: () => api.get<any>(`/intel/entities/${id}`) });
  const metricKeys = Object.keys(data?.series ?? {});
  const [metric, setMetric] = React.useState<string>("");
  const m = metric || metricKeys[0] || "";
  const refresh = useMutation({
    mutationFn: () => api.post<{ outcome: Outcome }>(`/intel/entities/${id}/refresh`),
    onSuccess: (r) => {
      toast[r.outcome.status === "ok" || r.outcome.status === "partial" ? "success" : "error"](r.outcome.message ?? "Snapshot saved");
      qc.invalidateQueries({ queryKey: ["intel"] });
    },
    onError: (e) => toastError(e),
  });
  const toggle = useMutation({
    mutationFn: (watched: boolean) => api.patch(`/intel/entities/${id}`, { watched }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["intel"] }),
  });
  if (isLoading || !data) return <Skeleton className="h-64" />;
  const e = data.entity;
  const series = (data.series[m] ?? []).map((p: any) => ({ ...p, t: fmtDate(p.at, "MMM d HH:mm") }));
  return (
    <Card>
      <CardHeader
        icon={<PlatformIcon platform={e.platform} size={15} />}
        title={
          <span>
            {e.title ?? e.handle ?? e.externalId} <span className="text-muted font-normal">{e.handle ? `@${e.handle}` : ""} · {e.kind}</span>
          </span>
        }
        description={
          <span>
            Last updated {ago(e.lastFetchedAt)} · status {e.lastStatus ?? "—"}
            {e.lastError && <span className="text-red-fg"> · {e.lastError}</span>}
          </span>
        }
        action={
          <>
            <Button size="sm" onClick={() => refresh.mutate()} loading={refresh.isPending}>
              <ArrowsClockwise size={13} /> Snapshot now
            </Button>
            <Button size="sm" onClick={() => toggle.mutate(!e.watched)}>
              {e.watched ? <EyeSlash size={13} /> : <Eye size={13} />} {e.watched ? "Unwatch" : "Watch"}
            </Button>
            <Button size="sm" asChild>
              <a href={`/api/intel/export.csv?entityId=${id}`}>
                <DownloadSimple size={13} /> CSV
              </a>
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </>
        }
      />
      <CardBody className="space-y-5">
        {data.latest ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
              Latest snapshot {fmtDate(data.latest.capturedAt)} · <ConfidenceBadge c={data.latest.confidence} /> · {data.latest.source}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {Object.entries(data.latest.metrics as Metrics).map(([k, v]) => (
                <MetricTile key={k} k={k} v={v} />
              ))}
            </div>
          </>
        ) : (
          <Empty title="No successful snapshot yet" />
        )}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[12.5px] font-medium text-ink">History recorded by SocialPilot</div>
            {metricKeys.length > 0 && (
              <Select value={m} onChange={(ev) => setMetric(ev.target.value)} className="w-auto h-7 text-[12px]">
                {metricKeys.map((k) => (
                  <option key={k} value={k}>
                    {METRIC_LABEL[k] ?? k}
                  </option>
                ))}
              </Select>
            )}
          </div>
          {series.length >= 2 ? (
            <div className="h-56">
              <ResponsiveContainer>
                <AreaChart data={series} margin={{ left: 4, right: 8, top: 8 }}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="t" tick={{ fontSize: 11, fill: CHART.axis }} stroke={CHART.grid} />
                  <YAxis tick={{ fontSize: 11, fill: CHART.axis }} stroke={CHART.grid} tickFormatter={(v) => fmtNum(v)} width={56} />
                  <ReTooltip contentStyle={{ background: "#15171a", border: "1px solid #272a2f", fontSize: 12 }} formatter={(v: any) => fmtNum(Number(v))} />
                  <Area type="monotone" dataKey="value" stroke={CHART.stroke} fill={CHART.fill} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-[12.5px] text-muted">A chart appears after two successful snapshots. Watch this item to record one every 6 hours (free sources only).</p>
          )}
          <p className="text-[11px] text-faint mt-1">Changes are differences between snapshots this app recorded — they are not unique viewers.</p>
        </div>
        {data.changes.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Metric</Th>
                <Th className="text-right">From</Th>
                <Th className="text-right">To</Th>
                <Th className="text-right">Change</Th>
              </tr>
            </thead>
            <tbody>
              {data.changes.slice(0, 15).map((c: any, i: number) => (
                <tr key={i}>
                  <Td className="text-muted">{fmtDate(c.at)}</Td>
                  <Td>{METRIC_LABEL[c.metric] ?? c.metric}</Td>
                  <Td className="text-right tabular-nums">{fmtExact(c.from)}</Td>
                  <Td className="text-right tabular-nums">{fmtExact(c.to)}</Td>
                  <Td className={cn("text-right tabular-nums", c.change > 0 ? "text-green-fg" : "text-red-fg")}>{c.change > 0 ? "+" : ""}{fmtExact(c.change)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {e.kind === "profile" && data.relatedPosts.length > 0 && (
          <div>
            <div className="text-[12.5px] font-medium text-ink mb-1.5">Analyzed posts by this creator</div>
            <PostsTable posts={data.relatedPosts.filter((p: any) => p.latest).map((p: any) => ({ id: p.id, entityId: p.id, url: p.url, text: p.title, metrics: p.latest.metrics, platform: e.platform, capturedAt: p.latest.capturedAt }))} />
          </div>
        )}
        {data.latest?.posts?.length > 0 && (
          <div>
            <div className="text-[12.5px] font-medium text-ink mb-1.5">Recent posts in the latest snapshot</div>
            <PostsTable posts={data.latest.posts.map((p: any) => ({ ...p, platform: e.platform }))} />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export default function IntelPage() {
  const [params, setParams] = useSearchParams();
  const platform = params.get("platform") ?? "all";
  const entityId = params.get("entity");
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };
  const qc = useQueryClient();
  React.useEffect(() => onServerEvent((e) => e.type === "intel.updated" && qc.invalidateQueries({ queryKey: ["intel"] })), [qc]);
  const dash = useQuery({ queryKey: ["intel", "dashboard", platform], queryFn: () => api.get<any>(`/intel/dashboard?platform=${platform}`) });
  const watch = useQuery({ queryKey: ["intel", "watchlist", platform], queryFn: () => api.get<{ entities: any[] }>(`/intel/entities?watched=true&platform=${platform}`) });
  const history = useQuery({ queryKey: ["intel", "searches"], queryFn: () => api.get<{ searches: any[] }>("/intel/searches") });
  const toggleWatch = useMutation({ mutationFn: ({ id, w }: { id: string; w: boolean }) => api.patch(`/intel/entities/${id}`, { watched: w }), onSuccess: () => qc.invalidateQueries({ queryKey: ["intel"] }) });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/intel/entities/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["intel"] }) });
  const clearHistory = useMutation({ mutationFn: () => api.del("/intel/searches"), onSuccess: () => qc.invalidateQueries({ queryKey: ["intel"] }) });
  const [confirmClear, setConfirmClear] = React.useState(false);
  const d = dash.data;

  return (
    <div className="intel-dark min-h-full">
      <div className="mx-auto max-w-[1280px] px-6 py-8 animate-enter space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.08em] text-muted mb-1 font-medium flex items-center gap-1.5">
              <Binoculars size={13} weight="bold" /> Public social analytics
            </div>
            <h1 className="serif-title text-[34px] text-ink">Social Intel</h1>
            <p className="text-[13.5px] text-muted mt-1.5 max-w-2xl">Analyze public TikTok, Instagram and X profiles and posts. Only verified values are shown; anything a free source can't provide is labelled, never zero-filled.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-line p-0.5 bg-surface">
              {PLATFORMS.map(([v, l]) => (
                <button key={v} onClick={() => set("platform", v === "all" ? null : v)} className={cn("px-3 py-1 rounded-[5px] text-[12.5px] flex items-center gap-1.5", platform === v ? "bg-ink text-white" : "text-muted hover:text-ink")}>
                  {v !== "all" && <PlatformIcon platform={v} size={12} />} {l}
                </button>
              ))}
            </div>
            <Button size="sm" asChild>
              <a href={`/api/intel/export.csv?platform=${platform}`}>
                <DownloadSimple size={13} /> Export CSV
              </a>
            </Button>
          </div>
        </div>

        <AnalyzeBox onAnalyzed={(id) => id && set("entity", id)} />
        <PostPeerPanel />

        {entityId && <EntityDetail id={entityId} onClose={() => set("entity", null)} />}

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="watchlist">Watchlist {watch.data?.entities.length ? `(${watch.data.entities.length})` : ""}</TabsTrigger>
            <TabsTrigger value="history">Search history</TabsTrigger>
            <TabsTrigger value="traffic">Website traffic</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-5">
            {dash.isLoading || !d ? (
              <Skeleton className="h-40" />
            ) : d.counts.entities === 0 ? (
              <Card>
                <Empty icon={<Binoculars size={18} />} title="Nothing analyzed yet" description="Paste a public post or profile URL above. Results are saved so you can track them over time." />
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                  {["views", "likes", "comments", "shares"].map((k) => (
                    <Card key={k} className="px-4 py-3.5">
                      <div className="text-[11.5px] text-muted">Total {METRIC_LABEL[k].toLowerCase()}</div>
                      <div className="text-[22px] font-semibold text-ink tabular-nums">{d.totals[k].items ? fmtExact(d.totals[k].value) : "—"}</div>
                      <div className="text-[11px] text-faint">
                        from {d.totals[k].items} of {d.totals[k].of} posts
                      </div>
                    </Card>
                  ))}
                  <Card className="px-4 py-3.5">
                    <div className="text-[11.5px] text-muted">Average views</div>
                    <div className="text-[22px] font-semibold text-ink tabular-nums">{d.averages.views != null ? fmtExact(Math.round(d.averages.views)) : "—"}</div>
                    <div className="text-[11px] text-faint">over {d.averages.viewsBasedOn} posts with views</div>
                  </Card>
                </div>
                <div className="text-[11.5px] text-faint">Last updated {ago(d.lastUpdated)} · totals only include posts whose source reports that metric.</div>
                <div className="grid lg:grid-cols-[1fr_360px] gap-4">
                  <Card>
                    <CardHeader title="Top-performing posts" description="Ranked by views, or likes when views aren't available." />
                    <CardBody>{d.topPosts.length ? <PostsTable posts={d.topPosts.map((p: any) => ({ ...p, entityId: p.id, text: p.title }))} onOpen={(id) => set("entity", id)} /> : <Empty title="No posts analyzed yet" />}</CardBody>
                  </Card>
                  <Card>
                    <CardHeader title="Engagement rate by platform" description="Average of (likes + comments + shares) ÷ views — only posts with views." />
                    <CardBody>
                      {d.engagementByPlatform.length ? (
                        <div className="h-52">
                          <ResponsiveContainer>
                            <BarChart data={d.engagementByPlatform.map((x: any) => ({ ...x, pct: +(x.avgEngagementRate * 100).toFixed(2) }))}>
                              <CartesianGrid stroke={CHART.grid} vertical={false} />
                              <XAxis dataKey="platform" tick={{ fontSize: 11, fill: CHART.axis }} stroke={CHART.grid} />
                              <YAxis tick={{ fontSize: 11, fill: CHART.axis }} stroke={CHART.grid} unit="%" width={44} />
                              <ReTooltip contentStyle={{ background: "#15171a", border: "1px solid #272a2f", fontSize: 12 }} formatter={(v: any, _n, it: any) => [`${v}% (${it.payload.posts} posts)`, "Avg engagement"]} />
                              <Bar dataKey="pct" fill={CHART.stroke} radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <p className="text-[12.5px] text-muted">Needs posts that report views (e.g. TikTok videos). X posts don't expose views for free.</p>
                      )}
                    </CardBody>
                  </Card>
                </div>
                <Card>
                  <CardHeader title="Profiles" description="Creator stats come from public video pages (TikTok) or approved paid scrapes." />
                  <CardBody>
                    {d.profiles.length ? (
                      <Table>
                        <thead>
                          <tr>
                            <Th>Profile</Th>
                            <Th className="text-right">Followers</Th>
                            <Th className="text-right">Posts</Th>
                            <Th className="text-right">Total likes</Th>
                            <Th>Source</Th>
                            <Th>Updated</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.profiles.map((p: any) => {
                            const m = (p.latest?.metrics ?? {}) as Metrics;
                            const cell = (k: string) => (m[k] ? `${m[k]!.approx ? "~" : ""}${fmtExact(m[k]!.value)}` : <span className="text-faint">n/a</span>);
                            return (
                              <tr key={p.id} className="cursor-pointer hover:bg-subtle" onClick={() => set("entity", p.id)}>
                                <Td>
                                  <span className="flex items-center gap-1.5">
                                    <PlatformIcon platform={p.platform} size={13} /> @{p.handle} {p.watched && <Badge tone="blue">watched</Badge>}
                                  </span>
                                </Td>
                                <Td className="text-right tabular-nums">{cell("followers")}</Td>
                                <Td className="text-right tabular-nums">{cell("posts")}</Td>
                                <Td className="text-right tabular-nums">{cell("total_likes")}</Td>
                                <Td className="text-muted text-[12px]">{p.latest ? <ConfidenceBadge c={p.latest.confidence} /> : p.lastStatus}</Td>
                                <Td className="text-muted">{p.latest ? ago(p.latest.capturedAt) : "—"}</Td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </Table>
                    ) : (
                      <p className="text-[12.5px] text-muted">Analyze a TikTok video to record its creator's stats.</p>
                    )}
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="Metric definitions" />
                  <CardBody className="grid sm:grid-cols-2 gap-2 text-[12px] text-muted">
                    {Object.entries(d.definitions).map(([k, v]) => (
                      <div key={k}>
                        <span className="text-ink-2">{METRIC_LABEL[k] ?? "Engagement rate"}:</span> {v as string}
                      </div>
                    ))}
                  </CardBody>
                </Card>
              </>
            )}
          </TabsContent>

          <TabsContent value="watchlist">
            <Card>
              <CardHeader title="Watchlist" description="Watched items get a new snapshot about every 6 hours from free sources. Paid sources are never scheduled." />
              <CardBody>
                {watch.data?.entities.length ? (
                  <Table>
                    <thead>
                      <tr>
                        <Th>Item</Th>
                        <Th>Status</Th>
                        <Th>Last snapshot</Th>
                        <Th className="text-right">Actions</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {watch.data.entities.map((e) => (
                        <tr key={e.id}>
                          <Td>
                            <button className="flex items-center gap-1.5 text-ink hover:underline text-left" onClick={() => set("entity", e.id)}>
                              <PlatformIcon platform={e.platform} size={13} /> {e.kind === "profile" ? `@${e.handle}` : e.title?.slice(0, 70) || e.url}
                            </button>
                          </Td>
                          <Td>
                            <span className="text-[12px] text-muted">{e.lastStatus ?? "—"}</span>
                            {e.lastError && <div className="text-[11.5px] text-red-fg max-w-[320px] truncate">{e.lastError}</div>}
                          </Td>
                          <Td className="text-muted">{e.snapshots[0] ? ago(e.snapshots[0].capturedAt) : "never"}</Td>
                          <Td className="text-right whitespace-nowrap">
                            <Button size="sm" variant="ghost" onClick={() => toggleWatch.mutate({ id: e.id, w: false })}>
                              <EyeSlash size={13} /> Unwatch
                            </Button>
                            <Button size="icon-sm" variant="danger-ghost" onClick={() => remove.mutate(e.id)} aria-label="Delete">
                              <Trash size={13} />
                            </Button>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ) : (
                  <Empty title="Your watchlist is empty" description="Analyze a URL and click Watch to track it over time." />
                )}
              </CardBody>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardHeader title="Search history" action={history.data?.searches.length ? <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)}>Clear</Button> : undefined} />
              <CardBody>
                {history.data?.searches.length ? (
                  <Table>
                    <thead>
                      <tr>
                        <Th>URL</Th>
                        <Th>Type</Th>
                        <Th>Result</Th>
                        <Th>When</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.data.searches.map((s) => (
                        <tr key={s.id} className={cn(s.entityId && "cursor-pointer hover:bg-subtle")} onClick={() => s.entityId && set("entity", s.entityId)}>
                          <Td className="max-w-[420px] truncate font-mono text-[12px]">{s.url}</Td>
                          <Td>{s.platform ? <span className="flex items-center gap-1.5"><PlatformIcon platform={s.platform} size={12} /> {s.kind}</span> : "—"}</Td>
                          <Td>
                            <span className={cn("text-[12px]", s.ok ? "text-green-fg" : "text-muted")}>{s.status}</span>
                            {s.error && <div className="text-[11.5px] text-muted max-w-[360px] truncate">{s.error}</div>}
                          </Td>
                          <Td className="text-muted whitespace-nowrap">{ago(s.createdAt)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ) : (
                  <Empty title="No searches yet" />
                )}
              </CardBody>
            </Card>
            <ConfirmDialog open={confirmClear} onOpenChange={setConfirmClear} title="Clear search history?" description="Saved snapshots and the watchlist are kept." confirmLabel="Clear" danger onConfirm={() => clearHistory.mutate(undefined, { onSuccess: () => setConfirmClear(false) })} />
          </TabsContent>

          <TabsContent value="traffic">
            <TrafficPanel />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
