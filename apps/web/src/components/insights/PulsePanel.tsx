import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowSquareOut, ArrowsClockwise, Lightning, TrendUp } from "@phosphor-icons/react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ago, cn, fmtNum, toastError } from "@/lib/utils";
import { onServerEvent } from "@/hooks/useEvents";
import { Badge, Button, Card, CardBody, CardHeader, Empty, Input, Select, Skeleton, Switch } from "@/components/ui";

type PulseItem = {
  id: string;
  platform: string;
  source: string;
  kind: string;
  title: string;
  summary: string;
  url: string;
  author?: string | null;
  publishedAt: string;
  firstSeenAt: string;
  score: number | null;
  comments: number | null;
  tags: string[];
  thumbnail: string | null;
  momentum: number;
  matched: string[];
};
type PulseSettings = {
  geo: string;
  notify: boolean;
  paid: { enabled: boolean; platforms: ("tiktok" | "instagram")[]; region: string; dailyCreditCap: number; everyMinutes: number };
};

const PLATFORMS: [string, string][] = [
  ["all", "All"],
  ["bluesky", "Bluesky"],
  ["mastodon", "Mastodon"],
  ["google_trends", "Google Trends"],
  ["tiktok", "TikTok"],
  ["instagram", "Instagram"],
];
const KIND_LABEL: Record<string, string> = { post: "post", topic: "topic", hashtag: "hashtag", link: "link", search: "search" };
const SIGNAL_LABEL: Record<string, string> = { bluesky: "rank score", mastodon: "engagement", google_trends: "searches", tiktok: "views", instagram: "views" };

export function PulsePanel() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [platform, setPlatform] = React.useState("all");
  const [hours, setHours] = React.useState("24");
  const [projectId, setProjectId] = React.useState(params.get("project") ?? "");
  const [relevantOnly, setRelevantOnly] = React.useState(false);
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api.get<{ projects: { id: string; name: string }[] }>("/projects") });
  const q = useQuery({
    queryKey: ["intel", "pulse", platform, hours, projectId],
    queryFn: () => api.get<{ items: PulseItem[]; lastCrawlAt: string | null; intervalMinutes: number }>(`/intel/pulse?platform=${platform}&hours=${hours}${projectId ? `&projectId=${projectId}` : ""}`),
    refetchInterval: 5 * 60_000,
  });
  React.useEffect(() => onServerEvent((e) => e.type === "intel.pulse" && qc.invalidateQueries({ queryKey: ["intel", "pulse"] })), [qc]);
  const run = useMutation({
    mutationFn: () => api.post<Record<string, number | string>>("/intel/pulse/run"),
    onSuccess: (r) => {
      toast.success(`Crawl finished — ${r.new ?? 0} new items`);
      qc.invalidateQueries({ queryKey: ["intel", "pulse"] });
    },
    onError: (e) => toastError(e),
  });
  const items = (q.data?.items ?? []).filter((i) => !relevantOnly || i.matched.length);

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="pt-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-line p-0.5 bg-surface flex-wrap">
            {PLATFORMS.map(([v, l]) => (
              <button key={v} onClick={() => setPlatform(v)} className={cn("px-2.5 py-1 rounded-[5px] text-[12.5px]", platform === v ? "bg-ink text-white" : "text-muted hover:text-ink")}>
                {l}
              </button>
            ))}
          </div>
          <Select value={hours} onChange={(e) => setHours(e.target.value)} className="w-[120px] h-8 text-[12.5px]">
            <option value="3">Last 3 hours</option>
            <option value="12">Last 12 hours</option>
            <option value="24">Last 24 hours</option>
            <option value="72">Last 3 days</option>
            <option value="168">Last 7 days</option>
          </Select>
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-[190px] h-8 text-[12.5px]">
            <option value="">Rank for: everything</option>
            {projects.data?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                Rank for: {p.name}
              </option>
            ))}
          </Select>
          {projectId && <Switch checked={relevantOnly} onCheckedChange={setRelevantOnly} label="Only matches" />}
          <div className="ml-auto flex items-center gap-2 text-[12px] text-muted">
            <span>
              Crawls every {q.data?.intervalMinutes ?? 20} min{q.data?.lastCrawlAt ? ` · last ${ago(q.data.lastCrawlAt)}` : ""}
            </span>
            <Button size="sm" onClick={() => run.mutate()} loading={run.isPending}>
              <ArrowsClockwise size={12} /> Crawl now
            </Button>
          </div>
        </CardBody>
      </Card>

      {q.isLoading ? (
        <div className="grid md:grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : !items.length ? (
        <Empty icon={<TrendUp size={22} />} title="Nothing yet" description={q.data?.lastCrawlAt ? "No items match these filters." : "The first crawl runs within 20 minutes of the worker starting — or press Crawl now."} />
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {items.map((i, idx) => (
            <a key={i.id} href={i.url} target="_blank" rel="noreferrer" className="group rounded-lg border border-line bg-surface p-3.5 flex gap-3 hover:border-ink/30 transition-colors">
              {i.thumbnail ? <img src={i.thumbnail} alt="" referrerPolicy="no-referrer" loading="lazy" className="h-16 w-16 rounded-md object-cover border border-line shrink-0" /> : null}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                  <span className="font-mono text-ink-2">#{idx + 1}</span>
                  <Badge tone="gray">{i.source}</Badge>
                  <span>{KIND_LABEL[i.kind] ?? i.kind}</span>
                  {i.score != null && (
                    <span>
                      · {fmtNum(i.score)} {SIGNAL_LABEL[i.platform] ?? "signal"}
                    </span>
                  )}
                  <span>· seen {ago(i.firstSeenAt)}</span>
                </div>
                <div className="text-[13.5px] font-medium text-ink mt-1 line-clamp-2 group-hover:underline underline-offset-2">
                  {i.title} <ArrowSquareOut size={11} className="inline text-muted" />
                </div>
                {i.summary && i.summary !== i.title && <p className="text-[12px] text-muted mt-0.5 line-clamp-2">{i.summary}</p>}
                {i.matched.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {i.matched.slice(0, 5).map((m) => (
                      <Badge key={m} tone="green">
                        {m}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </a>
          ))}
        </div>
      )}
      <PulseSettingsCard />
    </div>
  );
}

function PulseSettingsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["intel", "pulse", "settings"], queryFn: () => api.get<{ settings: PulseSettings; today: { credits: number; lastRunAt: string | null }; socialcrawlConfigured: boolean }>("/intel/pulse/settings") });
  const [s, setS] = React.useState<PulseSettings | null>(null);
  React.useEffect(() => {
    if (q.data && !s) setS(q.data.settings);
  }, [q.data, s]);
  const save = useMutation({
    mutationFn: (next: PulseSettings) => api.put("/intel/pulse/settings", next),
    onSuccess: () => {
      toast.success("Pulse settings saved");
      qc.invalidateQueries({ queryKey: ["intel", "pulse", "settings"] });
    },
    onError: (e) => toastError(e),
  });
  if (!s || !q.data) return null;
  const perRun = s.paid.platforms.length * 5;
  const runsPerDay = Math.min(Math.floor(1440 / s.paid.everyMinutes), Math.floor(s.paid.dailyCreditCap / Math.max(perRun, 1)));
  const togglePlatform = (p: "tiktok" | "instagram") => setS({ ...s, paid: { ...s.paid, platforms: s.paid.platforms.includes(p) ? s.paid.platforms.filter((x) => x !== p) : [...s.paid.platforms, p] } });
  return (
    <Card>
      <CardHeader title="Pulse settings" description="Free sources (Bluesky, Mastodon, Google Trends, plus Mastodon hashtags from your project keywords) are crawled every 20 minutes." />
      <CardBody className="space-y-4 text-[12.5px]">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2">
            Google Trends country
            <Input value={s.geo} maxLength={2} onChange={(e) => setS({ ...s, geo: e.target.value.toUpperCase() })} className="w-16 h-7 uppercase" />
          </label>
          <Switch checked={s.notify} onCheckedChange={(v) => setS({ ...s, notify: v })} label="Notify me when new trends match a project" />
        </div>
        <div className="rounded-lg border border-line p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Lightning size={14} className="text-yellow-fg" />
            <span className="font-medium text-ink">TikTok & Instagram trending (paid, SocialCrawl)</span>
            <span className="text-muted">— 5 credits per platform per run. Off unless you turn it on.</span>
          </div>
          {!q.data.socialcrawlConfigured ? (
            <div className="text-muted">
              Add your SocialCrawl key in{" "}
              <Link to="/settings?tab=data" className="underline">
                Settings → Data sources
              </Link>{" "}
              first.
            </div>
          ) : (
            <>
              <Switch checked={s.paid.enabled} onCheckedChange={(v) => setS({ ...s, paid: { ...s.paid, enabled: v } })} label="Enable paid trend crawling" />
              {s.paid.enabled && (
                <div className="flex flex-wrap items-center gap-4">
                  <Switch checked={s.paid.platforms.includes("tiktok")} onCheckedChange={() => togglePlatform("tiktok")} label="TikTok" />
                  <Switch checked={s.paid.platforms.includes("instagram")} onCheckedChange={() => togglePlatform("instagram")} label="Instagram Reels" />
                  <label className="flex items-center gap-2">
                    Region
                    <Input value={s.paid.region} maxLength={2} onChange={(e) => setS({ ...s, paid: { ...s.paid, region: e.target.value.toUpperCase() } })} className="w-16 h-7 uppercase" />
                  </label>
                  <label className="flex items-center gap-2">
                    Every
                    <Select value={String(s.paid.everyMinutes)} onChange={(e) => setS({ ...s, paid: { ...s.paid, everyMinutes: Number(e.target.value) } })} className="w-[110px] h-7">
                      {[20, 60, 120, 240, 720, 1440].map((m) => (
                        <option key={m} value={m}>
                          {m < 60 ? `${m} min` : `${m / 60} h`}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="flex items-center gap-2">
                    Daily credit cap
                    <Input type="number" min={5} max={500} value={s.paid.dailyCreditCap} onChange={(e) => setS({ ...s, paid: { ...s.paid, dailyCreditCap: Number(e.target.value) } })} className="w-20 h-7" />
                  </label>
                </div>
              )}
              <div className="text-muted">
                Used today: {q.data.today.credits} credits{q.data.today.lastRunAt ? ` · last paid run ${ago(q.data.today.lastRunAt)}` : ""}.
                {s.paid.enabled && perRun > 0 && ` At most ${runsPerDay} paid run${runsPerDay === 1 ? "" : "s"}/day (≤ ${Math.min(runsPerDay * perRun, s.paid.dailyCreditCap)} credits). Stops automatically at the cap.`}
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end">
          <Button variant="primary" size="sm" loading={save.isPending} onClick={() => save.mutate(s)}>
            Save settings
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
