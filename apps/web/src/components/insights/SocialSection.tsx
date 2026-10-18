import * as React from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { Button, Card, CardBody, CardHeader, Empty, SetupCallout, Stat, StatusBadge, Table, Td, Th } from "@/components/ui";
import { PlatformIcon } from "@/components/common";
import { fmtNum, PLATFORM_LABEL, titleCase } from "@/lib/utils";
import { axisProps, CHART, ExtLink, shortDate, TimeAgo, tooltipProps } from "./shared";

export type SocialAccount = {
  integrationId: string;
  platform: string;
  handle: string | null;
  status: string;
  lastSyncAt?: string | null;
  followersSeries: { date: string; value: number }[];
  followerGrowth?: number | null;
  growthWindowDays?: number;
  reachSeries?: { date: string; value: number }[];
  latest: Record<string, number>;
  topPosts: { id: string; text: string; url?: string; mediaType?: string; createdAt: string; metrics: Record<string, number> }[];
  formatBreakdown?: { format: string; posts: number; avgEngagement: number }[];
  postsError?: string;
  lastError?: string | null;
  note?: string;
};

function SeriesChart({ data, color = CHART.ink, fill = CHART.fillBlue, label }: { data: { date: string; value: number }[]; color?: string; fill?: string; label: string }) {
  if (data.length < 2)
    return <div className="h-[180px] flex items-center justify-center text-[12px] text-muted border border-dashed border-line rounded-lg">{data.length === 1 ? `One data point so far (${fmtNum(data[0].value)}). The chart fills in as daily syncs run.` : "No data points yet — run a sync."}</div>;
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max(1, Math.round((max - min) * 0.15));
  return (
    <div className="h-[180px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} minTickGap={24} />
          <YAxis domain={[Math.max(0, min - pad), max + pad]} tickFormatter={(v) => fmtNum(v)} {...axisProps} width={52} allowDecimals={false} />
          <RTooltip {...tooltipProps} labelFormatter={(l) => shortDate(String(l))} formatter={(v) => [fmtNum(Number(v)), label]} />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} fill={fill} fillOpacity={0.7} dot={false} activeDot={{ r: 3 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function engagementOf(m: Record<string, number>) {
  return Object.entries(m)
    .filter(([k]) => k !== "views" && k !== "impressions")
    .reduce((s, [, v]) => s + v, 0);
}

function AccountCard({ projectId, a }: { projectId: string; a: SocialAccount }) {
  const label = PLATFORM_LABEL[a.platform] ?? a.platform;
  const title = (
    <span className="flex items-center gap-2">
      <PlatformIcon platform={a.platform} size={15} /> {label}
      {a.handle && <span className="text-muted font-normal">@{a.handle}</span>}
    </span>
  );
  if (a.status === "public_only")
    return (
      <Card>
        <CardHeader title={title} action={<StatusBadge status={a.status} />} />
        <CardBody>
          <SetupCallout
            title="Needs OAuth to read metrics"
            action={
              <Button asChild size="sm">
                <Link to={`/projects/${projectId}/integrations`}>Connect</Link>
              </Button>
            }
          >
            {a.note ?? "Only the public profile is linked. Connect via OAuth to read followers, reach and post metrics."}
          </SetupCallout>
        </CardBody>
      </Card>
    );
  const latestEntries = Object.entries(a.latest);
  const metricKeys = [...new Set(a.topPosts.flatMap((p) => Object.keys(p.metrics)))].slice(0, 5);
  const reach = a.reachSeries ?? [];
  const formats = a.formatBreakdown ?? [];
  return (
    <Card>
      <CardHeader
        title={title}
        description={a.lastSyncAt ? <TimeAgo date={a.lastSyncAt} prefix="Synced " /> : "Never synced"}
        action={<StatusBadge status={a.status} />}
      />
      <CardBody className="space-y-5">
        {(a.lastError || a.postsError) && (
          <div className="space-y-2">
            {a.lastError && (
              <SetupCallout title="Some metrics are unavailable" tone={a.status === "error" ? "red" : "yellow"}>
                {a.lastError}
              </SetupCallout>
            )}
            {a.postsError && (
              <SetupCallout title="Posts couldn't be read" tone="yellow">
                {a.postsError}
                {a.platform === "x" && /tier|plan|403|402|access/i.test(a.postsError) && <> — reading X posts requires a paid X API plan.</>}
              </SetupCallout>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Followers" value={a.latest.followers != null ? fmtNum(a.latest.followers) : "—"} sub="latest measured" />
          <Stat
            label="Follower change"
            value={a.followerGrowth != null ? `${a.followerGrowth >= 0 ? "+" : ""}${fmtNum(a.followerGrowth)}` : "—"}
            sub={a.followerGrowth != null ? `over ${a.growthWindowDays} day${a.growthWindowDays === 1 ? "" : "s"} of snapshots` : "needs 2+ daily snapshots"}
          />
          {a.latest.reach != null && <Stat label="Reach" value={fmtNum(a.latest.reach)} sub="latest day" />}
          {a.latest.impressions != null && <Stat label="Impressions" value={fmtNum(a.latest.impressions)} sub="latest day" />}
        </div>

        <div className={reach.length >= 2 ? "grid md:grid-cols-2 gap-5" : ""}>
          <div>
            <div className="text-[12px] font-medium text-ink-2 mb-2">Followers</div>
            <SeriesChart data={a.followersSeries} label="Followers" />
          </div>
          {reach.length >= 2 && (
            <div>
              <div className="text-[12px] font-medium text-ink-2 mb-2">Daily reach</div>
              <SeriesChart data={reach} label="Reach" color={CHART.blue} fill={CHART.fillBlue} />
            </div>
          )}
        </div>

        <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5">
          <div>
            <div className="text-[12px] font-medium text-ink-2 mb-2">Latest account metrics</div>
            {latestEntries.length ? (
              <Table>
                <tbody>
                  {latestEntries.map(([k, v]) => (
                    <tr key={k}>
                      <Td className="py-1.5 text-muted">{titleCase(k)}</Td>
                      <Td className="py-1.5 text-right tabular-nums text-ink">{fmtNum(v, 2)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-[12.5px] text-muted">No metrics stored yet.</p>
            )}
          </div>
          <div>
            <div className="text-[12px] font-medium text-ink-2 mb-2">Average engagement by format</div>
            {formats.length ? (
              <>
                <div className="h-[140px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={formats} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={CHART.grid} horizontal={false} />
                      <XAxis type="number" {...axisProps} tickFormatter={(v) => fmtNum(v)} />
                      <YAxis type="category" dataKey="format" {...axisProps} width={84} tickFormatter={(v) => titleCase(String(v).toLowerCase())} />
                      <RTooltip {...tooltipProps} cursor={{ fill: "rgba(0,0,0,0.03)" }} formatter={(v, _n, item: any) => [`${fmtNum(Number(v), 1)} avg · ${item?.payload?.posts} posts`, "Engagement"]} />
                      <Bar dataKey="avgEngagement" fill={CHART.fillBlue} stroke={CHART.blue} strokeWidth={1} radius={[0, 3, 3, 0]} barSize={14} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-[11px] text-faint mt-1">Engagement = likes + comments + shares + saves etc. (views/impressions excluded), across up to 25 recently listed posts.</p>
              </>
            ) : (
              <p className="text-[12.5px] text-muted">No posts read yet.</p>
            )}
          </div>
        </div>

        <div>
          <div className="text-[12px] font-medium text-ink-2 mb-2">Top recent posts</div>
          {a.topPosts.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Post</Th>
                  <Th>Format</Th>
                  {metricKeys.map((k) => (
                    <Th key={k} className="text-right">
                      {titleCase(k)}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {a.topPosts.map((p) => (
                  <tr key={p.id}>
                    <Td className="max-w-[360px]">
                      <ExtLink href={p.url} className="text-ink line-clamp-2 leading-snug">
                        {p.text || <span className="text-muted italic">(no caption)</span>}
                      </ExtLink>
                      <div className="text-[11px] text-faint mt-0.5">
                        <TimeAgo date={p.createdAt} /> · {fmtNum(engagementOf(p.metrics))} engagements
                      </div>
                    </Td>
                    <Td className="text-muted whitespace-nowrap">{p.mediaType ? titleCase(p.mediaType.toLowerCase()) : "Text"}</Td>
                    {metricKeys.map((k) => (
                      <Td key={k} className="text-right tabular-nums">
                        {p.metrics[k] != null ? fmtNum(p.metrics[k]) : "—"}
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="text-[12.5px] text-muted">{a.postsError ? "Posts are unavailable for this account (see above)." : "No posts found on this account."}</p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

export function SocialSection({ projectId, accounts, loading }: { projectId: string; accounts?: SocialAccount[]; loading: boolean }) {
  if (loading) return <Card className="h-80 animate-pulse-soft" />;
  if (!accounts?.length)
    return (
      <Card>
        <Empty
          title="No social accounts connected"
          description="Connect Instagram, TikTok or X to track followers, reach and post performance."
          action={
            <Button asChild size="sm">
              <Link to={`/projects/${projectId}/integrations`}>Connect accounts</Link>
            </Button>
          }
        />
      </Card>
    );
  return (
    <div className="space-y-4">
      {accounts.map((a) => (
        <AccountCard key={a.integrationId} projectId={projectId} a={a} />
      ))}
    </div>
  );
}

