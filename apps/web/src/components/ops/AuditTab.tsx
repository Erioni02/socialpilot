import * as React from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CaretRight, CheckCircle, CircleNotch, Globe, MagnifyingGlass, Sparkle, Warning, XCircle } from "@phosphor-icons/react";
import { Badge, Button, Card, Empty, Input, SetupCallout, Skeleton, StatusBadge, Table, Td, Th, type Tone } from "@/components/ui";
import { SectionTitle, useProject } from "@/components/common";
import { api, p } from "@/lib/api";
import { ago, cn, fmtBytes, fmtDate, fmtNum, toastError } from "@/lib/utils";
import { onServerEvent } from "@/hooks/useEvents";
import { ExtLink, ListSkeleton, useParam } from "./shared";

type AuditRow = { id: string; url: string; status: string; pagesCrawled: number; scores: Record<string, number> | null; error: string | null; createdAt: string; finishedAt: string | null };
type Issue = { id: string; category: string; severity: "critical" | "high" | "medium" | "low"; title: string; detail: string; recommendation: string; evidence: { url: string; snippet?: string; count?: number }[] };
type Page = { url: string; status: number; timingMs: number; bytes: number; title: string; metaDescription: string; h1: string[]; wordCount: number; images: { total: number; missingAlt: number }; ctas: { text: string }[] };
type Report = {
  url: string;
  finalUrl: string;
  fetchedAt: string;
  robotsTxt: { present: boolean; disallowAll: boolean; sitemaps: string[] };
  sitemap: { present: boolean; url?: string; urlCount: number };
  pages: Page[];
  brokenLinks: { url: string; status: number | string; foundOn: string }[];
  linksChecked: number;
  issues: Issue[];
  scores: Record<string, number> & { method?: string };
  pagespeed?: { strategy?: string; scores?: Record<string, number | null>; metrics?: Record<string, string | null>; fieldData?: string | null; fetchedAt?: string; error?: string } | null;
};
type AiAnalysis = { summary: string; priorities: { title: string; why: string; issueIds: string[]; effort: string; impact: string }[]; messaging: string[]; contentOpportunities: string[]; conversionIdeas: string[] };
type Audit = AuditRow & { report: Report | null; aiAnalysis: AiAnalysis | null };

const CATEGORIES = ["seo", "accessibility", "performance", "content", "conversion", "security", "links"];
const CAT_LABEL: Record<string, string> = { seo: "SEO", accessibility: "Accessibility", performance: "Performance", content: "Content", conversion: "Conversion", security: "Security", links: "Links" };
const SEV: { key: Issue["severity"]; label: string; tone: Tone }[] = [
  { key: "critical", label: "Critical", tone: "red" },
  { key: "high", label: "High", tone: "red" },
  { key: "medium", label: "Medium", tone: "yellow" },
  { key: "low", label: "Low", tone: "gray" },
];
const PS_LABEL: Record<string, string> = { performance: "Performance", accessibility: "Accessibility", seo: "SEO", bestPractices: "Best practices" };
const METRIC_LABEL: Record<string, string> = { lcp: "Largest Contentful Paint", fcp: "First Contentful Paint", cls: "Cumulative Layout Shift", tbt: "Total Blocking Time", speedIndex: "Speed Index" };

const scoreTone = (n?: number | null) => (n == null ? "text-muted" : n >= 90 ? "text-green-fg" : n >= 50 ? "text-yellow-fg" : "text-red-fg");
const barTone = (n: number) => (n >= 90 ? "bg-green-fg" : n >= 50 ? "bg-yellow-fg" : "bg-red-fg");

export function AuditTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { data: proj } = useProject(projectId);
  const [auditId, setAuditId] = useParam("audit");
  const [url, setUrl] = React.useState("");
  const list = useQuery({ queryKey: ["audits", projectId], queryFn: () => api.get<{ audits: AuditRow[] }>(p(projectId, "/audits")) });
  const audits = list.data?.audits ?? [];
  const current = auditId ?? audits.find((a) => a.status === "completed")?.id ?? audits[0]?.id ?? null;

  const run = useMutation({
    mutationFn: () => api.post<{ auditId: string; jobId: string }>(p(projectId, "/audits"), url.trim() ? { url: /^https?:\/\//.test(url.trim()) ? url.trim() : `https://${url.trim()}` } : {}),
    onSuccess: (r) => {
      toast.success("Audit started");
      setAuditId(r.auditId);
      qc.invalidateQueries({ queryKey: ["audits", projectId] });
    },
    onError: (e) => toastError(e),
  });

  const website = proj?.project?.websiteUrl as string | undefined;

  return (
    <div className="space-y-6">
      <Card className="px-5 py-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px]">
            <div className="text-[13.5px] font-semibold text-ink">Run a website audit</div>
            <p className="text-[12.5px] text-muted mt-0.5">Crawls up to 15 same-origin pages (robots-aware), checks links and runs Lighthouse via PageSpeed Insights when available. Findings include evidence.</p>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-[300px]">
              <Globe size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={website ?? "https://example.com"} className="pl-8" />
            </div>
            <Button variant="primary" onClick={() => run.mutate()} loading={run.isPending} disabled={!website && !url.trim()}>
              <MagnifyingGlass size={14} weight="bold" /> Run audit
            </Button>
          </div>
        </div>
        {!website && !url.trim() && (
          <p className="text-[12px] text-yellow-fg mt-2">
            This project has no website URL. Enter one above or add it in <Link to={`/projects/${projectId}/settings`} className="underline">project settings</Link>.
          </p>
        )}
      </Card>

      <div className="grid lg:grid-cols-[260px_1fr] gap-6 items-start">
        <div className="min-w-0">
          <SectionTitle>History</SectionTitle>
          {list.isLoading ? (
            <ListSkeleton rows={4} />
          ) : !audits.length ? (
            <Card>
              <Empty title="No audits yet" description="Run your first audit above." className="py-8" />
            </Card>
          ) : (
            <Card className="divide-y divide-line overflow-hidden">
              {audits.map((a) => (
                <button key={a.id} onClick={() => setAuditId(a.id)} className={cn("w-full text-left px-3.5 py-2.5 hover:bg-subtle", current === a.id && "bg-canvas")}>
                  <div className="flex items-center gap-2">
                    <span className={cn("text-[15px] font-semibold tabular-nums w-8", scoreTone(a.scores?.overall))}>{a.scores?.overall ?? "—"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] text-ink truncate">{a.url.replace(/^https?:\/\//, "")}</div>
                      <div className="text-[11px] text-muted">
                        {fmtDate(a.createdAt, "MMM d, HH:mm")} · {a.pagesCrawled} pages
                      </div>
                    </div>
                    {a.status !== "completed" && <StatusBadge status={a.status} />}
                  </div>
                </button>
              ))}
            </Card>
          )}
        </div>
        <div className="min-w-0">{current ? <AuditReport projectId={projectId} auditId={current} /> : !list.isLoading && <Card><Empty icon={<MagnifyingGlass size={18} />} title="No report selected" /></Card>}</div>
      </div>
    </div>
  );
}

function AuditReport({ projectId, auditId }: { projectId: string; auditId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["audit", projectId, auditId],
    queryFn: () => api.get<{ audit: Audit }>(p(projectId, `/audits/${auditId}`)),
    refetchInterval: (q) => {
      const s = (q.state.data as { audit: Audit } | undefined)?.audit.status;
      return s === "queued" || s === "running" ? 4000 : false;
    },
  });
  const [progress, setProgress] = React.useState<string | null>(null);
  React.useEffect(
    () =>
      onServerEvent((e) => {
        if (e.type === "audit.progress" && e.data?.id === auditId) setProgress(e.data.message);
      }),
    [auditId],
  );

  if (isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (error || !data)
    return (
      <SetupCallout tone="red" title="Could not load audit">
        {(error as Error)?.message}
      </SetupCallout>
    );
  const a = data.audit;
  if (a.status === "queued" || a.status === "running")
    return (
      <Card className="px-6 py-12 flex flex-col items-center text-center">
        <CircleNotch size={22} className="animate-spin text-muted" />
        <div className="text-[14px] font-medium text-ink mt-3">{a.status === "queued" ? "Waiting for a worker…" : "Auditing " + a.url.replace(/^https?:\/\//, "")}</div>
        <p className="text-[12.5px] text-muted mt-1">{progress ?? "Crawling pages, checking links and running Lighthouse. This usually takes under a minute."}</p>
      </Card>
    );
  if (a.status === "failed" || !a.report)
    return (
      <SetupCallout tone="red" title="Audit failed">
        {a.error ?? "No report was produced."}
      </SetupCallout>
    );

  const r = a.report;
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <ExtLink href={r.finalUrl} className="text-[13px] font-medium" />
          <div className="text-[12px] text-muted mt-0.5">
            Audited {ago(a.finishedAt ?? a.createdAt)} · {r.pages.length} pages · {r.linksChecked} links checked · robots.txt {r.robotsTxt.present ? "present" : "missing"} · sitemap {r.sitemap.present ? `${r.sitemap.urlCount} URLs` : "missing"}
          </div>
        </div>
      </div>

      <ScoresCard scores={r.scores} />
      <PageSpeedCard ps={r.pagespeed} projectId={projectId} />
      <IssuesSection issues={r.issues} />
      <AiSection ai={a.aiAnalysis} issues={r.issues} />
      <PagesTable pages={r.pages} />
      <BrokenLinks links={r.brokenLinks} checked={r.linksChecked} />
    </div>
  );
}

function ScoresCard({ scores }: { scores: Report["scores"] }) {
  return (
    <section>
      <SectionTitle action={<Badge tone="gray">Heuristic</Badge>}>Scores</SectionTitle>
      <Card className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-6">
          <div className="pr-6 sm:border-r border-line">
            <div className="text-[11.5px] text-muted font-medium">Overall</div>
            <div className={cn("text-[40px] font-semibold tabular-nums leading-none mt-1", scoreTone(scores.overall))}>{scores.overall}</div>
          </div>
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-x-5 gap-y-3 min-w-[240px]">
            {CATEGORIES.filter((c) => scores[c] != null).map((c) => (
              <div key={c}>
                <div className="text-[11.5px] text-muted">{CAT_LABEL[c]}</div>
                <div className={cn("text-[18px] font-semibold tabular-nums", scoreTone(scores[c]))}>{scores[c]}</div>
                <div className="h-1 rounded-full bg-black/[0.06] mt-1 overflow-hidden">
                  <div className={cn("h-full rounded-full", barTone(scores[c]!))} style={{ width: `${scores[c]}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-[11.5px] text-faint mt-3">Computed by SocialPilot from the issues detected below (deductions by severity). Not a Lighthouse score.</p>
      </Card>
    </section>
  );
}

function PageSpeedCard({ ps, projectId: _projectId }: { ps: Report["pagespeed"]; projectId: string }) {
  if (!ps) return null;
  if (ps.error)
    return (
      <SetupCallout
        title="PageSpeed Insights did not run"
        action={
          <Button size="sm" asChild>
            <Link to="/settings">Add API key</Link>
          </Button>
        }
      >
        {ps.error} Adding a PageSpeed API key in Settings avoids shared rate limits.
      </SetupCallout>
    );
  if (!ps.scores) return null;
  return (
    <section>
      <SectionTitle action={<Badge tone="green">Measured · Lighthouse {ps.strategy ?? "mobile"}</Badge>}>PageSpeed Insights</SectionTitle>
      <Card className="px-5 py-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Object.entries(ps.scores).map(([k, v]) => (
            <div key={k}>
              <div className="text-[11.5px] text-muted">{PS_LABEL[k] ?? k}</div>
              <div className={cn("text-[24px] font-semibold tabular-nums", scoreTone(v))}>{v ?? "—"}</div>
            </div>
          ))}
        </div>
        {ps.metrics && (
          <div className="mt-4 pt-4 border-t border-line grid grid-cols-2 sm:grid-cols-5 gap-4">
            {Object.entries(ps.metrics).map(([k, v]) => (
              <div key={k}>
                <div className="text-[11px] text-muted">{METRIC_LABEL[k] ?? k}</div>
                <div className="text-[14px] font-medium text-ink tabular-nums">{v ?? "—"}</div>
              </div>
            ))}
          </div>
        )}
        <div className="text-[11.5px] text-faint mt-3">
          {ps.fieldData ? `Real-user field data: ${ps.fieldData}. ` : ""}
          {ps.fetchedAt ? `Measured ${fmtDate(ps.fetchedAt)}.` : ""}
        </div>
      </Card>
    </section>
  );
}

function IssuesSection({ issues }: { issues: Issue[] }) {
  const [cat, setCat] = React.useState<string>("all");
  const filtered = cat === "all" ? issues : issues.filter((i) => i.category === cat);
  const cats = Array.from(new Set(issues.map((i) => i.category)));
  return (
    <section>
      <SectionTitle action={<span className="text-[12px] text-muted">{issues.length} issues · measured</span>}>Issues</SectionTitle>
      {!issues.length ? (
        <Card className="px-5 py-6 flex items-center gap-2 text-[13px] text-ink-2">
          <CheckCircle size={16} weight="fill" className="text-green-fg" /> No issues detected by the crawler.
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 mb-3">
            {["all", ...cats].map((c) => (
              <button key={c} onClick={() => setCat(c)} className={cn("h-7 px-2.5 rounded-full border text-[12px]", cat === c ? "bg-ink text-white border-ink" : "border-line text-ink-2 bg-surface hover:border-line-strong")}>
                {c === "all" ? "All" : CAT_LABEL[c] ?? c} <span className={cat === c ? "text-white/70" : "text-faint"}>{c === "all" ? issues.length : issues.filter((i) => i.category === c).length}</span>
              </button>
            ))}
          </div>
          <div className="space-y-5">
            {SEV.map((s) => {
              const group = filtered.filter((i) => i.severity === s.key);
              if (!group.length) return null;
              return (
                <div key={s.key}>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge tone={s.tone} dot>
                      {s.label}
                    </Badge>
                    <span className="text-[12px] text-muted">{group.length}</span>
                  </div>
                  <Card className="divide-y divide-line overflow-hidden">
                    {group.map((i) => (
                      <IssueRow key={i.id} issue={i} />
                    ))}
                  </Card>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left px-4 py-3 flex items-start gap-2.5 hover:bg-subtle">
        <CaretRight size={12} weight="bold" className={cn("mt-1 text-muted transition-transform shrink-0", open && "rotate-90")} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-ink">{issue.title}</div>
          {!open && <div className="text-[12px] text-muted truncate">{issue.detail}</div>}
        </div>
        <Badge tone="gray">{CAT_LABEL[issue.category] ?? issue.category}</Badge>
        <code className="font-mono text-[10.5px] text-faint hidden sm:inline mt-0.5">{issue.id}</code>
      </button>
      {open && (
        <div className="px-4 pb-4 pl-[38px] space-y-3">
          <p className="text-[12.5px] text-ink-2">{issue.detail}</p>
          <div className="rounded-lg bg-blue-bg/40 border border-[#c7e5f7] px-3 py-2">
            <div className="text-[11px] font-medium text-blue-fg mb-0.5">Recommendation</div>
            <p className="text-[12.5px] text-ink-2">{issue.recommendation}</p>
          </div>
          {issue.evidence.length > 0 && (
            <div>
              <div className="text-[11px] font-medium text-muted mb-1">Evidence ({issue.evidence.length})</div>
              <ul className="space-y-1.5">
                {issue.evidence.slice(0, 20).map((e, i) => (
                  <li key={i} className="text-[12px] min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <ExtLink href={e.url} className="text-[12px]" />
                      {e.count != null && <Badge tone="gray">×{e.count}</Badge>}
                    </div>
                    {e.snippet && <code className="block mt-0.5 font-mono text-[11px] text-muted bg-subtle border border-line rounded px-2 py-1 break-all whitespace-pre-wrap">{e.snippet}</code>}
                  </li>
                ))}
                {issue.evidence.length > 20 && <li className="text-[12px] text-muted">+{issue.evidence.length - 20} more</li>}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AiSection({ ai: raw, issues }: { ai: AiAnalysis | null; issues: Issue[] }) {
  // Brand-analysis audits (from the setup wizard) store { profile } instead of recommendations.
  const ai = raw && Array.isArray((raw as AiAnalysis).priorities) ? raw : null;
  if (!ai)
    return (
      <section>
        <SectionTitle>AI recommendations (hypotheses)</SectionTitle>
        <SetupCallout
          tone="blue"
          title="No AI analysis for this audit"
          action={
            <Button size="sm" asChild>
              <Link to="/settings">AI providers</Link>
            </Button>
          }
        >
          Configure a text AI provider in Settings, then run a new audit to get prioritised recommendations based on the measured issues.
        </SetupCallout>
      </section>
    );
  const byId = new Map(issues.map((i) => [i.id, i]));
  const level = (v: string) => <Badge tone={v === "high" ? "purple" : v === "medium" ? "blue" : "gray"}>{v}</Badge>;
  return (
    <section>
      <SectionTitle action={<Badge tone="purple">AI hypothesis</Badge>}>AI recommendations (hypotheses)</SectionTitle>
      <Card className="px-5 py-4 space-y-5">
        <div className="flex gap-2.5">
          <Sparkle size={15} weight="fill" className="text-purple-fg mt-0.5 shrink-0" />
          <p className="text-[13px] text-ink-2">{ai.summary}</p>
        </div>
        {ai.priorities.length > 0 && (
          <div>
            <div className="text-[11.5px] font-medium text-muted mb-2">Priorities</div>
            <ol className="space-y-3">
              {ai.priorities.map((pr, i) => (
                <li key={i} className="flex gap-3">
                  <span className="h-5 w-5 rounded-full bg-canvas border border-line text-[11px] font-semibold flex items-center justify-center shrink-0 mt-px">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-ink">{pr.title}</span>
                      <span className="text-[11px] text-muted">impact</span>
                      {level(pr.impact)}
                      <span className="text-[11px] text-muted">effort</span>
                      {level(pr.effort)}
                    </div>
                    <p className="text-[12.5px] text-muted mt-0.5">{pr.why}</p>
                    {pr.issueIds.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {pr.issueIds.map((id) => (
                          <span key={id} title={byId.get(id)?.title ?? "Issue not found in this report"} className={cn("font-mono text-[10.5px] rounded border px-1.5 py-px", byId.has(id) ? "border-line bg-subtle text-ink-2" : "border-[#f3cfd1] text-red-fg")}>
                            {id}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
        <div className="grid md:grid-cols-3 gap-4">
          <IdeaList title="Messaging" items={ai.messaging} />
          <IdeaList title="Content opportunities" items={ai.contentOpportunities} />
          <IdeaList title="Conversion ideas" items={ai.conversionIdeas} />
        </div>
      </Card>
    </section>
  );
}

function IdeaList({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="text-[11.5px] font-medium text-muted mb-1.5">{title}</div>
      <ul className="space-y-1 list-disc pl-4 text-[12.5px] text-ink-2">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function PagesTable({ pages }: { pages: Page[] }) {
  return (
    <section>
      <SectionTitle action={<span className="text-[12px] text-muted">{pages.length} pages</span>}>Crawled pages</SectionTitle>
      <Card className="overflow-hidden">
        <Table>
          <thead>
            <tr>
              <Th>Page</Th>
              <Th>Status</Th>
              <Th className="text-right">Time</Th>
              <Th className="text-right">Size</Th>
              <Th className="text-right">Words</Th>
              <Th>H1</Th>
              <Th className="text-right">Images w/o alt</Th>
            </tr>
          </thead>
          <tbody>
            {pages.map((pg) => (
              <tr key={pg.url}>
                <Td className="max-w-[320px]">
                  <div className="text-[12.5px] text-ink truncate">{pg.title || <span className="text-muted">(no title)</span>}</div>
                  <ExtLink href={pg.url} className="text-[11.5px] text-muted">
                    {pathOf(pg.url)}
                  </ExtLink>
                </Td>
                <Td>
                  <Badge tone={pg.status >= 400 ? "red" : pg.status >= 300 ? "yellow" : "green"}>{pg.status}</Badge>
                </Td>
                <Td className="text-right tabular-nums text-[12.5px]">{fmtNum(pg.timingMs)} ms</Td>
                <Td className="text-right tabular-nums text-[12.5px]">{fmtBytes(pg.bytes)}</Td>
                <Td className="text-right tabular-nums text-[12.5px]">{fmtNum(pg.wordCount)}</Td>
                <Td className="text-[12.5px]">{pg.h1.length === 1 ? <span className="truncate block max-w-[200px]">{pg.h1[0]}</span> : <span className={pg.h1.length ? "text-yellow-fg" : "text-red-fg"}>{pg.h1.length} H1</span>}</Td>
                <Td className={cn("text-right tabular-nums text-[12.5px]", pg.images.missingAlt ? "text-yellow-fg" : "text-muted")}>
                  {pg.images.missingAlt}/{pg.images.total}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </section>
  );
}

function BrokenLinks({ links, checked }: { links: Report["brokenLinks"]; checked: number }) {
  return (
    <section>
      <SectionTitle action={<span className="text-[12px] text-muted">{checked} checked</span>}>Broken links</SectionTitle>
      {!links.length ? (
        <Card className="px-5 py-4 flex items-center gap-2 text-[13px] text-ink-2">
          <CheckCircle size={16} weight="fill" className="text-green-fg" /> No broken links among the {checked} checked.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th>Link</Th>
                <Th>Status</Th>
                <Th>Found on</Th>
              </tr>
            </thead>
            <tbody>
              {links.map((l, i) => (
                <tr key={i}>
                  <Td className="max-w-[360px]">
                    <ExtLink href={l.url} className="text-[12px]" />
                  </Td>
                  <Td>
                    <span className="inline-flex items-center gap-1 text-[12px] text-red-fg">
                      {typeof l.status === "number" ? <XCircle size={13} weight="fill" /> : <Warning size={13} weight="fill" />}
                      {l.status}
                    </span>
                  </Td>
                  <Td className="max-w-[280px]">
                    <ExtLink href={l.foundOn} className="text-[12px] text-muted">
                      {pathOf(l.foundOn)}
                    </ExtLink>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </section>
  );
}

function pathOf(u: string) {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
}
