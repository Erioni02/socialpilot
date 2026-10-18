import * as React from "react";
import { Link } from "react-router-dom";
import { Area, CartesianGrid, Line, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis, ComposedChart } from "recharts";
import { Button, Card, CardBody, CardHeader, SetupCallout, Skeleton, Stat, Table, Td, Th } from "@/components/ui";
import { fmtNum, PLATFORM_LABEL, titleCase } from "@/lib/utils";
import { axisProps, CHART, Legend, shortDate, tooltipProps } from "./shared";

export type WebSummary = {
  source: "ga4" | "plausible";
  range: { start: string; end: string };
  daily: { date: string; sessions: number; users: number; pageviews: number; conversions: number | null }[];
  totals: { sessions: number; users: number; pageviews: number; conversions: number | null; bounceRate: number | null };
  referrers: { source: string; sessions: number }[];
  campaigns: { campaign: string; source: string; sessions: number; conversions: number | null }[];
  topPages: { path: string; pageviews: number }[];
  definitions: Record<string, string>;
};
export type WebResponse = { connected: false } | { connected: true; provider: string; needsConfig?: string; error?: string; summary?: WebSummary };

function Bars({ rows, labelKey, valueKey, valueLabel }: { rows: any[]; labelKey: string; valueKey: string; valueLabel: string }) {
  const max = Math.max(1, ...rows.map((r) => r[valueKey] ?? 0));
  if (!rows.length) return <p className="text-[12.5px] text-muted">No data in this period.</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r, i) => (
        <li key={`${r[labelKey]}-${i}`} className="relative text-[12.5px]">
          <div className="absolute inset-y-0 left-0 rounded-sm bg-blue-bg" style={{ width: `${(r[valueKey] / max) * 100}%` }} />
          <div className="relative flex items-center justify-between gap-3 px-2 py-1">
            <span className="truncate text-ink-2 font-mono text-[12px]" title={r[labelKey]}>
              {r[labelKey] || "(direct / none)"}
            </span>
            <span className="tabular-nums text-ink shrink-0" title={valueLabel}>
              {fmtNum(r[valueKey])}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

const pct = (n: number | null) => (n == null ? "not tracked" : `${(n * 100).toFixed(1)}%`);

export function WebSection({ projectId, data, loading, days, onDays }: { projectId: string; data?: WebResponse; loading: boolean; days: number; onDays: (d: number) => void }) {
  const daySwitch = (
    <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {[7, 28, 90].map((d) => (
        <button key={d} onClick={() => onDays(d)} className={`px-2.5 h-6 rounded-[4px] text-[12px] font-medium ${days === d ? "bg-ink text-white" : "text-muted hover:text-ink"}`}>
          {d}d
        </button>
      ))}
    </div>
  );
  const integrationsLink = (
    <Button asChild size="sm">
      <Link to={`/projects/${projectId}/integrations`}>Open integrations</Link>
    </Button>
  );
  if (loading && !data)
    return (
      <Card className="p-5 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
        <Skeleton className="h-56" />
      </Card>
    );
  if (!data || !data.connected)
    return (
      <SetupCallout title="Website analytics not connected" action={integrationsLink}>
        Connect Google Analytics 4 or Plausible to see sessions, referrers, top pages and UTM-attributed campaign traffic. Website numbers are never estimated.
      </SetupCallout>
    );
  if (data.needsConfig)
    return (
      <SetupCallout title={`${PLATFORM_LABEL[data.provider] ?? data.provider} needs one more step`} action={integrationsLink}>
        {data.needsConfig}
      </SetupCallout>
    );
  if (data.error || !data.summary)
    return (
      <SetupCallout tone="red" title={`Couldn't read ${PLATFORM_LABEL[data.provider] ?? data.provider}`} action={integrationsLink}>
        {data.error ?? "No summary returned."}
      </SetupCallout>
    );
  const s = data.summary;
  const def = s.definitions ?? {};
  const hasConv = s.daily.some((d) => d.conversions != null);
  return (
    <Card>
      <CardHeader
        title={`${PLATFORM_LABEL[s.source] ?? s.source} · ${s.range.start ? `${shortDate(s.range.start)} – ${shortDate(s.range.end)}` : `last ${days} days`}`}
        description="Measured by your analytics provider. Definitions below."
        action={daySwitch}
      />
      <CardBody className="space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <Stat label="Sessions" value={fmtNum(s.totals.sessions)} />
          <Stat label="Users" value={fmtNum(s.totals.users)} />
          <Stat label="Pageviews" value={fmtNum(s.totals.pageviews)} />
          <Stat label="Conversions" value={s.totals.conversions == null ? <span className="text-[15px] text-muted font-normal">not tracked</span> : fmtNum(s.totals.conversions)} />
          <Stat label="Bounce rate" value={s.totals.bounceRate == null ? <span className="text-[15px] text-muted font-normal">not tracked</span> : pct(s.totals.bounceRate)} />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] font-medium text-ink-2">Daily traffic</span>
            <Legend
              items={[
                { label: "Sessions", color: CHART.ink },
                { label: "Users", color: CHART.blue },
                { label: "Pageviews", color: CHART.faint },
                ...(hasConv ? [{ label: "Conversions", color: CHART.green }] : []),
              ]}
            />
          </div>
          {s.daily.length ? (
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={s.daily} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} minTickGap={28} />
                  <YAxis {...axisProps} width={52} tickFormatter={(v) => fmtNum(v)} allowDecimals={false} />
                  <RTooltip {...tooltipProps} labelFormatter={(l) => shortDate(String(l))} formatter={(v, n) => [v == null ? "not tracked" : fmtNum(Number(v)), titleCase(String(n))]} />
                  <Area type="monotone" dataKey="sessions" stroke={CHART.ink} strokeWidth={1.5} fill={CHART.fillBlue} fillOpacity={0.6} dot={false} />
                  <Line type="monotone" dataKey="users" stroke={CHART.blue} strokeWidth={1.25} dot={false} />
                  <Line type="monotone" dataKey="pageviews" stroke={CHART.faint} strokeWidth={1.25} strokeDasharray="4 3" dot={false} />
                  {hasConv && <Line type="monotone" dataKey="conversions" stroke={CHART.green} strokeWidth={1.25} dot={false} />}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-[12.5px] text-muted">No traffic recorded in this period.</p>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <div className="text-[12px] font-medium text-ink-2 mb-2">Top referrers <span className="text-faint font-normal">· sessions</span></div>
            <Bars rows={s.referrers.slice(0, 10)} labelKey="source" valueKey="sessions" valueLabel="sessions" />
          </div>
          <div>
            <div className="text-[12px] font-medium text-ink-2 mb-2">Top pages <span className="text-faint font-normal">· pageviews</span></div>
            <Bars rows={s.topPages.slice(0, 10)} labelKey="path" valueKey="pageviews" valueLabel="pageviews" />
          </div>
        </div>

        <div>
          <div className="text-[12px] font-medium text-ink-2 mb-2">UTM campaigns</div>
          {s.campaigns.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>utm_campaign</Th>
                  <Th>utm_source</Th>
                  <Th className="text-right">Sessions</Th>
                  <Th className="text-right">Conversions</Th>
                </tr>
              </thead>
              <tbody>
                {s.campaigns.map((c, i) => (
                  <tr key={`${c.campaign}-${c.source}-${i}`}>
                    <Td className="font-mono text-[12px]">{c.campaign}</Td>
                    <Td className="text-muted">{c.source || "—"}</Td>
                    <Td className="text-right tabular-nums">{fmtNum(c.sessions)}</Td>
                    <Td className="text-right tabular-nums">{c.conversions == null ? <span className="text-muted">not tracked</span> : fmtNum(c.conversions)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="text-[12.5px] text-muted">No UTM-tagged traffic in this period. Links SocialPilot publishes carry UTM tags so campaign traffic shows up here.</p>
          )}
        </div>

        {Object.keys(def).length > 0 && (
          <details className="group rounded-lg border border-line bg-subtle">
            <summary className="cursor-pointer select-none px-3 py-2 text-[12px] font-medium text-ink-2">Metric definitions ({PLATFORM_LABEL[s.source] ?? s.source})</summary>
            <dl className="px-3 pb-3 grid sm:grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12px]">
              {Object.entries(def).map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt className="text-muted">{titleCase(k)}</dt>
                  <dd className="text-ink-2">{v}</dd>
                </React.Fragment>
              ))}
            </dl>
          </details>
        )}
      </CardBody>
    </Card>
  );
}

