import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, ShieldCheck, UsersThree, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Badge, Button, Card, CardBody, CardHeader, Input, Switch, Tooltip } from "@/components/ui";
import { api } from "@/lib/api";
import { cn, fmtDate, fmtNum, toastError } from "@/lib/utils";

export type AudienceInsights = {
  qualityScore?: number;
  fakeFollowersPct?: number;
  avgEngagementRate?: number;
  avgInteractions?: number;
  avgLikes?: number;
  avgComments?: number;
  avgViews?: number;
  followerGrowth180dPct?: number;
  accountType?: string;
  categories?: string[];
  country?: string;
  audienceTypes: { name: string; percent: number }[];
  reachability: { name: string; percent: number }[];
  countries: { name: string; percent: number }[];
  cities: { name: string; percent: number }[];
  genders: { name: string; percent: number }[];
  ages: { name: string; percent: number }[];
  genderAge: { age: string; m: number; f: number }[];
  brandSafety?: Record<string, number>;
  mentions180d?: { posts?: number; accounts?: number; reach?: number };
  demographicsCoverage?: number;
  dataStatus?: string;
  statsUpdatedAt?: string;
  postsUpdatedAt?: string;
};

const pct = (n?: number, digits = 1) => (n == null ? "—" : `${(n * 100).toFixed(digits)}%`);
const AUDIENCE_TYPE: Record<string, { label: string; hint: string }> = {
  real: { label: "Real people", hint: "Accounts that look like genuine, active people." },
  influencer: { label: "Influencers", hint: "Followers who are themselves accounts with large followings." },
  massfollowers: { label: "Mass followers", hint: "Accounts following thousands of others — they rarely see posts." },
  suspicious: { label: "Suspicious / bots", hint: "Accounts with bot-like signals." },
};
const REACH: Record<string, string> = { r0_500: "Follows < 500", r500_1000: "500–1,000", r1000_1500: "1,000–1,500", r1500_plus: "1,500+" };
const AGE = (a: string) => a.replace("_100", "+").replace("_", "–");

function Bars({ rows, label = (n: string) => n, max = 8 }: { rows: { name: string; percent: number }[]; label?: (n: string) => string; max?: number }) {
  const top = rows.slice(0, max);
  const peak = Math.max(...top.map((r) => r.percent), 0.0001);
  if (!top.length) return <p className="text-[12px] text-muted">Not available yet.</p>;
  return (
    <div className="space-y-1.5">
      {top.map((r) => (
        <div key={r.name} className="grid grid-cols-[110px_1fr_48px] items-center gap-2 text-[12px]">
          <span className="truncate text-ink-2" title={label(r.name)}>
            {label(r.name)}
          </span>
          <div className="h-2 rounded-full bg-subtle overflow-hidden">
            <div className="h-full rounded-full bg-ink/80" style={{ width: `${(r.percent / peak) * 100}%` }} />
          </div>
          <span className="tabular-nums text-right text-muted">{pct(r.percent)}</span>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2.5">
      <div className="text-[11px] text-muted">{hint ? <Tooltip content={hint}><span className="cursor-help underline decoration-dotted underline-offset-2">{label}</span></Tooltip> : label}</div>
      <div className={cn("text-[17px] font-semibold tabular-nums mt-0.5", tone === "good" ? "text-green-fg" : tone === "warn" ? "text-yellow-fg" : tone === "bad" ? "text-red-fg" : "text-ink")}>{value}</div>
    </div>
  );
}

/** Account quality + audience demographics (Instagram Statistics API). */
export function AudiencePanel({ a }: { a: AudienceInsights }) {
  const fake = a.fakeFollowersPct;
  const quality = a.qualityScore;
  const coverage = a.demographicsCoverage;
  const unsafe = Object.entries(a.brandSafety ?? {}).filter(([k, v]) => k !== "totalScore" && v > 0.01).sort((x, y) => y[1] - x[1]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Stat label="Quality score" value={quality == null ? "—" : `${Math.round(quality * 100)}/100`} tone={quality == null ? undefined : quality >= 0.6 ? "good" : quality >= 0.4 ? "warn" : "bad"} hint="Compared with accounts of similar size: audience quality, engagement, growth, posting regularity, bots." />
        <Stat label="Fake followers" value={pct(fake)} tone={fake == null ? undefined : fake <= 0.15 ? "good" : fake <= 0.3 ? "warn" : "bad"} hint="Share of followers estimated to be fake or bots." />
        <Stat label="Avg. engagement rate" value={pct(a.avgEngagementRate, 2)} hint="Average per post over the last 8 weeks (up to 200 posts)." />
        <Stat label="Avg. likes / post" value={a.avgLikes == null ? "—" : fmtNum(a.avgLikes)} />
        <Stat label="Avg. views / post" value={a.avgViews ? fmtNum(a.avgViews) : "—"} />
        <Stat label="Follower growth (180d)" value={a.followerGrowth180dPct == null ? "—" : `${a.followerGrowth180dPct >= 0 ? "+" : ""}${(a.followerGrowth180dPct * 100).toFixed(2)}%`} />
      </div>

      {coverage != null && coverage < 0.1 && (
        <div className="flex gap-2 text-[12px] text-yellow-fg">
          <Warning size={14} className="shrink-0 mt-0.5" /> Demographics are still being processed by the provider ({pct(coverage, 0)} of the audience analyzed) — treat them as indicative.
        </div>
      )}

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div>
          <div className="text-[12px] font-medium text-ink mb-2 flex items-center gap-1.5">
            <UsersThree size={13} /> Audience type
          </div>
          <Bars rows={a.audienceTypes} label={(n) => AUDIENCE_TYPE[n]?.label ?? n} />
          <div className="text-[12px] font-medium text-ink mt-4 mb-2">Reachability</div>
          <Bars rows={a.reachability} label={(n) => REACH[n] ?? n} />
        </div>
        <div>
          <div className="text-[12px] font-medium text-ink mb-2">Top countries</div>
          <Bars rows={a.countries} />
          <div className="text-[12px] font-medium text-ink mt-4 mb-2">Top cities</div>
          <Bars rows={a.cities} max={5} />
        </div>
        <div>
          <div className="text-[12px] font-medium text-ink mb-2">Gender</div>
          <Bars rows={a.genders} label={(n) => (n === "f" ? "Female" : n === "m" ? "Male" : n)} />
          <div className="text-[12px] font-medium text-ink mt-4 mb-2">Age</div>
          <Bars rows={[...a.ages].sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }))} label={AGE} max={8} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <ShieldCheck size={13} className={unsafe.length ? "text-yellow-fg" : "text-green-fg"} />
        {unsafe.length ? <span>Brand-safety flags: {unsafe.map(([k, v]) => `${k.replace(/_/g, " ")} ${pct(v)}`).join(", ")}</span> : <span>No brand-safety flags</span>}
        {a.mentions180d?.posts ? <span>· {fmtNum(a.mentions180d.posts)} posts mentioning other accounts in 180 days (reach {fmtNum(a.mentions180d.reach ?? 0)})</span> : null}
        {a.categories?.length ? <span>· {a.categories.join(", ")}</span> : null}
        {a.accountType && <Badge tone="gray">{a.accountType}</Badge>}
      </div>
      <div className="text-[11px] text-faint">
        Source: Instagram Statistics API (RapidAPI){a.statsUpdatedAt ? ` · stats updated ${fmtDate(a.statsUpdatedAt)}` : ""}
        {a.postsUpdatedAt ? ` · posts updated ${fmtDate(a.postsUpdatedAt)}` : ""}
        {a.dataStatus && a.dataStatus !== "DONE" ? ` · provider status: ${a.dataStatus.toLowerCase()}` : ""}. Estimates by the provider from public data.
      </div>
    </div>
  );
}

export type RapidStatus = {
  configured: boolean;
  settings: { monthlyBudget: number; autoTracking: boolean };
  used: number;
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
  hardLimit: boolean | null;
  budgetLeft: number;
};

export function useRapidStatus() {
  return useQuery({ queryKey: ["intel", "rapidapi"], queryFn: () => api.get<RapidStatus>("/intel/rapidapi"), staleTime: 30_000 });
}

/** Quota + budget controls for the RapidAPI statistics source. */
export function RapidApiCard({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const q = useRapidStatus();
  const [budget, setBudget] = React.useState<string>("");
  React.useEffect(() => {
    if (q.data && budget === "") setBudget(String(q.data.settings.monthlyBudget));
  }, [q.data, budget]);
  const save = useMutation({
    mutationFn: (body: { monthlyBudget: number; autoTracking: boolean }) => api.put<RapidStatus>("/intel/rapidapi/settings", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["intel", "rapidapi"] });
      toast.success("RapidAPI settings saved");
    },
    onError: (e) => toastError(e),
  });
  const s = q.data;
  if (!s?.configured) return null;
  const used = s.used;
  const cap = Math.min(s.settings.monthlyBudget, s.limit ?? Infinity);
  return (
    <Card>
      {!compact && <CardHeader icon={<Gauge size={15} />} title="Instagram Statistics API (RapidAPI)" description="Account stats, audience demographics, and live Instagram/X post numbers. Every request counts toward your monthly plan." />}
      <CardBody className={cn("space-y-3 text-[12.5px]", compact && "pt-4")}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[220px]">
            <div className="flex justify-between text-[12px] mb-1">
              <span className="text-ink">
                {used} of {Number.isFinite(cap) ? cap : s.settings.monthlyBudget} requests used this month
              </span>
              <span className="text-muted">{s.limit != null ? `plan: ${s.remaining}/${s.limit} left${s.hardLimit ? " · hard limit (no overage)" : " · overage billed by RapidAPI"}` : "plan quota known after the first request"}</span>
            </div>
            <div className="h-2 rounded-full bg-subtle overflow-hidden">
              <div className={cn("h-full rounded-full", s.budgetLeft <= 5 ? "bg-red-fg" : "bg-ink/80")} style={{ width: `${Math.min(100, (used / Math.max(1, Number.isFinite(cap) ? cap : s.settings.monthlyBudget)) * 100)}%` }} />
            </div>
            {s.resetAt && <div className="text-[11px] text-muted mt-1">Resets {fmtDate(s.resetAt)}</div>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2">
            Monthly budget
            <Input type="number" min={1} value={budget} onChange={(e) => setBudget(e.target.value)} className="w-20 h-7" />
            requests
          </label>
          <Switch checked={s.settings.autoTracking} onCheckedChange={(v) => save.mutate({ monthlyBudget: Number(budget) || s.settings.monthlyBudget, autoTracking: v })} label="Auto-track my Instagram & X posts (at 1, 3 and 7 days)" />
          <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate({ monthlyBudget: Math.max(1, Number(budget) || 1), autoTracking: s.settings.autoTracking })}>
            Save
          </Button>
        </div>
        <p className="text-[11.5px] text-muted">Automatic tracking keeps 5 requests in reserve for your own lookups and stops at the budget. {s.hardLimit === false ? "Your plan bills overage — keep the budget at or below the plan's included requests." : ""}</p>
      </CardBody>
    </Card>
  );
}
