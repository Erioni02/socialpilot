import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis, Line, LineChart } from "recharts";
import {
  Megaphone,
  Article,
  PaintBrush,
  Compass,
  Globe,
  ChartLineUp,
  Plugs,
  Lightning,
  ArrowRight,
  ArrowSquareOut,
  CheckCircle,
  Circle,
  ChatsCircle,
  Robot,
  SealCheck,
  WarningCircle,
  Pause,
} from "@phosphor-icons/react";
import { api, p } from "@/lib/api";
import { ago, cn, fmtDate, fmtNum, fmtUsd, PLATFORM_LABEL, titleCase } from "@/lib/utils";
import { PageContainer } from "@/components/layout/AppShell";
import { CommandBar, PlatformIcon, SectionTitle } from "@/components/common";
import { Badge, Button, Card, CardBody, CardHeader, Empty, PageHeader, Progress, SetupCallout, Skeleton, StatusBadge, Tooltip } from "@/components/ui";

type Dash = {
  project: any;
  readiness: any;
  website: null | { url: string; status: { up: boolean; status?: number; responseMs?: number; checkedAt: string; error?: string }; latestAudit: null | { id: string; scores: any; finishedAt: string; pagesCrawled: number } };
  integrations: { id: string; provider: string; status: string; accountHandle: string | null; lastSyncAt: string | null; lastError: string | null; kind: string }[];
  social: { integrationId: string; platform: string; handle: string | null; status: string; followers: number | null; followerGrowth: number | null; growthWindowDays: number; series: { date: string; value: number }[]; note?: string; error?: string | null }[];
  web: { connected: false } | { connected: true; provider?: string; summary?: { totals: { sessions: number; users: number; pageviews: number; conversions: number | null }; daily: { date: string; sessions: number; users: number }[]; range: { start: string; end: string } }; needsConfig?: string; error?: string };
  upcoming: any[];
  recentPublished: any[];
  inbox: any[];
  opportunities: any[];
  trends: { id: string; title: string; url: string; sourceName: string; publishedAt: string | null; score: number | null; comments: number | null; matched: string[] }[];
  runningTasks: any[];
  recentActivity: any[];
  health: {
    pendingApprovals: number;
    failedTasks: { id: string; title: string; error: string | null; finishedAt: string }[];
    failedJobs: { id: string; name: string; lastError: string | null; updatedAt: string }[];
    budget: { today: number; month: number; dailyLimit: number; monthlyLimit: number; taskLimit: number };
    automations: { id: string; name: string; nextRunAt: string | null; lastRunAt: string | null }[];
  };
};

const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
const toneFor = (v: number) => (v >= 90 ? "red" : v >= 70 ? "yellow" : "ink");

function QuickActions({ id }: { id: string }) {
  const items = [
    { to: `/projects/${id}/campaigns`, label: "Create campaign", icon: Megaphone },
    { to: `/projects/${id}/content`, label: "Generate content", icon: Article },
    { to: `/projects/${id}/workspace`, label: "Generate image or video", icon: PaintBrush },
    { to: `/discover?project=${id}`, label: "Research trends", icon: Compass },
    { to: `/projects/${id}/website`, label: "Audit website", icon: Globe },
    { to: `/projects/${id}/analytics`, label: "View analytics", icon: ChartLineUp },
    { to: `/projects/${id}/integrations`, label: "Manage social accounts", icon: Plugs },
    { to: `/projects/${id}/automations`, label: "Create automation", icon: Lightning },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {items.map((it) => (
        <Link key={it.label} to={it.to} className="group flex items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 hover:border-line-strong transition-colors">
          <it.icon size={16} weight="bold" className="text-muted group-hover:text-ink shrink-0" />
          <span className="text-[12.5px] font-medium text-ink-2 group-hover:text-ink leading-tight">{it.label}</span>
        </Link>
      ))}
    </div>
  );
}

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11.5px] shadow-pop">
      <div className="text-muted">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="text-ink tabular-nums">
          {titleCase(p.dataKey)}: {fmtNum(p.value)}
        </div>
      ))}
    </div>
  );
}

function WebsiteBlock({ d, id }: { d: Dash; id: string }) {
  if (!d.website)
    return (
      <SetupCallout tone="blue" title="No website on this project" action={<Button asChild size="sm"><Link to={`/projects/${id}/settings`}>Add website</Link></Button>}>
        Add a URL to monitor uptime and run audits.
      </SetupCallout>
    );
  const s = d.website.status;
  const a = d.website.latestAudit;
  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
      <div className="min-w-0">
        <div className="text-[11.5px] text-muted">Website</div>
        <a href={d.website.url} target="_blank" rel="noreferrer" className="text-[13.5px] font-medium text-ink hover:underline inline-flex items-center gap-1 truncate max-w-[260px]">
          {d.website.url.replace(/^https?:\/\//, "").replace(/\/$/, "")} <ArrowSquareOut size={11} />
        </a>
        <div className="flex items-center gap-2 mt-1">
          <Badge tone={s.up ? "green" : "red"} dot>
            {s.up ? "Up" : "Down"}
          </Badge>
          <span className="text-[12px] text-muted tabular-nums">
            {s.status ? `HTTP ${s.status}` : s.error?.slice(0, 60)}
            {s.responseMs != null && ` · ${Math.round(s.responseMs)} ms`}
          </span>
        </div>
        <div className="text-[11px] text-faint mt-0.5">Checked {ago(s.checkedAt)}</div>
      </div>
      <div className="min-w-0">
        <div className="text-[11.5px] text-muted flex items-center gap-1.5">
          Latest audit {a && <span className="text-faint">· {ago(a.finishedAt)}</span>}
        </div>
        {a?.scores ? (
          <div className="flex items-end gap-4 mt-1">
            <div>
              <div className="text-[26px] font-semibold text-ink tabular-nums leading-none">{a.scores.overall ?? "—"}</div>
              <div className="text-[11px] text-muted mt-1">Overall</div>
            </div>
            {(["seo", "performance", "accessibility", "conversion"] as const).map((k) =>
              typeof a.scores[k] === "number" ? (
                <div key={k}>
                  <div className={cn("text-[15px] font-semibold tabular-nums leading-none", a.scores[k] < 50 ? "text-red-fg" : a.scores[k] < 75 ? "text-yellow-fg" : "text-ink")}>{a.scores[k]}</div>
                  <div className="text-[11px] text-muted mt-1">{k === "seo" ? "SEO" : titleCase(k)}</div>
                </div>
              ) : null,
            )}
          </div>
        ) : (
          <div className="mt-1 text-[12.5px] text-muted">
            No completed audit.{" "}
            <Link to={`/projects/${id}/website`} className="text-ink underline underline-offset-2">
              Run one
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function WebAnalyticsBlock({ d, id }: { d: Dash; id: string }) {
  const w = d.web;
  if (!w.connected)
    return (
      <SetupCallout title="Web analytics not connected" action={<Button asChild size="sm"><Link to={`/projects/${id}/integrations`}>Connect</Link></Button>}>
        Connect Google Analytics 4 or Plausible to see sessions, users and conversions.
      </SetupCallout>
    );
  if (w.error) return <SetupCallout tone="red" title={`${PLATFORM_LABEL[w.provider ?? ""] ?? "Analytics"} returned an error`}>{w.error}</SetupCallout>;
  if (w.needsConfig || !w.summary)
    return (
      <SetupCallout title="Analytics needs configuration" action={<Button asChild size="sm"><Link to={`/projects/${id}/integrations`}>Configure</Link></Button>}>
        {w.needsConfig ?? "No data returned yet."}
      </SetupCallout>
    );
  const t = w.summary.totals;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-[11.5px] text-muted">
          <PlatformIcon platform={w.provider ?? "ga4"} size={12} /> {PLATFORM_LABEL[w.provider ?? ""] ?? w.provider} · last 28 days
        </div>
        <Badge tone="green">Measured</Badge>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="text-[11.5px] text-muted">Sessions</div>
          <div className="text-[22px] font-semibold text-ink tabular-nums">{fmtNum(t.sessions)}</div>
        </div>
        <div>
          <div className="text-[11.5px] text-muted">Users</div>
          <div className="text-[22px] font-semibold text-ink tabular-nums">{fmtNum(t.users)}</div>
        </div>
        <div>
          <div className="text-[11.5px] text-muted">Conversions</div>
          <div className="text-[22px] font-semibold text-ink tabular-nums">{t.conversions == null ? "—" : fmtNum(t.conversions)}</div>
          {t.conversions == null && <div className="text-[11px] text-faint">No key events</div>}
        </div>
      </div>
      {w.summary.daily.length > 1 && (
        <div className="h-[110px] mt-3 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={w.summary.daily} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <XAxis dataKey="date" hide />
              <YAxis hide domain={[0, "auto"]} />
              <RTooltip content={<ChartTip />} cursor={{ stroke: "#dcdcd9" }} />
              <Area type="monotone" dataKey="sessions" stroke="#111" strokeWidth={1.5} fill="#111" fillOpacity={0.05} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function SocialBlock({ d, id }: { d: Dash; id: string }) {
  if (!d.social.length)
    return (
      <SetupCallout title="No social accounts connected" action={<Button asChild size="sm"><Link to={`/projects/${id}/integrations`}>Connect</Link></Button>}>
        Connect Instagram, TikTok or X to track followers and publish.
      </SetupCallout>
    );
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {d.social.map((s) => (
        <div key={s.integrationId} className="rounded-lg border border-line p-3">
          <div className="flex items-center gap-2">
            <PlatformIcon platform={s.platform} size={14} />
            <span className="text-[12.5px] font-medium text-ink truncate">{s.handle ? `@${s.handle}` : PLATFORM_LABEL[s.platform]}</span>
            {s.status !== "connected" && <StatusBadge status={s.status} className="ml-auto" />}
          </div>
          {s.status === "public_only" ? (
            <p className="text-[12px] text-muted mt-2">{s.note ?? "Public profile only — connect via OAuth to read metrics."}</p>
          ) : s.followers == null ? (
            <p className="text-[12px] text-muted mt-2">{s.error ? <span className="text-red-fg">{s.error.slice(0, 140)}</span> : "No follower data synced yet."}</p>
          ) : (
            <div className="flex items-end justify-between gap-2 mt-2">
              <div>
                <div className="text-[20px] font-semibold text-ink tabular-nums leading-none">{fmtNum(s.followers)}</div>
                <div className="text-[11.5px] mt-1 tabular-nums">
                  {s.followerGrowth != null ? (
                    <span className={s.followerGrowth > 0 ? "text-green-fg" : s.followerGrowth < 0 ? "text-red-fg" : "text-muted"}>
                      {s.followerGrowth > 0 ? "+" : ""}
                      {fmtNum(s.followerGrowth)} in {s.growthWindowDays}d
                    </span>
                  ) : (
                    <span className="text-muted">followers</span>
                  )}
                </div>
              </div>
              {s.series.length > 1 && (
                <div className="h-8 w-24">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={s.series}>
                      <YAxis hide domain={["auto", "auto"]} />
                      <Line type="monotone" dataKey="value" stroke="#111" strokeWidth={1.25} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PostLine({ title, sub, right, to }: { title: string; sub: React.ReactNode; right?: React.ReactNode; to?: string }) {
  const inner = (
    <div className="flex items-start gap-3 px-5 py-2.5 hover:bg-subtle transition-colors">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-ink truncate">{title}</div>
        <div className="text-[11.5px] text-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">{sub}</div>
      </div>
      {right}
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

const postTitle = (p: { title?: string; body?: string }) => p.title?.trim() || p.body?.trim().slice(0, 90) || "Untitled post";

function HealthCard({ d, id }: { d: Dash; id: string }) {
  const h = d.health;
  const ai = d.readiness?.ai ?? {};
  const todayPct = pct(h.budget.today, h.budget.dailyLimit);
  const monthPct = pct(h.budget.month, h.budget.monthlyLimit);
  return (
    <Card>
      <CardHeader title="Project health" />
      <CardBody className="space-y-5">
        <div>
          <div className="text-[11.5px] text-muted mb-1.5">Integrations</div>
          {d.integrations.length ? (
            <ul className="space-y-1.5">
              {d.integrations.map((i) => (
                <li key={i.id} className="flex items-center gap-2 text-[12.5px]">
                  <PlatformIcon platform={i.provider} size={13} className="text-ink-2" />
                  <span className="truncate text-ink-2">{PLATFORM_LABEL[i.provider] ?? i.provider}</span>
                  {i.accountHandle && <span className="text-faint truncate">@{i.accountHandle}</span>}
                  <span className="ml-auto">
                    {i.lastError && i.status !== "public_only" ? (
                      <Tooltip content={i.lastError}>
                        <span>
                          <StatusBadge status={i.status} />
                        </span>
                      </Tooltip>
                    ) : (
                      <StatusBadge status={i.status} />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Link to={`/projects/${id}/integrations`} className="text-[12.5px] text-ink underline underline-offset-2">
              Connect your first account
            </Link>
          )}
        </div>
        <div>
          <div className="text-[11.5px] text-muted mb-1.5">AI providers</div>
          <div className="flex flex-wrap gap-3">
            {(["text", "image", "video"] as const).map((k) => (
              <span key={k} className={cn("inline-flex items-center gap-1 text-[12.5px]", ai[k] ? "text-ink-2" : "text-faint")}>
                {ai[k] ? <CheckCircle size={13} weight="fill" className="text-green-fg" /> : <Circle size={13} />} {titleCase(k)}
              </span>
            ))}
          </div>
          {!ai.text && (
            <Link to="/settings" className="text-[12px] text-ink underline underline-offset-2 mt-1 inline-block">
              Add an AI key
            </Link>
          )}
        </div>
        <Link to={`/projects/${id}/approvals`} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 hover:border-line-strong">
          <span className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <SealCheck size={14} weight="bold" /> Pending approvals
          </span>
          <span className={cn("text-[13px] font-semibold tabular-nums", h.pendingApprovals ? "text-yellow-fg" : "text-muted")}>{h.pendingApprovals}</span>
        </Link>
        <div>
          <div className="text-[11.5px] text-muted mb-2">AI budget</div>
          <div className="space-y-2.5">
            <div>
              <div className="flex justify-between text-[12px] mb-1">
                <span className="text-ink-2">Today</span>
                <span className="tabular-nums text-muted">
                  {fmtUsd(h.budget.today)} / {fmtUsd(h.budget.dailyLimit)}
                </span>
              </div>
              <Progress value={todayPct} tone={toneFor(todayPct)} />
            </div>
            <div>
              <div className="flex justify-between text-[12px] mb-1">
                <span className="text-ink-2">This month</span>
                <span className="tabular-nums text-muted">
                  {fmtUsd(h.budget.month)} / {fmtUsd(h.budget.monthlyLimit)}
                </span>
              </div>
              <Progress value={monthPct} tone={toneFor(monthPct)} />
            </div>
            <div className="text-[11.5px] text-faint">Max {fmtUsd(h.budget.taskLimit)} per task</div>
          </div>
        </div>
        {(h.failedTasks.length > 0 || h.failedJobs.length > 0) && (
          <div>
            <div className="text-[11.5px] text-muted mb-1.5">Failures · last 7 days</div>
            <ul className="space-y-1.5">
              {h.failedTasks.map((t) => (
                <li key={t.id} className="text-[12px]">
                  <Link to={`/projects/${id}/agents?task=${t.id}`} className="flex items-start gap-1.5 text-ink-2 hover:text-ink">
                    <WarningCircle size={13} className="text-red-fg mt-0.5 shrink-0" />
                    <span className="min-w-0">
                      <span className="block truncate">{t.title}</span>
                      {t.error && <span className="block text-faint truncate">{t.error}</span>}
                    </span>
                  </Link>
                </li>
              ))}
              {h.failedJobs.map((j) => (
                <li key={j.id} className="flex items-start gap-1.5 text-[12px] text-ink-2">
                  <WarningCircle size={13} className="text-red-fg mt-0.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block font-mono text-[11.5px]">{j.name}</span>
                    {j.lastError && <span className="block text-faint truncate">{j.lastError}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <div className="text-[11.5px] text-muted mb-1.5">Scheduled automations</div>
          {h.automations.length ? (
            <ul className="space-y-1.5">
              {h.automations.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="truncate text-ink-2">{a.name}</span>
                  <span className="text-[11.5px] text-muted shrink-0">{a.nextRunAt ? fmtDate(a.nextRunAt, "MMM d, HH:mm") : "manual"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Link to={`/projects/${id}/automations`} className="text-[12.5px] text-muted hover:text-ink">
              None active
            </Link>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-28" />
      <Skeleton className="h-16" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-80 lg:col-span-2" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { projectId } = useParams();
  const id = projectId!;
  const { data: d, isLoading, error } = useQuery({ queryKey: ["dashboard", id], queryFn: () => api.get<Dash>(p(id, "/dashboard")), refetchInterval: 120_000 });

  if (error)
    return (
      <PageContainer wide>
        <SetupCallout tone="red" title="Could not load the command center">
          {(error as Error).message}
        </SetupCallout>
      </PageContainer>
    );
  if (isLoading || !d)
    return (
      <PageContainer wide>
        <DashboardSkeleton />
      </PageContainer>
    );

  const pr = d.project;
  const name = pr.name;
  const presets = [
    `Analyze ${name}, research what's trending, find five marketing opportunities, create a seven-day campaign, generate promotional images, audit the website and prepare the best changes for review`,
    `Research what's trending this week that is relevant to ${name} and draft three posts`,
    `Audit the ${name} website and propose the three highest-impact fixes`,
    `Summarize ${name}'s performance over the last 28 days and suggest next steps`,
  ];

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Command center"
        title={name}
        description={pr.description ? <span className="line-clamp-2">{pr.description}</span> : undefined}
        actions={
          <>
            {pr.paused && (
              <Badge tone="yellow" dot>
                Paused
              </Badge>
            )}
            <Button asChild size="sm">
              <Link to={`/projects/${id}/settings`}>Project settings</Link>
            </Button>
          </>
        }
      />

      <div className="space-y-3 mb-5">
        {!pr.setupComplete && (
          <SetupCallout
            tone="blue"
            title={`Setup is ${Math.round(((pr.setupStep ?? 1) / 8) * 100)}% done`}
            action={
              <Button asChild size="sm" variant="primary">
                <Link to={`/projects/${id}/setup?step=${Math.max(3, pr.setupStep ?? 3)}`}>
                  Continue setup <ArrowRight size={12} weight="bold" />
                </Link>
              </Button>
            }
          >
            Finish the profile, connections, AI providers and permissions so agents can work with full context.
          </SetupCallout>
        )}
        {pr.paused && (
          <SetupCallout title="This project is paused" action={<Button asChild size="sm"><Link to={`/projects/${id}/settings?tab=permissions`}><Pause size={12} /> Manage</Link></Button>}>
            Automations, scheduled publishing and agent actions are on hold until you resume it.
          </SetupCallout>
        )}
      </div>

      <div className="mb-4">
        <CommandBar projectId={id} presets={presets} placeholder={`Ask the AI to do something for ${name} — e.g. “${presets[1]}”`} />
      </div>
      <div className="mb-8">
        <QuickActions id={id} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3 items-start">
        <div className="lg:col-span-2 space-y-6 min-w-0">
          <section>
            <SectionTitle>Business overview</SectionTitle>
            <Card>
              <CardBody className="pt-5 space-y-6">
                <WebsiteBlock d={d} id={id} />
                <div className="h-px bg-line" />
                <WebAnalyticsBlock d={d} id={id} />
                <div className="h-px bg-line" />
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11.5px] text-muted">Social followers</div>
                    <Link to={`/projects/${id}/analytics`} className="text-[11.5px] text-muted hover:text-ink">
                      Analytics →
                    </Link>
                  </div>
                  <SocialBlock d={d} id={id} />
                </div>
              </CardBody>
            </Card>
          </section>

          <section>
            <SectionTitle action={<Link to={`/projects/${id}/calendar`} className="text-[11.5px] text-muted hover:text-ink">Calendar →</Link>}>Content</SectionTitle>
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader title="Upcoming" description="Scheduled or in review" />
                {d.upcoming.length ? (
                  <div className="border-t border-line divide-y divide-line pb-1">
                    {d.upcoming.map((post) => (
                      <PostLine
                        key={post.id}
                        to={`/projects/${id}/content/${post.id}`}
                        title={postTitle(post)}
                        sub={
                          <>
                            <span>{fmtDate(post.scheduledAt, "EEE MMM d, HH:mm")}</span>
                            <span className="inline-flex gap-1">
                              {post.targets.map((t: any, i: number) => (
                                <PlatformIcon key={i} platform={t.platform} size={11} />
                              ))}
                            </span>
                          </>
                        }
                        right={<StatusBadge status={post.status} />}
                      />
                    ))}
                  </div>
                ) : (
                  <Empty className="py-8" title="Nothing scheduled" action={<Button asChild size="sm"><Link to={`/projects/${id}/content`}>Create a post</Link></Button>} />
                )}
              </Card>
              <Card>
                <CardHeader title="Recently published" />
                {d.recentPublished.length ? (
                  <div className="border-t border-line divide-y divide-line pb-1">
                    {d.recentPublished.map((t) => {
                      const metrics = Object.entries((t.metrics ?? {}) as Record<string, number>).slice(0, 3);
                      return (
                        <PostLine
                          key={t.id}
                          title={postTitle(t.post)}
                          sub={
                            <>
                              <PlatformIcon platform={t.platform} size={11} />
                              <span>{ago(t.publishedAt)}</span>
                              {metrics.map(([k, v]) => (
                                <span key={k} className="tabular-nums">
                                  {fmtNum(Number(v))} {k}
                                </span>
                              ))}
                            </>
                          }
                          right={
                            t.remoteUrl ? (
                              <a href={t.remoteUrl} target="_blank" rel="noreferrer" className="text-muted hover:text-ink mt-0.5" aria-label="Open published post">
                                <ArrowSquareOut size={14} />
                              </a>
                            ) : undefined
                          }
                        />
                      );
                    })}
                  </div>
                ) : (
                  <Empty className="py-8" title="Nothing published yet" description="Published posts and their measured metrics appear here." />
                )}
              </Card>
            </div>
          </section>

          <section>
            <SectionTitle action={<Link to={`/projects/${id}/inbox`} className="text-[11.5px] text-muted hover:text-ink">Inbox →</Link>}>Needs attention</SectionTitle>
            <Card>
              {d.inbox.length ? (
                <div className="divide-y divide-line py-1">
                  {d.inbox.map((m) => (
                    <Link key={m.id} to={`/projects/${id}/inbox?item=${m.id}`} className="flex items-start gap-3 px-5 py-2.5 hover:bg-subtle">
                      <PlatformIcon platform={m.platform} size={14} className="mt-0.5 text-ink-2" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] text-muted">
                          {m.authorHandle ? `@${m.authorHandle}` : m.authorName ?? "Someone"} · {m.kind} · {ago(m.receivedAt)}
                        </div>
                        <div className="text-[13px] text-ink-2 line-clamp-2">{m.text}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <StatusBadge status={m.status} />
                        {m.classification && <span className="text-[11px] text-muted">{m.classification.replace(/_/g, " ")}</span>}
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <Empty className="py-8" icon={<ChatsCircle size={18} />} title="Inbox is clear" description={d.social.some((s) => s.status === "connected") ? "No comments or mentions need a response." : "Connect a social account to collect comments and mentions."} />
              )}
            </Card>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="min-w-0">
              <SectionTitle action={<Link to={`/discover?project=${id}`} className="text-[11.5px] text-muted hover:text-ink">Discover →</Link>}>Relevant trends · 48h</SectionTitle>
              <Card>
                {d.trends.length ? (
                  <ul className="divide-y divide-line py-1">
                    {d.trends.map((t) => (
                      <li key={t.id} className="px-5 py-2.5">
                        <a href={t.url} target="_blank" rel="noreferrer" className="text-[13px] text-ink hover:underline line-clamp-2">
                          {t.title}
                        </a>
                        <div className="text-[11.5px] text-muted mt-0.5 flex flex-wrap gap-x-2">
                          <span>{t.sourceName}</span>
                          {t.publishedAt && <span>{ago(t.publishedAt)}</span>}
                          {t.score != null && <span className="tabular-nums">{fmtNum(t.score)} {/hacker ?news|^hn/i.test(t.sourceName) ? "points" : "score"}</span>}
                          {t.comments != null && <span className="tabular-nums">{fmtNum(t.comments)} comments</span>}
                        </div>
                        {t.matched.length > 0 && <div className="text-[11px] text-faint mt-0.5">Matches: {t.matched.slice(0, 4).join(", ")}</div>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty className="py-8" icon={<Compass size={18} />} title="No matching trends" description="Add keywords to the project profile to match more sources." />
                )}
              </Card>
            </div>
            <div className="min-w-0">
              <SectionTitle>AI opportunities</SectionTitle>
              <Card>
                {d.opportunities.length ? (
                  <ul className="divide-y divide-line py-1">
                    {d.opportunities.map((o) => (
                      <li key={o.id} className="px-5 py-2.5">
                        <div className="flex items-start gap-2">
                          <span className="text-[13px] text-ink font-medium flex-1">{o.title}</span>
                          <Badge tone={o.method === "ai" ? "purple" : "yellow"}>{o.method === "ai" ? "AI hypothesis" : "Heuristic"}</Badge>
                        </div>
                        {o.whyItMatters && <p className="text-[12px] text-muted mt-0.5 line-clamp-2">{o.whyItMatters}</p>}
                        <div className="text-[11.5px] text-faint mt-1 flex items-center gap-2">
                          {o.platform && <PlatformIcon platform={o.platform} size={11} />}
                          {o.timeliness && <span>{o.timeliness}</span>}
                          {Array.isArray(o.sources) && o.sources.length > 0 && <span>{o.sources.length} source{o.sources.length === 1 ? "" : "s"}</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty className="py-8" title="No open opportunities" action={<Button asChild size="sm"><Link to={`/discover?project=${id}`}>Find opportunities</Link></Button>} />
                )}
              </Card>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="min-w-0">
              <SectionTitle action={<Link to={`/projects/${id}/agents`} className="text-[11.5px] text-muted hover:text-ink">All tasks →</Link>}>Running tasks</SectionTitle>
              <Card>
                {d.runningTasks.length ? (
                  <ul className="divide-y divide-line py-1">
                    {d.runningTasks.map((t) => (
                      <li key={t.id}>
                        <Link to={`/projects/${id}/agents?task=${t.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-subtle">
                          <Robot size={14} className="text-muted shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] text-ink truncate">{t.title}</div>
                            <div className="text-[11.5px] text-muted">
                              {titleCase(t.agentType)} · started {ago(t.startedAt ?? t.createdAt)}
                            </div>
                          </div>
                          <StatusBadge status={t.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty className="py-8" icon={<Robot size={18} />} title="No tasks running" description="Use the command bar above to start one." />
                )}
              </Card>
            </div>
            <div className="min-w-0">
              <SectionTitle>Recent activity</SectionTitle>
              <Card>
                {d.recentActivity.length ? (
                  <ul className="py-2">
                    {d.recentActivity.map((a) => (
                      <li key={a.id} className="flex items-start gap-2.5 px-5 py-1.5">
                        <span className={cn("mt-1.5 h-1.5 w-1.5 rounded-full shrink-0", a.actor === "user" ? "bg-line-strong" : "bg-ink")} />
                        <div className="min-w-0 flex-1 text-[12.5px]">
                          <span className="text-ink-2">{a.action.replace(/[._]/g, " ")}</span>
                          <span className="text-faint"> · {a.actor.startsWith("agent:") ? titleCase(a.actor.slice(6)) : a.actor}</span>
                        </div>
                        <span className="text-[11px] text-faint shrink-0">{ago(a.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty className="py-8" title="No activity yet" />
                )}
              </Card>
            </div>
          </section>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-4">
          <HealthCard d={d} id={id} />
        </aside>
      </div>
    </PageContainer>
  );
}
