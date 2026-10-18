import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { ArrowsClockwise, MagicWand, Trophy } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Badge, Button, Card, CardBody, CardHeader, Dialog, DialogContent, Empty, Field, Input, Skeleton, Table, Td, Textarea, Th, Tooltip } from "@/components/ui";
import { PlatformIcon } from "@/components/common";
import { api, p } from "@/lib/api";
import { ago, cn, fmtNum, toastError } from "@/lib/utils";
import { onServerEvent } from "@/hooks/useEvents";
import { axisProps, CHART, shortDate, tooltipProps } from "./shared";
import { AudiencePanel, useRapidStatus, type AudienceInsights } from "./Audience";

type FeedPost = { id: string; url: string; date?: string; type?: string; image?: string; views?: number; likes?: number; comments?: number; shares?: number; er?: number; grade?: string; indexGrade?: number; hashtags?: string[] };
type Row = { name: string; count: number; grade?: number; er?: number };
type Account = {
  integrationId: string;
  platform: string;
  handle: string | null;
  name: string | null;
  avatar: string | null;
  url: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  stats: { followers?: number; avgER?: number; avgLikes?: number; avgViews?: number; qualityScore?: number; fakeFollowersPct?: number; growth180dPct?: number; updatedAt?: string } | null;
  audience: AudienceInsights | null;
  followersSeries: { date: string; value: number }[];
  followerChange: number | null;
  feed: { fetchedAt: string; postCount: number; medianER: number | null; medianViews: number | null; top: FeedPost[]; bottom: FeedPost[]; recent: FeedPost[]; types: Row[]; hashtags: Row[]; textLength: Row[] } | null;
};

const pct = (n?: number | null, d = 2) => (n == null ? "—" : `${(n * 100).toFixed(d)}%`);
const GRADE: Record<string, { label: string; tone: "green" | "blue" | "gray" | "yellow" | "red" }> = {
  a_plus: { label: "A+", tone: "green" },
  a: { label: "A", tone: "blue" },
  b: { label: "B", tone: "gray" },
  c: { label: "C", tone: "yellow" },
  d: { label: "D", tone: "red" },
};
const TEXT_LEN: Record<string, string> = { short: "Very short", small: "Short", middle: "Medium", long: "Long", huge: "Very long" };
const PLATFORM_NAME: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", x: "X" };

function GradeBadge({ g }: { g?: string }) {
  if (!g || !GRADE[g]) return <span className="text-faint">—</span>;
  return (
    <Tooltip content="Performance vs. this account's own similar posts over the last 3 months (A+ = more than 2× better)">
      <span>
        <Badge tone={GRADE[g].tone}>{GRADE[g].label}</Badge>
      </span>
    </Tooltip>
  );
}

function WorksTable({ title, rows, label = (n: string) => n }: { title: string; rows: Row[]; label?: (n: string) => string }) {
  if (!rows.length) return null;
  const best = rows[0];
  return (
    <div>
      <div className="text-[12px] font-medium text-ink mb-1.5">{title}</div>
      <div className="space-y-1">
        {rows.slice(0, 6).map((r) => (
          <div key={r.name} className={cn("grid grid-cols-[1fr_60px_70px] gap-2 text-[12px] items-center", r === best && "font-medium text-ink")}>
            <span className="truncate">{label(r.name)}</span>
            <span className="text-right tabular-nums text-muted">{r.count} posts</span>
            <span className="text-right tabular-nums">{pct(r.er)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountCard({ projectId, a }: { projectId: string; a: Account }) {
  const qc = useQueryClient();
  const rapid = useRapidStatus();
  const [tab, setTab] = React.useState<"posts" | "works" | "audience">("posts");
  const sync = useMutation({
    mutationFn: () => api.post<{ ok?: boolean; error?: string; skipped?: string }>(p(projectId, `/integrations/${a.integrationId}/sync`)),
    onSuccess: (r) => {
      if (r.ok) toast.success("Analytics refreshed");
      else toast.error(r.error ?? r.skipped ?? "Nothing refreshed");
      qc.invalidateQueries({ queryKey: ["linked-accounts", projectId] });
      qc.invalidateQueries({ queryKey: ["intel", "rapidapi"] });
    },
    onError: (e) => toastError(e),
  });
  const f = a.feed;
  return (
    <Card>
      <CardHeader
        icon={<PlatformIcon platform={a.platform} size={15} />}
        title={
          <span className="flex items-center gap-2">
            <a href={a.url ?? "#"} target="_blank" rel="noopener noreferrer" className="hover:underline">
              @{a.handle}
            </a>
            <span className="text-[12px] font-normal text-muted">{PLATFORM_NAME[a.platform]}</span>
          </span>
        }
        description={a.lastSyncAt ? `Updated ${ago(a.lastSyncAt)}${f ? ` · ${f.postCount} posts from the last 60 days` : ""}` : "Waiting for the first sync"}
        action={
          rapid.data?.configured ? (
            <Tooltip content={`Refresh stats, audience and post analytics · 2 requests (${rapid.data.budgetLeft} left this month)`}>
              <span>
                <Button size="sm" loading={sync.isPending} disabled={rapid.data.budgetLeft < 2} onClick={() => sync.mutate()}>
                  <ArrowsClockwise size={12} /> Refresh
                </Button>
              </span>
            </Tooltip>
          ) : undefined
        }
      />
      <CardBody className="space-y-4">
        {a.lastError && <div className="text-[12px] text-yellow-fg">{a.lastError}</div>}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            ["Followers", a.stats?.followers != null ? fmtNum(a.stats.followers) : "—"],
            ["Change (tracked)", a.followerChange != null ? `${a.followerChange >= 0 ? "+" : ""}${fmtNum(a.followerChange)}` : "—"],
            ["Avg. engagement", pct(a.stats?.avgER)],
            ["Median post ER (60d)", pct(f?.medianER)],
            ["Median views (60d)", f?.medianViews != null ? fmtNum(f.medianViews) : "—"],
            ["Quality score", a.stats?.qualityScore != null ? `${Math.round(a.stats.qualityScore * 100)}/100` : "—"],
          ].map(([l, v]) => (
            <div key={l} className="rounded-lg border border-line px-3 py-2">
              <div className="text-[11px] text-muted">{l}</div>
              <div className="text-[16px] font-semibold tabular-nums text-ink">{v}</div>
            </div>
          ))}
        </div>

        {a.followersSeries.length >= 2 && (
          <div className="h-[140px]">
            <ResponsiveContainer>
              <AreaChart data={a.followersSeries}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} />
                <YAxis tickFormatter={(v) => fmtNum(v)} {...axisProps} width={48} domain={["auto", "auto"]} />
                <RTooltip {...tooltipProps} labelFormatter={(d) => shortDate(String(d))} formatter={(v) => [fmtNum(Number(v)), "Followers"]} />
                <Area type="monotone" dataKey="value" stroke={CHART.ink} fill={CHART.ink} fillOpacity={0.06} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="inline-flex rounded-md border border-line p-0.5">
          {(
            [
              ["posts", "Posts"],
              ["works", "What works"],
              ["audience", "Audience"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={cn("px-3 py-1 rounded-[5px] text-[12.5px]", tab === k ? "bg-ink text-white" : "text-muted hover:text-ink")}>
              {l}
            </button>
          ))}
        </div>

        {tab === "posts" &&
          (f?.recent.length ? (
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Post</Th>
                    <Th>Type</Th>
                    <Th className="text-right">Views</Th>
                    <Th className="text-right">Likes</Th>
                    <Th className="text-right">Comments</Th>
                    <Th className="text-right">Shares</Th>
                    <Th className="text-right">ER</Th>
                    <Th>Grade</Th>
                  </tr>
                </thead>
                <tbody>
                  {[...f.recent].map((x) => (
                    <tr key={x.id}>
                      <Td>
                        <a href={x.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:underline min-w-[160px]">
                          {x.image ? <img src={x.image} alt="" className="h-8 w-8 rounded object-cover border border-line" referrerPolicy="no-referrer" loading="lazy" /> : null}
                          <span className="text-[12px] text-muted">{x.date ? shortDate(x.date) : "post"}</span>
                        </a>
                      </Td>
                      <Td className="text-[12px] text-muted">{x.type ?? "—"}</Td>
                      <Td className="text-right tabular-nums">{x.views != null ? fmtNum(x.views) : "—"}</Td>
                      <Td className="text-right tabular-nums">{x.likes != null ? fmtNum(x.likes) : "—"}</Td>
                      <Td className="text-right tabular-nums">{x.comments != null ? fmtNum(x.comments) : "—"}</Td>
                      <Td className="text-right tabular-nums">{x.shares != null ? fmtNum(x.shares) : "—"}</Td>
                      <Td className="text-right tabular-nums">{pct(x.er)}</Td>
                      <Td>
                        <GradeBadge g={x.grade} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : (
            <p className="text-[12.5px] text-muted">Per-post analytics appear after the first statistics sync{rapid.data?.configured ? "" : " (needs a RapidAPI key)"}.</p>
          ))}

        {tab === "works" &&
          (f && (f.types.length || f.hashtags.length || f.textLength.length) ? (
            <div className="grid md:grid-cols-3 gap-5">
              <WorksTable title="Post format" rows={f.types} />
              <WorksTable title="Caption length" rows={f.textLength} label={(n) => TEXT_LEN[n] ?? n} />
              <WorksTable title="Hashtags (used ≥ 2×)" rows={f.hashtags} label={(n) => `#${n}`} />
              {f.top[0] && (
                <div className="md:col-span-3 flex items-start gap-2 text-[12.5px] rounded-lg bg-subtle px-3 py-2.5">
                  <Trophy size={14} className="text-yellow-fg mt-0.5 shrink-0" />
                  <span>
                    Best recent post:{" "}
                    <a href={f.top[0].url} target="_blank" rel="noopener noreferrer" className="underline">
                      {f.top[0].type ?? "post"} {f.top[0].date ? `from ${shortDate(f.top[0].date)}` : ""}
                    </a>{" "}
                    — {f.top[0].views != null ? `${fmtNum(f.top[0].views)} views, ` : ""}
                    {pct(f.top[0].er)} ER, grade {GRADE[f.top[0].grade ?? ""]?.label ?? "—"}. The AI uses these patterns when planning your next posts.
                  </span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[12.5px] text-muted">Needs post analytics from a statistics sync.</p>
          ))}

        {tab === "audience" && (a.audience ? <AudiencePanel a={a.audience} /> : <p className="text-[12.5px] text-muted">Audience demographics appear after a statistics sync.</p>)}
      </CardBody>
    </Card>
  );
}

/** Ask the AI to study the analytics and prepare the next posts on Ready to post. */
export function PlanNextPostsButton({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const [count, setCount] = React.useState("3");
  const [notes, setNotes] = React.useState("");
  const plan = useMutation({
    mutationFn: () => api.post<{ task: { id: string } }>(p(projectId, "/plan-next-posts"), { count: Math.min(10, Math.max(1, Number(count) || 3)), notes: notes.trim() || undefined }),
    onSuccess: (r) => {
      setOpen(false);
      toast.success("The AI is studying your analytics and preparing posts", { description: "They'll appear on Ready to post with media and captions.", action: { label: "Watch", onClick: () => navigate(`/projects/${projectId}/agents?task=${r.task.id}`) } });
    },
    onError: (e) => toastError(e),
  });
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <MagicWand size={14} weight="bold" /> Plan my next posts
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Plan my next posts"
          description="The AI reads your account and post analytics (what formats, hooks, hashtags and caption lengths perform best) plus current trends, then creates finished posts with images or videos and puts them on Ready to post for you to publish."
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={plan.isPending} onClick={() => plan.mutate()}>
                Start
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Field label="How many posts">
              <Input type="number" min={1} max={10} value={count} onChange={(e) => setCount(e.target.value)} className="w-24" />
            </Field>
            <Field label="Anything to focus on? (optional)">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. promote the new feature launching Friday; more Reels" rows={3} />
            </Field>
            <p className="text-[12px] text-muted">Uses your AI and media providers (counts toward the project budget).</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AccountAnalytics({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["linked-accounts", projectId], queryFn: () => api.get<{ accounts: Account[] }>(p(projectId, "/analytics/accounts")) });
  React.useEffect(() => onServerEvent((e) => e.type === "integration.updated" && qc.invalidateQueries({ queryKey: ["linked-accounts", projectId] })), [qc, projectId]);
  if (q.isLoading) return <Skeleton className="h-48" />;
  const accounts = q.data?.accounts ?? [];
  if (!accounts.length)
    return (
      <Empty
        title="No social accounts linked"
        description="Paste your Instagram, TikTok or X profile URL on the Integrations page. The AI uses these analytics to decide what to post next."
        action={
          <Button asChild variant="primary">
            <Link to={`/projects/${projectId}/integrations`}>Link accounts</Link>
          </Button>
        }
      />
    );
  return (
    <div className="space-y-4">
      {accounts.map((a) => (
        <AccountCard key={a.integrationId} projectId={projectId} a={a} />
      ))}
    </div>
  );
}
