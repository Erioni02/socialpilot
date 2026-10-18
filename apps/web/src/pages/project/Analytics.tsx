import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { ChartLineUp, Flask, Lightbulb, Ruler, Sparkle, TrendDown, TrendUp, Warning } from "@phosphor-icons/react";
import { PageContainer } from "@/components/layout/AppShell";
import { Badge, Button, Card, CardBody, CardHeader, Empty, PageHeader, Skeleton, StatusBadge, Table, Td, Th } from "@/components/ui";
import { api, p } from "@/lib/api";
import { fmtNum, titleCase, toastError } from "@/lib/utils";
import { axisProps, CHART, Legend, SERIES_COLORS, shortDate, tooltipProps } from "@/components/insights/shared";
import { SocialSection, type SocialAccount } from "@/components/insights/SocialSection";
import { WebSection, type WebResponse } from "@/components/insights/WebSection";
import { TrafficPanel } from "@/components/insights/TrafficPanel";
import { PostPerformance } from "@/components/insights/PostPerformance";
import { useProject } from "@/components/common";

type CampaignPerf = {
  id: string;
  name: string;
  slug: string;
  status: string;
  posts: number;
  published: number;
  scheduled: number;
  socialTotals: Record<string, number>;
  webSessions: number | null;
  webConversions: number | null;
};
type PagespeedPoint = { id: string; metric: string; value: number; dimension: string; date: string };
type Insights = {
  facts: { label: string; value: string; source: string }[];
  hypotheses: null | { working: string[]; declining: string[]; hypotheses: string[]; testsToRun: { test: string; metric: string; expectedEffect: string }[] };
  note: string | null;
};

function SectionIntro({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
      <div>
        <h2 className="text-[12px] uppercase tracking-[0.08em] text-muted font-medium">{title}</h2>
        <p className="text-[12.5px] text-muted mt-0.5 max-w-2xl">{children}</p>
      </div>
      {action}
    </div>
  );
}

// ───────────── Campaigns ─────────────
function CampaignTable({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({ queryKey: ["analytics", projectId, "campaigns"], queryFn: () => api.get<{ campaigns: CampaignPerf[] }>(p(projectId, "/analytics/campaigns")) });
  const rows = data?.campaigns ?? [];
  if (isLoading) return <Skeleton className="h-40 rounded-xl" />;
  if (!rows.length)
    return (
      <Card>
        <Empty
          title="No campaigns yet"
          description="Campaign results appear here once you create a campaign and publish its posts."
          action={
            <Button asChild size="sm">
              <Link to={`/projects/${projectId}/campaigns`}>Go to campaigns</Link>
            </Button>
          }
        />
      </Card>
    );
  return (
    <Card>
      <Table>
        <thead>
          <tr>
            <Th className="pl-5">Campaign</Th>
            <Th className="text-right">Posts</Th>
            <Th className="text-right">Published</Th>
            <Th className="text-right">Scheduled</Th>
            <Th>Social totals (published targets)</Th>
            <Th className="text-right">UTM sessions</Th>
            <Th className="text-right pr-5">UTM conversions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const totals = Object.entries(c.socialTotals).sort((a, b) => b[1] - a[1]);
            return (
              <tr key={c.id}>
                <Td className="pl-5">
                  <Link to={`/projects/${projectId}/campaigns/${c.id}`} className="font-medium text-ink hover:underline underline-offset-2">
                    {c.name}
                  </Link>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <StatusBadge status={c.status} />
                    <span className="font-mono text-[11px] text-faint">utm_campaign={c.slug}</span>
                  </div>
                </Td>
                <Td className="text-right tabular-nums">{c.posts}</Td>
                <Td className="text-right tabular-nums">{c.published}</Td>
                <Td className="text-right tabular-nums">{c.scheduled}</Td>
                <Td>
                  {totals.length ? (
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px]">
                      {totals.slice(0, 5).map(([k, v]) => (
                        <span key={k}>
                          <span className="text-muted">{titleCase(k)}</span> <span className="tabular-nums text-ink">{fmtNum(v)}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[12px] text-muted">{c.published ? "No metrics synced yet" : "Nothing published"}</span>
                  )}
                </Td>
                <Td className="text-right tabular-nums">{c.webSessions == null ? <span className="text-[12px] text-muted">no UTM traffic measured</span> : fmtNum(c.webSessions)}</Td>
                <Td className="text-right tabular-nums pr-5">{c.webConversions == null ? <span className="text-[12px] text-muted">{c.webSessions == null ? "no UTM traffic measured" : "not tracked"}</span> : fmtNum(c.webConversions)}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}

// ───────────── PageSpeed ─────────────
function PagespeedHistory({ projectId }: { projectId: string }) {
  const { data } = useQuery({ queryKey: ["analytics", projectId, "pagespeed"], queryFn: () => api.get<{ points: PagespeedPoint[] }>(p(projectId, "/analytics/pagespeed")) });
  const points = data?.points ?? [];
  const { rows, metrics } = React.useMemo(() => {
    const byDate = new Map<string, Record<string, number | string>>();
    const ms = new Set<string>();
    for (const pt of points) {
      const d = pt.date.slice(0, 10);
      ms.add(pt.metric);
      byDate.set(d, { ...(byDate.get(d) ?? { date: d }), [pt.metric]: pt.value });
    }
    return { rows: [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))), metrics: [...ms] };
  }, [points]);
  if (!points.length) return null;
  const last = rows[rows.length - 1];
  return (
    <section>
      <SectionIntro title="PageSpeed history">Google Lighthouse scores (mobile, 0–100) recorded each time a website audit runs.</SectionIntro>
      <Card>
        <CardBody className="pt-4 space-y-4">
          <div className="flex flex-wrap gap-6">
            {metrics.map((m) => (
              <div key={m}>
                <div className="text-[11.5px] text-muted">{titleCase(m.replace(/([a-z])([A-Z])/g, "$1 $2"))}</div>
                <div className="text-[20px] font-semibold tabular-nums text-ink">{last[m] != null ? fmtNum(Number(last[m])) : "—"}</div>
              </div>
            ))}
          </div>
          {rows.length >= 2 ? (
            <>
              <Legend items={metrics.map((m, i) => ({ label: titleCase(m.replace(/([a-z])([A-Z])/g, "$1 $2")), color: SERIES_COLORS[i % SERIES_COLORS.length] }))} />
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke={CHART.grid} vertical={false} />
                    <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} minTickGap={24} />
                    <YAxis domain={[0, 100]} {...axisProps} width={44} />
                    <RTooltip {...tooltipProps} labelFormatter={(l) => shortDate(String(l))} formatter={(v, n) => [fmtNum(Number(v)), titleCase(String(n))]} />
                    {metrics.map((m, i) => (
                      <Line key={m} type="monotone" dataKey={m} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={1.5} dot={{ r: 2 }} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : (
            <p className="text-[12px] text-muted">One audit so far — the trend appears after the next audit.</p>
          )}
        </CardBody>
      </Card>
    </section>
  );
}

// ───────────── Insights ─────────────
function InsightsPanel({ projectId }: { projectId: string }) {
  const m = useMutation({ mutationFn: () => api.post<Insights>(p(projectId, "/analytics/insights")), onError: (e) => toastError(e) });
  const r = m.data;
  const h = r?.hypotheses;
  return (
    <section>
      <SectionIntro
        title="Insights"
        action={
          <Button variant="primary" size="sm" loading={m.isPending} onClick={() => m.mutate()}>
            <Sparkle size={13} weight="fill" /> {r ? "Regenerate insights" : "Generate insights"}
          </Button>
        }
      >
        Measured facts are computed directly from your data. AI hypotheses interpret those facts and are clearly not measurements.
      </SectionIntro>
      {!r ? (
        <Card>
          <Empty icon={<Lightbulb size={18} />} title="No insights generated yet" description="Generate to collect measured facts from social, website and campaign data — plus AI hypotheses and tests when an AI provider is configured." />
        </Card>
      ) : r.note && !r.facts.length ? (
        <Card>
          <Empty icon={<Warning size={18} />} title="Not enough data" description={r.note} />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-4 items-start">
          <Card>
            <CardHeader icon={<Ruler size={14} weight="bold" />} title="Measured facts" description="Deterministic — taken from connected sources." action={<Badge tone="green">Measured</Badge>} />
            <ul className="border-t border-line">
              {r.facts.map((f, i) => (
                <li key={i} className="px-5 py-2.5 border-b border-line last:border-0">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[12.5px] text-muted">{f.label}</span>
                    <Badge tone="gray" className="normal-case tracking-normal shrink-0">
                      {f.source}
                    </Badge>
                  </div>
                  <div className="text-[13px] text-ink mt-0.5 break-words tabular-nums">{f.value}</div>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="border-dashed">
            <CardHeader icon={<Sparkle size={14} weight="fill" />} title="AI hypotheses" description="Interpretations and test ideas — not measurements. Verify before acting." action={<Badge tone="purple">AI hypothesis</Badge>} />
            <CardBody className="space-y-4">
              {!h ? (
                <p className="text-[12.5px] text-muted">
                  No AI provider configured, so only measured facts are shown.{" "}
                  <Link to="/settings" className="underline underline-offset-2 text-ink-2">
                    Add an AI provider
                  </Link>
                </p>
              ) : (
                <>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <HypList icon={<TrendUp size={13} weight="bold" className="text-green-fg" />} title="Seems to be working" items={h.working} />
                    <HypList icon={<TrendDown size={13} weight="bold" className="text-red-fg" />} title="Seems to be declining" items={h.declining} />
                  </div>
                  <HypList icon={<Lightbulb size={13} weight="bold" />} title="Hypotheses" items={h.hypotheses} />
                  {h.testsToRun.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink-2 mb-1.5">
                        <Flask size={13} weight="bold" /> Tests to run
                      </div>
                      <Table>
                        <thead>
                          <tr>
                            <Th>Test</Th>
                            <Th>Metric</Th>
                            <Th>Expected effect (hypothesis)</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {h.testsToRun.map((t, i) => (
                            <tr key={i}>
                              <Td className="text-ink">{t.test}</Td>
                              <Td className="text-muted">{t.metric}</Td>
                              <Td className="text-muted">{t.expectedEffect}</Td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  )}
                </>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </section>
  );
}

function HypList({ icon, title, items }: { icon: React.ReactNode; title: string; items: string[] }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink-2 mb-1">
        {icon} {title}
      </div>
      {items.length ? (
        <ul className="list-disc pl-4 space-y-0.5 text-[12.5px] text-ink-2 leading-relaxed">
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-faint">None suggested.</p>
      )}
    </div>
  );
}

// ───────────── Page ─────────────
export default function Analytics() {
  const { projectId } = useParams() as { projectId: string };
  const proj = useProject(projectId).data;
  const [days, setDays] = React.useState(28);
  const social = useQuery({ queryKey: ["analytics", projectId, "social"], queryFn: () => api.get<{ accounts: SocialAccount[] }>(p(projectId, "/analytics/social")) });
  const web = useQuery({
    queryKey: ["analytics", projectId, "web", days],
    queryFn: () => api.get<WebResponse>(p(projectId, `/analytics/web?days=${days}`)),
    placeholderData: (prev) => prev,
  });

  return (
    <PageContainer>
      <PageHeader
        title="Analytics"
        description="Post, social and website performance. Social and website metrics use different definitions and are kept apart."
        actions={
          <Button asChild variant="ghost">
            <Link to={`/projects/${projectId}/integrations`}>
              <ChartLineUp size={14} weight="bold" /> Manage data sources
            </Link>
          </Button>
        }
      />
      <div className="space-y-10">
        <section>
          <SectionIntro title="Post performance">
            Every post you published, including the ones you posted yourself. Public metrics are collected automatically (every 20 minutes while a post is fresh); numbers only you can see come from your analytics screenshots or manual entry. Missing values show as —, never as zero.
          </SectionIntro>
          <PostPerformance projectId={projectId} />
        </section>

        <section>
          <SectionIntro title="Social accounts">Followers, reach and post metrics as reported by each platform's API. Engagement counts likes, comments, shares and saves; views and impressions are excluded.</SectionIntro>
          <SocialSection projectId={projectId} accounts={social.data?.accounts} loading={social.isLoading} />
        </section>

        <section>
          <SectionIntro title="Website">Sessions, users and conversions from your web analytics provider. These are visits to your site — not social reach.</SectionIntro>
          <WebSection projectId={projectId} data={web.data} loading={web.isLoading || web.isFetching} days={days} onDays={setDays} />
          <TrafficPanel projectId={projectId} defaultDomain={proj?.project?.websiteUrl} />
        </section>

        <section>
          <SectionIntro title="Campaign performance">Post counts and summed social metrics from published targets, plus website sessions attributed via the campaign's UTM tag.</SectionIntro>
          <CampaignTable projectId={projectId} />
        </section>

        <PagespeedHistory projectId={projectId} />

        <InsightsPanel projectId={projectId} />
      </div>
    </PageContainer>
  );
}
