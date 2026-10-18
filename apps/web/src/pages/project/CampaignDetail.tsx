import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarCheck, FilePlus, FloppyDisk, Plus, Sparkle, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/AppShell";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogContent,
  Empty,
  Field,
  Input,
  Select,
  SetupCallout,
  Skeleton,
  Spinner,
  Stat,
  StatusBadge,
  Table,
  Td,
  Textarea,
  Th,
} from "@/components/ui";
import { SectionTitle, useProject } from "@/components/common";
import { api, p } from "@/lib/api";
import { cn, fmtNum, PLATFORM_LABEL, titleCase, toastError } from "@/lib/utils";
import {
  AssetThumb,
  CAMPAIGN_STATUSES,
  dateRange,
  fmtTz,
  PlatformIcons,
  PlatformToggle,
  postLabel,
  STATUS_DOT,
  useJobWatcher,
  type Asset,
  type Campaign,
  type Post,
  type SocialPlatform,
} from "@/components/content/shared";

type Plan = {
  summary: string;
  pillars: string[];
  kpis: string[];
  posts: { day: number; time: string; platforms: SocialPlatform[]; type: string; title: string; body: string; thread?: string[]; xText?: string; hashtags: string[]; cta: string; imagePrompt?: string; pillar?: string }[];
};
type Detail = {
  campaign: Omit<Campaign, "plan"> & { posts: Post[]; assets: Asset[]; plan: Plan | null };
  performance: null | { posts: number; published: number; scheduled: number; socialTotals: Record<string, number>; webSessions: number | null; webConversions: number | null };
};
type ScheduleResultRow = { postId: string; scheduledAt?: string; error?: string; targets?: { platform: string; status: string; lastError?: string }[] };

const COLUMNS: { id: string; label: string; statuses: string[] }[] = [
  { id: "draft", label: "Draft", statuses: ["draft", "cancelled"] },
  { id: "in_review", label: "In review", statuses: ["in_review", "approved"] },
  { id: "scheduled", label: "Scheduled", statuses: ["scheduled", "publishing", "manual_handoff"] },
  { id: "published", label: "Published", statuses: ["published", "partially_published"] },
  { id: "failed", label: "Failed", statuses: ["failed"] },
];

const toDateInput = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

function BriefCard({ projectId, campaign }: { projectId: string; campaign: Omit<Campaign, "plan"> }) {
  const qc = useQueryClient();
  const init = React.useCallback(
    () => ({
      name: campaign.name,
      objective: campaign.objective,
      targetAudience: campaign.targetAudience,
      startDate: toDateInput(campaign.startDate),
      endDate: toDateInput(campaign.endDate),
      platforms: campaign.platforms,
      pillars: (campaign.pillars ?? []).join("\n"),
      guidelines: campaign.guidelines,
      budgetUsd: campaign.budgetUsd != null ? String(campaign.budgetUsd) : "",
      status: campaign.status,
    }),
    [campaign],
  );
  const [f, setF] = React.useState(init);
  const [dirty, setDirty] = React.useState(false);
  React.useEffect(() => {
    if (!dirty) setF(init());
  }, [init, dirty]);
  const set = (patch: Partial<typeof f>) => {
    setF((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const m = useMutation({
    mutationFn: () =>
      api.patch(p(projectId, `/campaigns/${campaign.id}`), {
        name: f.name.trim(),
        objective: f.objective,
        targetAudience: f.targetAudience,
        startDate: f.startDate || null,
        endDate: f.endDate || null,
        platforms: f.platforms,
        pillars: f.pillars
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean)
          .slice(0, 20),
        guidelines: f.guidelines,
        budgetUsd: f.budgetUsd ? Number(f.budgetUsd) : null,
        status: f.status,
      }),
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["campaign"] });
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success("Campaign updated");
    },
    onError: (e) => toastError(e),
  });
  return (
    <Card>
      <CardHeader
        title="Brief"
        description={`UTM campaign: ${campaign.slug}`}
        action={
          <>
            {dirty && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDirty(false);
                  setF(init());
                }}
              >
                Discard
              </Button>
            )}
            <Button size="sm" variant="primary" disabled={!dirty || !f.name.trim()} loading={m.isPending} onClick={() => m.mutate()}>
              <FloppyDisk size={13} /> Save
            </Button>
          </>
        }
      />
      <CardBody className="grid sm:grid-cols-2 gap-3">
        <Field label="Name">
          <Input value={f.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={(e) => set({ status: e.target.value })}>
            {CAMPAIGN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Objective" className="sm:col-span-2">
          <Textarea value={f.objective} onChange={(e) => set({ objective: e.target.value })} className="min-h-[56px]" />
        </Field>
        <Field label="Target audience" className="sm:col-span-2">
          <Input value={f.targetAudience} onChange={(e) => set({ targetAudience: e.target.value })} />
        </Field>
        <Field label="Start date">
          <Input type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} />
        </Field>
        <Field label="End date">
          <Input type="date" value={f.endDate} onChange={(e) => set({ endDate: e.target.value })} />
        </Field>
        <Field label="Platforms" className="sm:col-span-2">
          <PlatformToggle value={f.platforms} onChange={(v) => set({ platforms: v })} />
        </Field>
        <Field label="Pillars" hint="One per line.">
          <Textarea value={f.pillars} onChange={(e) => set({ pillars: e.target.value })} className="min-h-[72px]" />
        </Field>
        <Field label="Guidelines">
          <Textarea value={f.guidelines} onChange={(e) => set({ guidelines: e.target.value })} className="min-h-[72px]" />
        </Field>
        <Field label="Budget (USD)">
          <Input type="number" min={0} value={f.budgetUsd} onChange={(e) => set({ budgetUsd: e.target.value })} />
        </Field>
      </CardBody>
    </Card>
  );
}

function PerformanceCard({ projectId, perf }: { projectId: string; perf: Detail["performance"] }) {
  if (!perf)
    return (
      <Card>
        <CardHeader title="Performance" />
        <CardBody>
          <p className="text-[12.5px] text-muted">Not available yet.</p>
        </CardBody>
      </Card>
    );
  const totals = Object.entries(perf.socialTotals ?? {});
  return (
    <Card>
      <CardHeader title="Performance" description="Measured from published posts and your analytics integration." />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Published" value={fmtNum(perf.published)} sub="platform publications" />
          <Stat label="Scheduled" value={fmtNum(perf.scheduled)} sub="upcoming publications" />
          <Stat label="Web sessions" value={perf.webSessions != null ? fmtNum(perf.webSessions) : <span className="text-[14px] text-muted font-normal">Not available</span>} sub="UTM-attributed" />
          <Stat label="Conversions" value={perf.webConversions != null ? fmtNum(perf.webConversions) : <span className="text-[14px] text-muted font-normal">Not available</span>} sub="UTM-attributed" />
        </div>
        <div>
          <SectionTitle>Social totals</SectionTitle>
          {totals.length ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {totals.map(([k, v]) => (
                <div key={k} className="flex justify-between text-[12.5px]">
                  <span className="text-muted">{titleCase(k)}</span>
                  <span className="text-ink tabular-nums font-medium">{fmtNum(v)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12.5px] text-muted">No metrics collected yet — they appear after published posts are synced.</p>
          )}
        </div>
        {perf.webSessions == null && (
          <p className="text-[12px] text-muted">
            Web attribution needs GA4 or Plausible connected and traffic tagged with this campaign's UTM.{" "}
            <Link to={`/projects/${projectId}/integrations`} className="underline underline-offset-2">
              Integrations
            </Link>
          </p>
        )}
      </CardBody>
    </Card>
  );
}

export default function CampaignDetail() {
  const { projectId = "", campaignId = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: proj } = useProject(projectId);
  const tz = proj?.project?.timezone ?? "UTC";
  const textAI = proj?.readiness?.ai?.text;
  const imageAI = proj?.readiness?.ai?.image;
  const { data, isLoading, error } = useQuery({ queryKey: ["campaign", projectId, campaignId], queryFn: () => api.get<Detail>(p(projectId, `/campaigns/${campaignId}`)) });
  const campaign = data?.campaign;

  const jobs = useJobWatcher((_id, ok, err, name) => {
    qc.invalidateQueries({ queryKey: ["campaign"] });
    qc.invalidateQueries({ queryKey: ["posts"] });
    if (ok) toast.success(name === "campaign.materialize" ? "Drafts created from the plan" : "Plan ready");
    else toast.error(err ?? "The job failed");
  });

  const [days, setDays] = React.useState("7");
  const [ppd, setPpd] = React.useState("1");
  const [extra, setExtra] = React.useState("");
  const [materialize, setMaterialize] = React.useState(false);
  const [genImages, setGenImages] = React.useState(false);
  const plan = useMutation({
    mutationFn: () =>
      api.post<{ jobId: string }>(p(projectId, `/campaigns/${campaignId}/plan`), {
        days: Math.max(1, Math.min(31, Number(days) || 7)),
        postsPerDay: Math.max(0.2, Math.min(5, Number(ppd) || 1)),
        ...(extra.trim() ? { extra: extra.trim() } : {}),
        materialize,
        generateImages: materialize && genImages,
      }),
    onSuccess: (r) => {
      jobs.track(r.jobId, "plan");
      toast.success("Planning started — the plan appears here when it's ready");
    },
    onError: (e) => toastError(e),
  });
  const [matImages, setMatImages] = React.useState(false);
  const mat = useMutation({
    mutationFn: () => api.post<{ jobId: string }>(p(projectId, `/campaigns/${campaignId}/materialize`), { generateImages: matImages }),
    onSuccess: (r) => {
      jobs.track(r.jobId, "materialize");
      toast.success("Creating drafts…");
    },
    onError: (e) => toastError(e),
  });
  const [schedResults, setSchedResults] = React.useState<ScheduleResultRow[] | null>(null);
  const [schedConfirm, setSchedConfirm] = React.useState(false);
  const schedulePlan = useMutation({
    mutationFn: () => api.post<{ results: ScheduleResultRow[] }>(p(projectId, `/campaigns/${campaignId}/schedule-plan`)),
    onSuccess: (r) => {
      setSchedConfirm(false);
      setSchedResults(r.results);
      ["campaign", "posts", "calendar"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => toastError(e),
  });
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const del = useMutation({
    mutationFn: () => api.del(p(projectId, `/campaigns/${campaignId}`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      navigate(`/projects/${projectId}/campaigns`);
      toast.success("Campaign deleted");
    },
    onError: (e) => toastError(e),
  });
  const newPost = useMutation({
    mutationFn: () => api.post<{ post: Post }>(p(projectId, "/posts"), { title: "", body: "", campaignId, platforms: campaign?.platforms ?? [] }),
    onSuccess: (r) => navigate(`/projects/${projectId}/content/${r.post.id}`),
    onError: (e) => toastError(e),
  });

  if (isLoading)
    return (
      <PageContainer wide>
        <Skeleton className="h-10 w-72 mb-6" />
        <div className="grid lg:grid-cols-3 gap-5">
          <Skeleton className="h-80 lg:col-span-2" />
          <Skeleton className="h-80" />
        </div>
      </PageContainer>
    );
  if (error || !campaign)
    return (
      <PageContainer>
        <Empty title="Campaign not found" description={(error as Error)?.message} action={<Button asChild><Link to={`/projects/${projectId}/campaigns`}>Back to campaigns</Link></Button>} />
      </PageContainer>
    );

  const planData = campaign.plan;
  const drafts = campaign.posts.filter((x) => x.status === "draft");
  const planning = jobs.isPending("plan");
  const materializing = jobs.isPending("materialize");

  return (
    <PageContainer wide>
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <Button asChild variant="ghost" size="icon" aria-label="Back to campaigns">
          <Link to={`/projects/${projectId}/campaigns`}>
            <ArrowLeft size={16} />
          </Link>
        </Button>
        <div className="flex-1 min-w-[220px]">
          <div className="text-[11px] uppercase tracking-[0.08em] text-muted mb-1 font-medium">Campaign</div>
          <h1 className="serif-title text-[34px] text-ink leading-tight">{campaign.name}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[12.5px] text-muted">
            <StatusBadge status={campaign.status} />
            <span>{dateRange(campaign)}</span>
            <PlatformIcons platforms={campaign.platforms} size={13} />
          </div>
        </div>
        <Button variant="secondary" loading={newPost.isPending} onClick={() => newPost.mutate()}>
          <Plus size={14} /> New post
        </Button>
        <Button variant="danger-ghost" onClick={() => setDeleteOpen(true)}>
          <Trash size={14} /> Delete
        </Button>
      </div>

      <div className="grid lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-5 min-w-0">
          {/* AI plan */}
          <Card>
            <CardHeader title="AI plan" description="A day-by-day posting plan grounded in your brand profile and this brief." icon={<Sparkle size={14} weight="fill" className="text-muted" />} />
            <CardBody className="space-y-4">
              {!textAI && proj && (
                <SetupCallout
                  title="Add a text AI provider to generate plans"
                  action={
                    <Button asChild size="sm" variant="secondary">
                      <Link to="/settings">Open settings</Link>
                    </Button>
                  }
                >
                  Planning uses your own Anthropic, OpenAI or Gemini key.
                </SetupCallout>
              )}
              <div className="grid sm:grid-cols-[100px_120px_1fr] gap-3">
                <Field label="Days">
                  <Input type="number" min={1} max={31} value={days} onChange={(e) => setDays(e.target.value)} />
                </Field>
                <Field label="Posts / day">
                  <Input type="number" min={0.2} max={5} step={0.1} value={ppd} onChange={(e) => setPpd(e.target.value)} />
                </Field>
                <Field label="Extra instructions">
                  <Input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="e.g. focus on the new pricing, one video per week" />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <Checkbox checked={materialize} onCheckedChange={setMaterialize} label="Create drafts" />
                <Checkbox checked={genImages} disabled={!materialize || !imageAI} onCheckedChange={setGenImages} label={<span>Generate images{!imageAI && proj ? <span className="text-faint"> (needs image AI key)</span> : null}</span>} />
                <div className="flex-1" />
                <Button variant="primary" loading={plan.isPending} disabled={planning || !textAI} onClick={() => plan.mutate()}>
                  {planning ? <Spinner size={13} className="text-white" /> : <Sparkle size={13} weight="fill" />}
                  {planning ? "Planning…" : planData ? "Regenerate plan" : "Generate plan"}
                </Button>
              </div>
              {genImages && materialize && <p className="text-[12px] text-muted">Image generation uses your image AI provider and may incur costs.</p>}
            </CardBody>
          </Card>

          {/* Plan table */}
          <Card>
            <CardHeader
              title="Plan"
              description={planData ? `${planData.posts.length} planned posts` : undefined}
              action={
                planData ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Checkbox checked={matImages} disabled={!imageAI} onCheckedChange={setMatImages} label={<span className="text-[12px]">with images</span>} />
                    <Button size="sm" variant="secondary" loading={mat.isPending} disabled={materializing} onClick={() => mat.mutate()}>
                      {materializing ? <Spinner size={12} /> : <FilePlus size={13} />} Create drafts from plan
                    </Button>
                    <Button size="sm" variant="secondary" disabled={!drafts.length} onClick={() => setSchedConfirm(true)}>
                      <CalendarCheck size={13} /> Schedule plan
                    </Button>
                  </div>
                ) : undefined
              }
            />
            {!planData ? (
              <CardBody>
                <p className="text-[12.5px] text-muted">{planning ? "Generating the plan — this can take a minute." : "No plan yet. Generate one above."}</p>
              </CardBody>
            ) : (
              <>
                <CardBody className="space-y-3">
                  <p className="text-[13px] text-ink-2 leading-relaxed">{planData.summary}</p>
                  <div className="flex flex-wrap gap-4">
                    {planData.pillars?.length > 0 && (
                      <div>
                        <div className="text-[11.5px] text-muted mb-1">Pillars</div>
                        <div className="flex flex-wrap gap-1">
                          {planData.pillars.map((x) => (
                            <Badge key={x} tone="gray" className="normal-case tracking-normal text-[11.5px]">
                              {x}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {planData.kpis?.length > 0 && (
                      <div>
                        <div className="text-[11.5px] text-muted mb-1">KPIs (AI suggested)</div>
                        <div className="flex flex-wrap gap-1">
                          {planData.kpis.map((x) => (
                            <Badge key={x} tone="purple" className="normal-case tracking-normal text-[11.5px]">
                              {x}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </CardBody>
                <Table>
                  <thead>
                    <tr>
                      <Th>Day</Th>
                      <Th>Time</Th>
                      <Th>Platforms</Th>
                      <Th>Type</Th>
                      <Th>Title / hook</Th>
                      <Th className="hidden xl:table-cell">Body</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...planData.posts]
                      .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time))
                      .map((x, i) => (
                        <tr key={i}>
                          <Td className="tabular-nums">{x.day}</Td>
                          <Td className="tabular-nums whitespace-nowrap">{x.time}</Td>
                          <Td>
                            <PlatformIcons platforms={x.platforms} size={13} />
                          </Td>
                          <Td className="whitespace-nowrap">{titleCase(x.type)}</Td>
                          <Td className="max-w-[260px]">
                            <div className="text-[13px] font-medium text-ink">{x.title}</div>
                            <div className="text-[12px] text-muted line-clamp-2">{(x.xText || x.body).split("\n")[0]}</div>
                            {x.pillar && <div className="text-[11px] text-faint mt-0.5">{x.pillar}</div>}
                          </Td>
                          <Td className="hidden xl:table-cell max-w-[340px]">
                            <p className="text-[12px] text-ink-2 line-clamp-4 whitespace-pre-line">{x.body}</p>
                            {x.thread?.length ? <p className="text-[11px] text-faint mt-1">X thread · {x.thread.length} parts</p> : null}
                          </Td>
                        </tr>
                      ))}
                  </tbody>
                </Table>
                <p className="text-[11.5px] text-faint px-5 py-2.5">Times are in the project timezone ({tz}); day 1 is the campaign start date, or tomorrow if none is set.</p>
              </>
            )}
          </Card>

          {/* Board */}
          <div>
            <SectionTitle>Posts board</SectionTitle>
            {!campaign.posts.length ? (
              <Card>
                <Empty title="No posts in this campaign" description="Create drafts from the plan or add a post." className="py-8" />
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
                {COLUMNS.map((col) => {
                  const items = campaign.posts.filter((x) => col.statuses.includes(x.status));
                  return (
                    <div key={col.id} className="rounded-xl border border-line bg-subtle min-h-[120px]">
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
                        <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[col.id])} />
                        <span className="text-[12.5px] font-medium text-ink">{col.label}</span>
                        <span className="text-[12px] text-muted ml-auto tabular-nums">{items.length}</span>
                      </div>
                      <div className="p-2 space-y-2">
                        {items.map((post) => (
                          <Link key={post.id} to={`/projects/${projectId}/content/${post.id}`} className="block rounded-lg border border-line bg-surface p-2.5 hover:border-line-strong transition-colors">
                            <div className="text-[12.5px] font-medium text-ink line-clamp-2">{postLabel(post)}</div>
                            <div className="flex items-center justify-between mt-1.5">
                              <PlatformIcons platforms={post.platforms} size={11} />
                              {post.status !== col.id && <span className="text-[10.5px] text-muted">{post.status.replace(/_/g, " ")}</span>}
                            </div>
                            {post.scheduledAt && <div className="text-[11px] text-muted mt-1">{fmtTz(post.scheduledAt, tz)}</div>}
                          </Link>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Assets */}
          <div>
            <SectionTitle
              action={
                <Button asChild size="sm" variant="ghost">
                  <Link to={`/projects/${projectId}/workspace?campaign=${campaignId}`}>Open in workspace</Link>
                </Button>
              }
            >
              Campaign assets
            </SectionTitle>
            {!campaign.assets.length ? (
              <Card>
                <Empty title="No assets yet" description="Generate or upload media in the AI Workspace and assign it to this campaign." className="py-8" />
              </Card>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
                {campaign.assets.map((a) => (
                  <Link key={a.id} to={`/projects/${projectId}/workspace?asset=${a.id}`} className="rounded-lg border border-line bg-surface overflow-hidden hover:border-line-strong">
                    <AssetThumb projectId={projectId} asset={a} className="aspect-square" />
                    <div className="px-2 py-1 text-[11px] text-ink-2 truncate">{a.name}</div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5 min-w-0">
          <PerformanceCard projectId={projectId} perf={data?.performance ?? null} />
          <BriefCard projectId={projectId} campaign={campaign} />
        </div>
      </div>

      <ConfirmDialog
        open={schedConfirm}
        onOpenChange={setSchedConfirm}
        title="Schedule the plan?"
        description={`Schedules ${drafts.length} draft(s) created from the plan at their planned day and time (${tz}). Each post must pass the quality check; platforms that aren't connected become manual handoffs. You're scheduling as yourself, so no approval is needed.`}
        confirmLabel="Schedule drafts"
        loading={schedulePlan.isPending}
        onConfirm={() => schedulePlan.mutate()}
      />
      <Dialog open={!!schedResults} onOpenChange={(v) => !v && setSchedResults(null)}>
        <DialogContent title="Schedule results" className="max-w-xl" footer={<Button variant="primary" onClick={() => setSchedResults(null)}>Done</Button>}>
          {!schedResults?.length ? (
            <p className="text-[13px] text-muted">No drafts with a planned slot were found. Drafts must be created from the plan (their notes contain the planned day/time).</p>
          ) : (
            <div className="divide-y divide-line rounded-lg border border-line">
              {schedResults.map((r) => {
                const post = campaign.posts.find((x) => x.id === r.postId);
                return (
                  <div key={r.postId} className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Link to={`/projects/${projectId}/content/${r.postId}`} className="text-[13px] font-medium text-ink hover:underline underline-offset-2 truncate flex-1">
                        {post ? postLabel(post) : r.postId}
                      </Link>
                      {r.error ? <Badge tone="red">error</Badge> : <Badge tone="blue">{fmtTz(r.scheduledAt, tz)}</Badge>}
                    </div>
                    {r.error && <p className="text-[12px] text-red-fg mt-1">{r.error}</p>}
                    {r.targets && (
                      <div className="flex flex-wrap gap-2 mt-1.5">
                        {r.targets.map((t) => (
                          <span key={t.platform} className="text-[11.5px] text-muted" title={t.lastError}>
                            {PLATFORM_LABEL[t.platform]}: {t.status === "manual" ? "manual handoff" : t.status}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this campaign?"
        description="Posts and assets stay in the library but lose their campaign link. Scheduled posts must be unscheduled first."
        confirmLabel="Delete campaign"
        danger
        loading={del.isPending}
        onConfirm={() => del.mutate()}
      />
    </PageContainer>
  );
}
