import * as React from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  CheckCircle,
  Circle,
  Globe,
  Info,
  LinkSimple,
  MagnifyingGlass,
  Rocket,
  Sparkle,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { api, ApiError, p } from "@/lib/api";
import { cn, PLATFORM_LABEL, toastError } from "@/lib/utils";
import { onServerEvent } from "@/hooks/useEvents";
import { PageContainer } from "@/components/layout/AppShell";
import { PlatformIcon, SectionTitle, useProject } from "@/components/common";
import { Badge, Button, Card, CardBody, CardHeader, Dialog, DialogContent, Field, Input, SetupCallout, Skeleton, Spinner, StatusBadge } from "@/components/ui";
import { WizardProgress } from "@/components/projects/fields";
import { ProfileEditor, profileFromProposal, profilePayload, type ProfileValue } from "@/components/projects/ProfileEditor";
import { PolicyEditor } from "@/components/projects/PolicyEditor";
import { AiConfigEditor, AiProviderKeys } from "@/components/projects/Providers";

type Analysis = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  error: string | null;
  url: string;
  pagesCrawled: number;
  profile: any | null;
  summary: { pages?: { url: string; title: string; status: number }[]; issues: number; scores: Record<string, any> | null; hints: any } | null;
};

const STEP_TITLES: Record<number, { title: string; description: string }> = {
  3: { title: "Analyze the website", description: "We crawl a handful of public pages to understand the business. Nothing is changed on your site." },
  4: { title: "Confirm the business profile", description: "Agents use this as ground truth. Edit anything that is wrong or missing." },
  5: { title: "Connect accounts", description: "Everything here is optional. Connect what you have now; add more any time from Integrations." },
  6: { title: "Choose AI providers", description: "Bring your own keys. You pay providers directly, within the budgets you set next." },
  7: { title: "Set permissions & limits", description: "Decide what agents may do on their own and what needs your approval." },
  8: { title: "Ready to launch", description: "Here is what works right now and what still needs setup." },
};

function useAnalysis(projectId: string | undefined, auditId: string | null) {
  return useQuery({
    queryKey: ["analysis", projectId, auditId],
    queryFn: () => api.get<Analysis>(p(projectId!, `/analysis/${auditId}`)),
    enabled: !!projectId && !!auditId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "completed" || s === "failed" ? false : 2000;
    },
  });
}

// ───────────────────────── Step 3 ─────────────────────────
const SCORE_LABEL: Record<string, string> = { seo: "SEO", accessibility: "Accessibility", performance: "Performance", content: "Content", conversion: "Conversion", security: "Security", links: "Links" };

function ScoreGrid({ scores }: { scores: Record<string, any> }) {
  const cats = Object.keys(SCORE_LABEL).filter((k) => typeof scores[k] === "number");
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {typeof scores.overall === "number" && (
        <div className="rounded-lg border border-line bg-subtle p-3">
          <div className="text-[11.5px] text-muted">Overall</div>
          <div className="text-[24px] font-semibold text-ink tabular-nums leading-tight">{scores.overall}</div>
        </div>
      )}
      {cats.map((k) => (
        <div key={k} className="rounded-lg border border-line p-3">
          <div className="text-[11.5px] text-muted">{SCORE_LABEL[k]}</div>
          <div className={cn("text-[18px] font-semibold tabular-nums leading-tight", scores[k] < 50 ? "text-red-fg" : scores[k] < 75 ? "text-yellow-fg" : "text-ink")}>{scores[k]}</div>
        </div>
      ))}
    </div>
  );
}

function AnalyzeStep({ project, auditId, setAuditId, onNext }: { project: any; auditId: string | null; setAuditId: (id: string) => void; onNext: () => void }) {
  const projectId = project.id as string;
  const qc = useQueryClient();
  const [url, setUrl] = React.useState(project.websiteUrl ?? "");
  const [progress, setProgress] = React.useState<string[]>([]);
  const audits = useQuery({ queryKey: ["audits", projectId], queryFn: () => api.get<{ audits: { id: string; status: string; createdAt: string }[] }>(p(projectId, "/audits")), enabled: !auditId });
  const analysis = useAnalysis(projectId, auditId);
  const started = React.useRef(false);

  const start = useMutation({
    mutationFn: (u?: string) => api.post<{ auditId: string }>(p(projectId, "/analyze"), u ? { url: u } : {}),
    onSuccess: (r) => {
      setProgress([]);
      setAuditId(r.auditId);
      qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (e) => toastError(e),
  });

  // Adopt the latest analysis, or start one automatically the first time.
  React.useEffect(() => {
    if (auditId || started.current || !audits.data) return;
    const latest = audits.data.audits[0];
    if (latest) {
      started.current = true;
      setAuditId(latest.id);
    } else if (project.websiteUrl) {
      started.current = true;
      start.mutate(undefined);
    }
  }, [audits.data, auditId]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(
    () =>
      onServerEvent((e) => {
        if (e.type === "audit.progress" && e.data?.id === auditId && e.data?.message) setProgress((s) => [...s.slice(-5), e.data.message]);
      }),
    [auditId],
  );

  const normalized = (() => {
    const v = url.trim();
    if (!v) return null;
    try {
      return new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).toString();
    } catch {
      return null;
    }
  })();

  if (!project.websiteUrl && !auditId) {
    return (
      <Card>
        <CardBody className="pt-5 space-y-4">
          <SetupCallout tone="blue" title="This project has no website yet">
            Add one to get a proposed profile, or skip and fill the profile in by hand.
          </SetupCallout>
          <Field label="Website URL">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={onNext}>Skip analysis</Button>
            <Button variant="primary" disabled={!normalized} loading={start.isPending} onClick={() => normalized && start.mutate(normalized)}>
              <MagnifyingGlass size={13} weight="bold" /> Analyze website
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  const a = analysis.data;
  const running = start.isPending || !a || a.status === "queued" || a.status === "running";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon={<Globe size={15} weight="bold" />}
          title={a?.url ?? project.websiteUrl}
          description={running ? "Crawling public pages and extracting the profile…" : a?.status === "failed" ? "The analysis failed." : `Analyzed ${a?.pagesCrawled ?? 0} pages`}
          action={a && <StatusBadge status={a.status} />}
        />
        <CardBody>
          {running ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[13px] text-ink-2">
                <Spinner size={14} /> {progress[progress.length - 1] ?? (a?.status === "queued" ? "Waiting for the worker…" : "Working…")}
              </div>
              {progress.length > 1 && (
                <ul className="text-[12px] text-faint space-y-0.5 font-mono">
                  {progress.slice(0, -1).map((m, i) => (
                    <li key={i} className="truncate">
                      {m}
                    </li>
                  ))}
                </ul>
              )}
              <Skeleton className="h-20" />
              <p className="text-[12px] text-muted">This usually takes under a minute. If it stays queued, check that the worker is running (Settings → System status).</p>
            </div>
          ) : a?.status === "failed" ? (
            <div className="space-y-3">
              <SetupCallout tone="red" title="Could not analyze the website">
                {a.error ?? "Unknown error"}
              </SetupCallout>
              <div className="flex flex-wrap gap-2 items-end">
                <Field label="Website URL" className="flex-1 min-w-[220px]">
                  <Input value={url} onChange={(e) => setUrl(e.target.value)} />
                </Field>
                <Button onClick={() => start.mutate(normalized ?? undefined)} loading={start.isPending}>
                  Retry
                </Button>
              </div>
            </div>
          ) : a ? (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-6">
                <div>
                  <div className="text-[11.5px] text-muted">Pages crawled</div>
                  <div className="text-[22px] font-semibold text-ink tabular-nums">{a.pagesCrawled}</div>
                </div>
                <div>
                  <div className="text-[11.5px] text-muted">Issues found</div>
                  <div className="text-[22px] font-semibold text-ink tabular-nums">{a.summary?.issues ?? 0}</div>
                </div>
                <div>
                  <div className="text-[11.5px] text-muted">Profile proposal</div>
                  <div className="mt-1.5">
                    {a.profile ? <Badge tone={a.profile.method === "ai" ? "purple" : "yellow"}>{a.profile.method === "ai" ? "AI generated" : "Heuristic extraction"}</Badge> : <Badge>None</Badge>}
                  </div>
                </div>
              </div>
              {a.summary?.scores && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[12px] font-medium text-ink-2">Website scores</span>
                    <Badge tone="gray">Measured · heuristic scoring</Badge>
                  </div>
                  <ScoreGrid scores={a.summary.scores} />
                </div>
              )}
              {a.summary?.pages && a.summary.pages.length > 0 && (
                <div>
                  <div className="text-[12px] font-medium text-ink-2 mb-1.5">Crawled pages</div>
                  <ul className="rounded-lg border border-line divide-y divide-line">
                    {a.summary.pages.map((pg) => (
                      <li key={pg.url} className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
                        <span className={cn("font-mono text-[11px] tabular-nums", pg.status >= 400 ? "text-red-fg" : "text-muted")}>{pg.status}</span>
                        <span className="truncate text-ink">{pg.title || "Untitled"}</span>
                        <a href={pg.url} target="_blank" rel="noreferrer" className="ml-auto text-muted hover:text-ink truncate max-w-[45%] font-mono text-[11.5px]">
                          {pg.url.replace(/^https?:\/\//, "")}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-[12px] text-muted">
                See every issue with evidence on the{" "}
                <Link to={`/projects/${projectId}/website`} className="text-ink underline underline-offset-2">
                  Website
                </Link>{" "}
                page after setup.
              </p>
            </div>
          ) : null}
        </CardBody>
      </Card>
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="ghost" disabled={running} onClick={() => start.mutate(normalized ?? undefined)} loading={start.isPending}>
          Re-analyze
        </Button>
        <div className="flex gap-2">
          {running && <Button onClick={onNext}>Skip for now</Button>}
          <Button variant="primary" disabled={running} onClick={onNext}>
            Review profile <ArrowRight size={13} weight="bold" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Step 4 ─────────────────────────
function ProfileStep({ project, auditId, onBack, onNext }: { project: any; auditId: string | null; onBack: () => void; onNext: () => void }) {
  const analysis = useAnalysis(project.id, auditId);
  const qc = useQueryClient();
  const loading = !!auditId && analysis.isLoading;
  const proposal = analysis.data?.status === "completed" ? analysis.data.profile : null;
  const [value, setValue] = React.useState<ProfileValue | null>(null);
  React.useEffect(() => {
    if (!loading && !value) setValue(profileFromProposal(project, proposal));
  }, [loading, proposal]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = useMutation({
    mutationFn: () => api.post(p(project.id, "/apply-profile"), { ...profilePayload(value!), profileSource: proposal ? proposal.method : "manual" }),
    onSuccess: () => {
      toast.success("Profile saved");
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      onNext();
    },
    onError: (e) => toastError(e),
  });

  if (loading || !value)
    return (
      <div className="space-y-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
      </div>
    );

  const logoCandidates: string[] = analysis.data?.summary?.hints?.logoCandidates ?? (proposal?.logoUrl ? [proposal.logoUrl] : []);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px] items-start">
      <div className="space-y-5 min-w-0">
        {proposal ? (
          proposal.method === "ai" ? (
            <SetupCallout tone="blue" title="Proposed by AI from your website">
              Review every field — the AI only used what it found on the crawled pages and may have missed things.
            </SetupCallout>
          ) : (
            <SetupCallout title="Heuristic extraction (no AI)">
              Only facts taken directly from the website (title, description, keywords, colors) were filled in. Add an AI key in the next steps to generate audience, products and voice.
            </SetupCallout>
          )
        ) : (
          <SetupCallout tone="blue" title="Manual profile">
            {auditId && analysis.data?.status === "failed" ? "The website analysis failed, so nothing was pre-filled." : "No website analysis available. Fill in what you know — you can refine it later in Project settings."}
          </SetupCallout>
        )}
        <Card className="p-5 sm:p-6">
          <ProfileEditor
            value={value}
            onChange={setValue}
            logoCandidates={logoCandidates}
          />
        </Card>
        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={13} /> Back
          </Button>
          <Button variant="primary" loading={apply.isPending} disabled={!value.name.trim()} onClick={() => apply.mutate()}>
            Confirm profile <ArrowRight size={13} weight="bold" />
          </Button>
        </div>
      </div>
      {proposal && (
        <aside className="space-y-4 lg:sticky lg:top-4">
          {proposal.evidence?.length > 0 && (
            <Card>
              <CardHeader title="Evidence" description="What the proposal is based on" />
              <CardBody>
                <ul className="space-y-2">
                  {proposal.evidence.slice(0, 10).map((e: string, i: number) => (
                    <li key={i} className="text-[12px] text-ink-2 border-l-2 border-line pl-2.5 leading-snug">
                      {e}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
          {proposal.uncertainties?.length > 0 && (
            <Card>
              <CardHeader title="Uncertain" description="Check these before confirming" />
              <CardBody>
                <ul className="space-y-2">
                  {proposal.uncertainties.map((e: string, i: number) => (
                    <li key={i} className="flex gap-2 text-[12px] text-ink-2 leading-snug">
                      <WarningCircle size={13} className="text-yellow-fg shrink-0 mt-0.5" />
                      {e}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
          {proposal.socialLinks?.length > 0 && (
            <Card>
              <CardHeader title="Social profiles found" description="You can add them in the next step" />
              <CardBody>
                <ul className="space-y-1.5">
                  {proposal.socialLinks.map((s: { platform: string; url: string }) => (
                    <li key={s.url} className="flex items-center gap-2 text-[12px]">
                      <PlatformIcon platform={s.platform} size={13} />
                      <a href={s.url} target="_blank" rel="noreferrer" className="truncate text-ink-2 hover:text-ink">
                        {s.url.replace(/^https?:\/\/(www\.)?/, "")}
                      </a>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </aside>
      )}
    </div>
  );
}

// ───────────────────────── Step 5 ─────────────────────────
type CatalogEntry = {
  id: string;
  name: string;
  kind: "social" | "analytics" | "repository" | "deployment";
  authType: "oauth2" | "api_key" | "token";
  description: string;
  connectFields?: { key: string; label: string; secret?: boolean; placeholder?: string; optional?: boolean }[];
  requirements: string[];
  appConfigured: boolean;
  connections: { id: string; status: string; accountHandle: string | null; accountName: string | null; lastError: string | null }[];
};

const KIND_INFO: Record<CatalogEntry["kind"], { title: string; enables: string }> = {
  social: { title: "Social accounts", enables: "Metrics, publishing, scheduling and inbox replies." },
  analytics: { title: "Web analytics", enables: "Sessions, users, conversions and campaign attribution." },
  repository: { title: "Code repository", enables: "Website code changes as pull requests (never direct to main)." },
  deployment: { title: "Deployments", enables: "Preview and production deployment status, promotion with approval." },
};

function KeyConnectDialog({ entry, projectId, open, onOpenChange }: { entry: CatalogEntry; projectId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [fields, setFields] = React.useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api.post(p(projectId, `/integrations/${entry.id}/connect`), { fields }),
    onSuccess: () => {
      toast.success(`${entry.name} connected`);
      qc.invalidateQueries({ queryKey: ["integrations", projectId] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      onOpenChange(false);
      setFields({});
    },
    onError: (e) => toastError(e),
  });
  const missing = (entry.connectFields ?? []).some((f) => !f.optional && !fields[f.key]?.trim());
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Connect ${entry.name}`}
        description={entry.description}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={m.isPending} disabled={missing} onClick={() => m.mutate()}>
              Connect
            </Button>
          </>
        }
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!missing) m.mutate();
          }}
        >
          {(entry.connectFields ?? []).map((f) => (
            <Field key={f.key} label={`${f.label}${f.optional ? " (optional)" : ""}`}>
              <Input type={f.secret ? "password" : "text"} autoComplete="off" placeholder={f.placeholder} value={fields[f.key] ?? ""} onChange={(e) => setFields((s) => ({ ...s, [f.key]: e.target.value }))} className={f.secret ? "font-mono" : undefined} />
            </Field>
          ))}
          <button type="submit" className="hidden" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function IntegrationRow({ entry, projectId }: { entry: CatalogEntry; projectId: string }) {
  const [needsSetup, setNeedsSetup] = React.useState(!entry.appConfigured);
  const [keyOpen, setKeyOpen] = React.useState(false);
  React.useEffect(() => setNeedsSetup(!entry.appConfigured), [entry.appConfigured]);
  const connect = useMutation({
    mutationFn: () => api.post<{ url: string }>(p(projectId, `/integrations/${entry.id}/connect`), { redirectTo: `/projects/${projectId}/setup?step=5` }),
    onSuccess: (r) => {
      window.location.href = r.url;
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.status === 412 || e.code === "setup_required")) setNeedsSetup(true);
      else toastError(e);
    },
  });
  const live = entry.connections.filter((c) => c.status !== "public_only");
  const publicOnly = entry.connections.filter((c) => c.status === "public_only");
  return (
    <div className="px-4 py-3.5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="h-8 w-8 rounded-lg bg-canvas border border-line flex items-center justify-center text-ink shrink-0">
          <PlatformIcon platform={entry.id} size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-medium text-ink">{entry.name}</span>
            {live.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1.5">
                <StatusBadge status={c.status} />
                {c.accountHandle && <span className="text-[12px] text-muted">@{c.accountHandle}</span>}
              </span>
            ))}
            {publicOnly.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1.5">
                <Badge tone="yellow">Public URL only</Badge>
                {c.accountHandle && <span className="text-[12px] text-muted">@{c.accountHandle}</span>}
              </span>
            ))}
          </div>
          <p className="text-[12px] text-muted mt-0.5">{entry.description}</p>
          {entry.requirements[0] && <p className="text-[11.5px] text-faint mt-1">{entry.requirements[0]}</p>}
          {live.some((c) => c.lastError) && <p className="text-[12px] text-red-fg mt-1">{live.find((c) => c.lastError)?.lastError}</p>}
        </div>
        <div className="shrink-0">
          {entry.authType === "oauth2" ? (
            needsSetup ? null : (
              <Button size="sm" variant={live.length ? "secondary" : "primary"} loading={connect.isPending} onClick={() => connect.mutate()}>
                {live.length ? "Reconnect" : "Connect"}
              </Button>
            )
          ) : (
            <Button size="sm" variant={live.length ? "secondary" : "primary"} onClick={() => setKeyOpen(true)}>
              {live.length ? "Update" : "Connect"}
            </Button>
          )}
        </div>
      </div>
      {entry.authType === "oauth2" && needsSetup && (
        <div className="mt-2.5 ml-11 rounded-lg bg-subtle border border-line px-3 py-2 text-[12px] text-ink-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1.5">
            <Info size={13} className="text-muted" /> Needs a {entry.name} developer app (client ID & secret) before you can connect.
          </span>
          <Link to={`/projects/${projectId}/integrations?setup=${entry.id}`} className="text-ink underline underline-offset-2">
            Setup guide
          </Link>
        </div>
      )}
      {entry.authType !== "oauth2" && <KeyConnectDialog entry={entry} projectId={projectId} open={keyOpen} onOpenChange={setKeyOpen} />}
    </div>
  );
}

function PublicProfileForm({ projectId, suggestions }: { projectId: string; suggestions: { platform: string; url: string }[] }) {
  const qc = useQueryClient();
  const [url, setUrl] = React.useState("");
  const add = useMutation({
    mutationFn: (u: string) => api.post<{ note: string }>(p(projectId, "/integrations/public-profile"), { url: u }),
    onSuccess: (r) => {
      setUrl("");
      toast.success("Public profile added", { description: r.note });
      qc.invalidateQueries({ queryKey: ["integrations", projectId] });
    },
    onError: (e) => toastError(e),
  });
  const social = suggestions.filter((s) => ["instagram", "tiktok", "x"].includes(s.platform));
  return (
    <Card>
      <CardHeader icon={<LinkSimple size={15} weight="bold" />} title="Add public profile URLs" description="Lets agents reference your accounts by handle. Public URLs grant no API access: no metrics, publishing or comments." />
      <CardBody className="space-y-3">
        <form
          className="flex flex-col sm:flex-row gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) add.mutate(url.trim());
          }}
        >
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://x.com/yourbrand" />
          <Button type="submit" loading={add.isPending && add.variables === url.trim()} disabled={!url.trim()}>
            Add URL
          </Button>
        </form>
        {social.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-muted">Found on your website:</span>
            {social.map((s) => (
              <button key={s.url} onClick={() => add.mutate(s.url)} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[12px] text-ink-2 hover:border-line-strong hover:text-ink">
                <PlatformIcon platform={s.platform} size={12} /> {s.url.replace(/^https?:\/\/(www\.)?/, "")}
              </button>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function IntegrationsStep({ projectId, auditId, onBack, onNext }: { projectId: string; auditId: string | null; onBack: () => void; onNext: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ["integrations", projectId], queryFn: () => api.get<{ catalog: CatalogEntry[]; publicBaseUrl: string | null }>(p(projectId, "/integrations")) });
  const analysis = useAnalysis(projectId, auditId);
  const suggestions = analysis.data?.profile?.socialLinks ?? analysis.data?.summary?.hints?.socialLinks ?? [];
  const groups = (["social", "analytics", "repository", "deployment"] as const).map((k) => ({ kind: k, entries: (data?.catalog ?? []).filter((e) => e.kind === k) }));
  return (
    <div className="space-y-5">
      <SetupCallout tone="blue" title="All optional">
        SocialPilot works without any connections — you can draft content, generate media and audit the website. Connections unlock real metrics, publishing and code changes. Nothing is ever published without approval at this stage.
      </SetupCallout>
      {isLoading ? (
        <Skeleton className="h-72" />
      ) : (
        groups.map((g) =>
          g.entries.length ? (
            <section key={g.kind}>
              <SectionTitle action={<span className="text-[11.5px] text-muted hidden sm:inline">{KIND_INFO[g.kind].enables}</span>}>{KIND_INFO[g.kind].title}</SectionTitle>
              <Card className="divide-y divide-line">
                {g.entries.map((e) => (
                  <IntegrationRow key={e.id} entry={e} projectId={projectId} />
                ))}
              </Card>
            </section>
          ) : null,
        )
      )}
      {data && !data.publicBaseUrl && (
        <SetupCallout title="Instagram and TikTok publishing need a public media URL">
          Set PUBLIC_BASE_URL on the server to an HTTPS address those platforms can reach. Drafts and scheduling work without it.
        </SetupCallout>
      )}
      <PublicProfileForm projectId={projectId} suggestions={suggestions} />
      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={13} /> Back
        </Button>
        <Button variant="primary" onClick={onNext}>
          Continue <ArrowRight size={13} weight="bold" />
        </Button>
      </div>
    </div>
  );
}

// ───────────────────────── Step 6 ─────────────────────────
function AiStep({ project, onBack, onNext }: { project: any; onBack: () => void; onNext: () => void }) {
  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>API keys</SectionTitle>
        <p className="text-[12.5px] text-muted mb-3">
          Keys are encrypted at rest and never shown again. A text provider (Anthropic, OpenAI or Gemini) powers agents, profiles and drafts; image and video providers power media generation.
        </p>
        <AiProviderKeys only={["anthropic", "openai", "gemini", "replicate", "stability"]} />
      </section>
      <section>
        <SectionTitle>Models for this project</SectionTitle>
        <AiConfigEditor
          projectId={project.id}
          initial={project.aiConfig}
          saveLabel="Save & continue"
          onSaved={onNext}
          secondaryAction={
            <>
              <Button variant="ghost" onClick={onBack} className="mr-auto">
                <ArrowLeft size={13} /> Back
              </Button>
              <Button onClick={onNext}>Skip</Button>
            </>
          }
        />
      </section>
    </div>
  );
}

// ───────────────────────── Step 8 ─────────────────────────
function ReadinessItem({ ok, label, detail, fix }: { ok: boolean; label: string; detail: string; fix?: { to: string; label: string } }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      {ok ? <CheckCircle size={16} weight="fill" className="text-green-fg mt-0.5 shrink-0" /> : <Circle size={16} className="text-faint mt-0.5 shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-ink">{label}</div>
        <div className="text-[12px] text-muted">{detail}</div>
      </div>
      {!ok && fix && (
        <Button asChild size="sm" variant="ghost">
          <Link to={fix.to}>{fix.label}</Link>
        </Button>
      )}
    </li>
  );
}

function LaunchStep({ project, readiness, policy, onBack }: { project: any; readiness: any; policy: any; onBack: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const id = project.id;
  const launch = useMutation({
    mutationFn: () => api.patch(p(id), { setupComplete: true, setupStep: 8 }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(`${project.name} is ready`);
      navigate(`/projects/${id}`);
    },
    onError: (e) => toastError(e),
  });
  if (!readiness) return <Skeleton className="h-72" />;
  const socials = Object.entries(readiness.social ?? {}) as [string, boolean][];
  const items = [
    { ok: readiness.website, label: "Website", detail: readiness.website ? "Audits, uptime and profile context available." : "Add a website URL to enable audits.", fix: { to: `/projects/${id}/settings`, label: "Add website" } },
    { ok: readiness.ai?.text, label: "Text AI", detail: readiness.ai?.text ? "Agents, drafts, campaigns and replies can be generated." : "Agents and drafting need a text provider key.", fix: { to: `/projects/${id}/setup?step=6`, label: "Add key" } },
    { ok: readiness.ai?.image, label: "Image generation", detail: readiness.ai?.image ? "Generate and edit images." : "Needs an OpenAI, Replicate or Stability key.", fix: { to: `/projects/${id}/setup?step=6`, label: "Add key" } },
    { ok: readiness.ai?.video, label: "Video generation", detail: readiness.ai?.video ? "Generate short videos." : "Needs a Replicate key. FFmpeg editing works without it.", fix: { to: `/projects/${id}/setup?step=6`, label: "Add key" } },
    ...socials.map(([pl, ok]) => ({ ok, label: PLATFORM_LABEL[pl] ?? pl, detail: ok ? "Metrics, publishing and inbox (per platform capabilities)." : "Not connected — content can still be drafted and exported.", fix: { to: `/projects/${id}/setup?step=5`, label: "Connect" } })),
    { ok: readiness.analytics, label: "Web analytics", detail: readiness.analytics ? "Sessions, users and conversions are measured." : "Connect GA4 or Plausible to measure traffic.", fix: { to: `/projects/${id}/setup?step=5`, label: "Connect" } },
    { ok: readiness.repository, label: "Code repository", detail: readiness.repository ? "Website changes can be proposed as pull requests." : "Connect GitHub to let agents propose code changes.", fix: { to: `/projects/${id}/setup?step=5`, label: "Connect" } },
    { ok: readiness.deployment, label: "Deployments", detail: readiness.deployment ? "Preview and production deployments tracked." : "Connect Vercel to follow deployments.", fix: { to: `/projects/${id}/setup?step=5`, label: "Connect" } },
    { ok: readiness.publicMedia, label: "Public media URL", detail: readiness.publicMedia ? "Instagram/TikTok can fetch media for publishing." : "Server PUBLIC_BASE_URL is not set — Instagram/TikTok media publishing is unavailable.", fix: { to: "/settings", label: "System status" } },
  ];
  const ready = items.filter((i) => i.ok);
  const pending = items.filter((i) => !i.ok);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 items-start">
        <Card>
          <CardHeader title="Works now" description={`${ready.length} of ${items.length}`} icon={<CheckCircle size={15} weight="fill" className="text-green-fg" />} />
          {ready.length ? (
            <ul className="divide-y divide-line border-t border-line">
              {ready.map((i) => (
                <ReadinessItem key={i.label} {...i} />
              ))}
            </ul>
          ) : (
            <CardBody className="text-[12.5px] text-muted">Nothing connected yet — you can still write notes and plan manually.</CardBody>
          )}
        </Card>
        <Card>
          <CardHeader title="Needs setup" description="Optional — add any time" icon={<XCircle size={15} className="text-muted" />} />
          {pending.length ? (
            <ul className="divide-y divide-line border-t border-line">
              {pending.map((i) => (
                <ReadinessItem key={i.label} {...i} />
              ))}
            </ul>
          ) : (
            <CardBody className="text-[12.5px] text-muted">Everything is set up.</CardBody>
          )}
        </Card>
      </div>
      <Card className="p-4 flex flex-wrap items-center gap-3 text-[12.5px] text-ink-2">
        <Sparkle size={15} className="text-muted" weight="fill" />
        <span>
          Autonomy: <span className="font-medium text-ink">Level {policy?.autonomyLevel ?? 2}</span> · approvals required for publish, reply, merge and deploy{(policy?.autonomyLevel ?? 2) >= 4 ? " (per your toggles)" : ""}.
        </span>
        <Link to={`/projects/${id}/setup?step=7`} className="ml-auto text-ink underline underline-offset-2">
          Change
        </Link>
      </Card>
      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={13} /> Back
        </Button>
        <Button variant="primary" size="lg" loading={launch.isPending} onClick={() => launch.mutate()}>
          <Rocket size={15} weight="fill" /> Open command center
        </Button>
      </div>
    </div>
  );
}

// ───────────────────────── Page ─────────────────────────
export default function ProjectSetup() {
  const { projectId } = useParams();
  const [params, setParams] = useSearchParams();
  const { data, isLoading, error, refetch } = useProject(projectId);
  const qc = useQueryClient();
  const project = data?.project;
  const rawStep = Number(params.get("step"));
  const step = Math.min(8, Math.max(3, rawStep || project?.setupStep || 3));
  const auditId = params.get("audit");

  // OAuth return handling (redirectTo = setup?step=5).
  React.useEffect(() => {
    const connected = params.get("connected");
    const err = params.get("oauth_error");
    if (!connected && !err) return;
    if (connected) toast.success(`${PLATFORM_LABEL[connected] ?? connected} connected`);
    if (err) toast.error(`Connection failed: ${err}`);
    params.delete("connected");
    params.delete("oauth_error");
    setParams(params, { replace: true });
    qc.invalidateQueries({ queryKey: ["integrations", projectId] });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (step === 8) void refetch();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = React.useCallback(
    (n: number) => {
      const next = new URLSearchParams(params);
      next.set("step", String(n));
      setParams(next);
      window.scrollTo?.({ top: 0 });
      document.querySelector("main")?.scrollTo?.({ top: 0 });
      if (projectId && project && !project.setupComplete && n > (project.setupStep ?? 1)) {
        void api
          .patch(p(projectId), { setupStep: n })
          .then(() => qc.invalidateQueries({ queryKey: ["project", projectId] }))
          .catch(() => undefined);
      }
    },
    [params, setParams, projectId, project, qc],
  );
  const setAuditId = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("audit", id);
    next.set("step", "3");
    setParams(next, { replace: true });
  };

  if (error)
    return (
      <PageContainer>
        <SetupCallout tone="red" title="Could not load the project">
          {(error as Error).message}
        </SetupCallout>
      </PageContainer>
    );

  const head = STEP_TITLES[step];
  return (
    <PageContainer className="max-w-5xl">
      <div className="mb-5 flex items-center justify-between gap-3">
        <Link to="/" className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink">
          <ArrowLeft size={12} /> All projects
        </Link>
        {project?.setupComplete && (
          <Link to={`/projects/${projectId}`} className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink">
            Command center <ArrowSquareOut size={12} />
          </Link>
        )}
      </div>
      <div className="mb-6">
        <div className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium mb-1">{project ? `Setting up ${project.name}` : "Project setup"}</div>
        <h1 className="serif-title text-[34px] text-ink">{head.title}</h1>
        <p className="text-[13.5px] text-muted mt-1.5 max-w-2xl">{head.description}</p>
      </div>
      <div className="mb-6">
        <WizardProgress step={step} onStepClick={go} maxReachable={8} />
      </div>

      {isLoading || !project ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : step === 3 ? (
        <AnalyzeStep project={project} auditId={auditId} setAuditId={setAuditId} onNext={() => go(4)} />
      ) : step === 4 ? (
        <ProfileStep key={auditId ?? "none"} project={project} auditId={auditId} onBack={() => go(3)} onNext={() => go(5)} />
      ) : step === 5 ? (
        <IntegrationsStep projectId={project.id} auditId={auditId} onBack={() => go(4)} onNext={() => go(6)} />
      ) : step === 6 ? (
        <AiStep project={project} onBack={() => go(5)} onNext={() => go(7)} />
      ) : step === 7 ? (
        <PolicyEditor
          projectId={project.id}
          initial={data?.policy}
          saveLabel="Save & continue"
          onSaved={() => go(8)}
          secondaryAction={
            <Button variant="ghost" onClick={() => go(6)} className="mr-auto">
              <ArrowLeft size={13} /> Back
            </Button>
          }
        />
      ) : (
        <LaunchStep project={project} readiness={data?.readiness} policy={data?.policy} onBack={() => go(7)} />
      )}
    </PageContainer>
  );
}
