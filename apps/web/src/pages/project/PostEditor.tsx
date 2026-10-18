import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarPlus,
  CheckCircle,
  ClockCounterClockwise,
  CopySimple,
  DotsThree,
  FloppyDisk,
  Images,
  Info,
  LinkSimple,
  PaperPlaneTilt,
  DownloadSimple,
  Plus,
  SealCheck,
  Trash,
  Warning,
  X as XIcon,
  XCircle,
} from "@phosphor-icons/react";
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
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
  Empty,
  Field,
  Input,
  Select,
  SetupCallout,
  Skeleton,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@/components/ui";
import { PlatformIcon, SectionTitle, useProject } from "@/components/common";
import { api, p } from "@/lib/api";
import { ago, cn, fmtDate, PLATFORM_LABEL, titleCase, toastError } from "@/lib/utils";
import {
  AssetThumb,
  CharCount,
  fmtTz,
  MediaPickerDialog,
  PLATFORM_LIMITS,
  PlatformToggle,
  POST_TYPES,
  postLabel,
  ScheduleDialog,
  TargetsList,
  TIKTOK_PRIVACY,
  useAssets,
  useCampaigns,
  type Post,
  type SocialPlatform,
  type Variant,
} from "@/components/content/shared";
import { PlatformPreview, type Preview } from "@/components/content/PostPreviews";
import { AssistPanel } from "@/components/content/AssistPanel";

type Form = {
  title: string;
  type: string;
  body: string;
  platforms: SocialPlatform[];
  variants: Partial<Record<SocialPlatform, Variant>>;
  hashtags: string[];
  cta: string;
  link: string;
  mediaAssetIds: string[];
  campaignId: string;
  notes: string;
};
type PostDetail = { post: Post; previews: Record<string, Preview>; approval: any; limits: typeof PLATFORM_LIMITS };
type QualityReport = { checks: { id: string; platform?: string; level: "error" | "warning" | "pass"; message: string }[]; ai: null | { score: number; onBrand: boolean; issues: string[]; suggestions: string[]; risk: string }; checkedAt: string; version: number; ok: boolean };

const LOCKED = ["scheduled", "publishing", "published", "partially_published"];

function toForm(post: Post): Form {
  return {
    title: post.title ?? "",
    type: post.type ?? "text",
    body: post.body ?? "",
    platforms: post.platforms ?? [],
    variants: (post.variants ?? {}) as Form["variants"],
    hashtags: post.hashtags ?? [],
    cta: post.cta ?? "",
    link: post.link ?? "",
    mediaAssetIds: post.mediaAssetIds ?? [],
    campaignId: post.campaignId ?? "",
    notes: post.notes ?? "",
  };
}

/** Approximate rendered length (body + CTA + tracked link on X + hashtags) — the server preview is authoritative. */
function approxLength(f: Form, platform: SocialPlatform, variantText?: string) {
  const base = (variantText?.trim() || f.body).trim();
  let n = base.length;
  if (f.cta && !base.includes(f.cta)) n += 2 + f.cta.length;
  if (f.link && platform === "x") n += 1 + 23; // X counts every URL as 23 characters
  if (f.hashtags.length && !/#\w/.test(base)) n += 2 + f.hashtags.map((h) => `#${h}`).join(" ").length;
  return n;
}

function HashtagInput({ value, onChange, disabled, max }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean; max?: number }) {
  const [draft, setDraft] = React.useState("");
  const add = (raw: string) => {
    const tags = raw
      .split(/[\s,]+/)
      .map((t) => t.replace(/^#/, "").trim())
      .filter(Boolean);
    if (!tags.length) return;
    onChange(Array.from(new Set([...value, ...tags])).slice(0, 40));
    setDraft("");
  };
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1.5 min-h-[34px]", disabled && "opacity-50")}>
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full bg-canvas border border-line px-2 py-0.5 text-[12px] text-ink-2">
          #{t}
          {!disabled && (
            <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="text-muted hover:text-ink" aria-label={`Remove ${t}`}>
              <XIcon size={10} />
            </button>
          )}
        </span>
      ))}
      <input
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "," || e.key === " ") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => add(draft)}
        placeholder={value.length ? "" : "Add hashtags — Enter to add"}
        className="flex-1 min-w-[120px] bg-transparent text-[13px] outline-none placeholder:text-faint"
      />
      {max !== undefined && <CharCount n={value.length} max={max} className="ml-auto" />}
    </div>
  );
}

function ThreadEditor({ parts, onChange, disabled }: { parts: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const move = (i: number, d: number) => {
    const next = [...parts];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {parts.map((t, i) => (
        <div key={i} className="rounded-lg border border-line bg-surface">
          <div className="flex items-center gap-1 px-2.5 py-1 border-b border-line">
            <span className="text-[11.5px] text-muted">
              {i + 1}/{parts.length}
            </span>
            <span className="flex-1" />
            <CharCount n={t.length} max={280} />
            <Button size="icon-sm" variant="ghost" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label="Move up">
              <ArrowUp size={12} />
            </Button>
            <Button size="icon-sm" variant="ghost" disabled={disabled || i === parts.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
              <ArrowDown size={12} />
            </Button>
            <Button size="icon-sm" variant="ghost" disabled={disabled} onClick={() => onChange(parts.filter((_, j) => j !== i))} aria-label="Remove part">
              <Trash size={12} />
            </Button>
          </div>
          <Textarea value={t} disabled={disabled} onChange={(e) => onChange(parts.map((x, j) => (j === i ? e.target.value : x)))} className="border-0 focus:ring-0 min-h-[64px]" />
        </div>
      ))}
      <Button size="sm" variant="secondary" disabled={disabled || parts.length >= 25} onClick={() => onChange([...parts, ""])}>
        <Plus size={12} /> Add part
      </Button>
    </div>
  );
}

export default function PostEditor() {
  const { projectId = "", postId = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: proj } = useProject(projectId);
  const project = proj?.project;
  const tz = project?.timezone ?? "UTC";
  const { data: campaigns } = useCampaigns(projectId);
  const { data: assetsData } = useAssets(projectId);
  const assetsById = React.useMemo(() => Object.fromEntries((assetsData?.assets ?? []).map((a) => [a.id, a])), [assetsData]);

  const { data, isLoading, error } = useQuery({ queryKey: ["post", projectId, postId], queryFn: () => api.get<PostDetail>(p(projectId, `/posts/${postId}`)) });
  const post = data?.post;
  const [form, setForm] = React.useState<Form | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const loadedVersion = React.useRef<string>("");
  React.useEffect(() => {
    if (!post) return;
    const key = `${post.id}:${post.version}:${post.status}`;
    if (loadedVersion.current !== key && !dirty) {
      setForm(toForm(post));
      loadedVersion.current = key;
    }
  }, [post, dirty]);

  const update = (patch: Partial<Form>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setDirty(true);
  };
  const setVariant = (pl: SocialPlatform, patch: Partial<Variant>) => {
    setForm((f) => (f ? { ...f, variants: { ...f.variants, [pl]: { ...(f.variants[pl] ?? {}), ...patch } } } : f));
    setDirty(true);
  };
  const adopt = (saved: Post) => {
    setForm(toForm(saved));
    loadedVersion.current = `${saved.id}:${saved.version}:${saved.status}`;
    setDirty(false);
  };

  const invalidate = () => ["post", "posts", "calendar", "campaign"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const save = useMutation({
    mutationFn: (f: Form) => {
      const variants: Form["variants"] = {};
      for (const [pl, v] of Object.entries(f.variants) as [SocialPlatform, Variant][]) {
        if (!v) continue;
        const thread = v.thread?.map((t) => t.trim()).filter(Boolean);
        const clean: Variant = { text: v.text ?? "" };
        if (thread?.length) clean.thread = thread;
        if (v.title) clean.title = v.title;
        if (v.privacyLevel) clean.privacyLevel = v.privacyLevel;
        if (clean.text || clean.thread || clean.title || clean.privacyLevel) variants[pl] = clean;
      }
      return api.patch<{ post: Post }>(p(projectId, `/posts/${postId}`), {
        title: f.title,
        type: f.type,
        body: f.body,
        platforms: f.platforms,
        variants,
        hashtags: f.hashtags,
        cta: f.cta,
        link: f.link.trim() || null,
        mediaAssetIds: f.mediaAssetIds,
        campaignId: f.campaignId || null,
        notes: f.notes,
      });
    },
    onSuccess: (r) => {
      adopt(r.post);
      invalidate();
      toast.success("Saved");
    },
    onError: (e) => toastError(e),
  });
  const doSave = () => form && save.mutate(form);
  const saveRef = React.useRef(doSave);
  saveRef.current = doSave;
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const setStatus = useMutation({
    mutationFn: (status: "draft" | "in_review" | "approved" | "cancelled") => api.post(p(projectId, `/posts/${postId}/status`), { status }),
    onSuccess: (_r, s) => {
      invalidate();
      toast.success(s === "in_review" ? "Sent to review" : s === "approved" ? "Approved" : s === "cancelled" ? "Post cancelled" : "Moved to draft");
      setCancelOpen(false);
    },
    onError: (e) => toastError(e),
  });
  const unschedule = useMutation({
    mutationFn: () => api.post(p(projectId, `/posts/${postId}/unschedule`)),
    onSuccess: () => {
      invalidate();
      toast.success("Unscheduled — the post is editable again");
    },
    onError: (e) => toastError(e),
  });
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [publishPlatforms, setPublishPlatforms] = React.useState<string[]>([]);
  const publishNow = useMutation({
    mutationFn: () => api.post<{ needsApproval: boolean; targets: { platform: string; status: string; lastError?: string }[] }>(p(projectId, `/posts/${postId}/publish-now`), { platforms: publishPlatforms }),
    onSuccess: (r) => {
      invalidate();
      setPublishOpen(false);
      const manual = r.targets.filter((t) => t.status === "manual");
      toast.success(manual.length ? `Publishing started — ${manual.map((t) => PLATFORM_LABEL[t.platform]).join(", ")} need a manual handoff` : "Publishing started");
    },
    onError: (e: any) => {
      toastError(e);
      if (Array.isArray(e?.details)) e.details.forEach((c: any) => c?.message && toast.error(c.message));
    },
  });
  const sendToReady = useMutation({
    mutationFn: () => api.post(p(projectId, `/posts/${postId}/send-to-ready`), { platforms: form?.platforms }),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["ready", projectId] });
      toast.success("Sent to Ready to post — download the media and post it yourself", { action: { label: "Open", onClick: () => navigate(`/projects/${projectId}/ready`) } });
    },
    onError: (e: any) => {
      toastError(e);
      if (Array.isArray(e?.details)) e.details.forEach((c: any) => c?.message && toast.error(c.message));
    },
  });
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [scheduleOpen, setScheduleOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const del = useMutation({
    mutationFn: () => api.del(p(projectId, `/posts/${postId}`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["posts"] });
      navigate(`/projects/${projectId}/content`);
      toast.success("Post deleted");
    },
    onError: (e) => toastError(e),
  });
  const duplicate = useMutation({
    mutationFn: () => api.post<{ post: Post }>(p(projectId, `/posts/${postId}/duplicate`)),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["posts"] });
      navigate(`/projects/${projectId}/content/${r.post.id}`);
      toast.success("Duplicated — editing the copy");
    },
    onError: (e) => toastError(e),
  });

  const [useAI, setUseAI] = React.useState(false);
  const [report, setReport] = React.useState<QualityReport | null>(null);
  React.useEffect(() => {
    if (post?.qualityReport) setReport(post.qualityReport as QualityReport);
  }, [post?.qualityReport]);
  const quality = useMutation({
    mutationFn: () => api.post<QualityReport>(p(projectId, `/posts/${postId}/quality`), { ai: useAI }),
    onSuccess: (r) => setReport(r),
    onError: (e) => toastError(e),
  });

  const [restoreV, setRestoreV] = React.useState<number | null>(null);
  const restore = useMutation({
    mutationFn: (version: number) => api.post<{ post: Post }>(p(projectId, `/posts/${postId}/restore`), { version }),
    onSuccess: (r) => {
      adopt(r.post);
      setRestoreV(null);
      invalidate();
      toast.success("Version restored as a new version");
    },
    onError: (e) => toastError(e),
  });

  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [variantTab, setVariantTab] = React.useState<SocialPlatform | "">("");

  if (isLoading || (!form && !error))
    return (
      <PageContainer wide>
        <Skeleton className="h-8 w-64 mb-6" />
        <div className="grid lg:grid-cols-12 gap-5">
          <Skeleton className="lg:col-span-7 h-[520px]" />
          <Skeleton className="lg:col-span-5 h-[520px]" />
        </div>
      </PageContainer>
    );
  if (error || !post || !form)
    return (
      <PageContainer>
        <Empty title="Post not found" description={(error as Error)?.message} action={<Button asChild><Link to={`/projects/${projectId}/content`}>Back to content</Link></Button>} />
      </PageContainer>
    );

  const locked = LOCKED.includes(post.status);
  const targets = post.targets ?? [];
  const activeTargets = targets.filter((t) => t.status !== "cancelled");
  const canSchedule = !["scheduled", "publishing", "published"].includes(post.status);
  const canUnschedule = ["scheduled", "in_review", "manual_handoff", "partially_published"].includes(post.status) && targets.some((t) => ["pending", "scheduled", "manual"].includes(t.status));
  const media = form.mediaAssetIds.map((id) => assetsById[id]).filter(Boolean);
  const previewMedia = post.mediaAssetIds.map((id) => assetsById[id]).filter(Boolean);
  const currentVariantTab = (variantTab && form.platforms.includes(variantTab) ? variantTab : form.platforms[0]) as SocialPlatform | undefined;
  const xVariant = form.variants.x ?? {};
  const xThread = xVariant.thread ?? [];

  return (
    <PageContainer wide>
      {/* Header */}
      <div className="flex flex-wrap items-start gap-3 mb-5">
        <Button asChild variant="ghost" size="icon" aria-label="Back to content">
          <Link to={`/projects/${projectId}/content`}>
            <ArrowLeft size={16} />
          </Link>
        </Button>
        <div className="flex-1 min-w-[240px]">
          <input
            value={form.title}
            disabled={locked}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="Untitled post"
            className="serif-title text-[30px] text-ink bg-transparent outline-none w-full placeholder:text-faint disabled:opacity-80"
          />
          <div className="flex flex-wrap items-center gap-2 mt-1 text-[12px] text-muted">
            <StatusBadge status={post.status} />
            <span>v{post.version}</span>
            <span>·</span>
            <span>Updated {ago(post.updatedAt)}</span>
            {post.scheduledAt && (
              <>
                <span>·</span>
                <span>Scheduled {fmtTz(post.scheduledAt, post.timezone || tz)} ({post.timezone || tz})</span>
              </>
            )}
            {dirty && <Badge tone="yellow">Unsaved changes</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(post.status === "draft" || post.status === "failed" || post.status === "cancelled") && (
            <Button variant="secondary" disabled={dirty} loading={setStatus.isPending && setStatus.variables === "in_review"} onClick={() => setStatus.mutate("in_review")}>
              <PaperPlaneTilt size={14} /> Send to review
            </Button>
          )}
          {(post.status === "draft" || post.status === "in_review") && !post.approvalId && (
            <Button variant="secondary" disabled={dirty} loading={setStatus.isPending && setStatus.variables === "approved"} onClick={() => setStatus.mutate("approved")}>
              <SealCheck size={14} /> Approve
            </Button>
          )}
          {canSchedule && (
            <Button variant="secondary" disabled={dirty} onClick={() => setScheduleOpen(true)}>
              <CalendarPlus size={14} /> Schedule
            </Button>
          )}
          {canUnschedule && (
            <Button variant="secondary" loading={unschedule.isPending} onClick={() => unschedule.mutate()}>
              <XCircle size={14} /> Unschedule
            </Button>
          )}
          {canSchedule && (
            <Button variant="secondary" disabled={dirty || !form.platforms.length} loading={sendToReady.isPending} onClick={() => sendToReady.mutate()}>
              <DownloadSimple size={14} /> Send to Ready to post
            </Button>
          )}
          {canSchedule && (
            <Button
              variant="secondary"
              disabled={dirty || !form.platforms.length}
              onClick={() => {
                setPublishPlatforms(post.platforms);
                setPublishOpen(true);
              }}
            >
              <PaperPlaneTilt size={14} weight="fill" /> Publish now
            </Button>
          )}
          <Button variant="primary" disabled={!dirty || locked} loading={save.isPending} onClick={doSave}>
            <FloppyDisk size={14} /> Save
          </Button>
          <DropdownMenu>
            <DropdownTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More actions">
                <DotsThree size={18} weight="bold" />
              </Button>
            </DropdownTrigger>
            <DropdownContent>
              <DropdownItem onSelect={() => duplicate.mutate()}>
                <CopySimple size={14} /> Duplicate
              </DropdownItem>
              {post.status === "in_review" && (
                <DropdownItem onSelect={() => setStatus.mutate("draft")}>
                  <ArrowLeft size={14} /> Back to draft
                </DropdownItem>
              )}
              {!["published", "publishing", "cancelled"].includes(post.status) && (
                <DropdownItem onSelect={() => setCancelOpen(true)}>
                  <XCircle size={14} /> Cancel post
                </DropdownItem>
              )}
              <DropdownSeparator />
              <DropdownItem danger onSelect={() => setDeleteOpen(true)}>
                <Trash size={14} /> Delete
              </DropdownItem>
            </DropdownContent>
          </DropdownMenu>
        </div>
      </div>

      {locked && (
        <div className="mb-4">
          <SetupCallout tone="blue" title={`This post is ${post.status.replace(/_/g, " ")} and can't be edited.`}>
            {canUnschedule ? "Unschedule it to make changes — it returns to draft and needs to be scheduled again." : "Published content is kept as-is. Duplicate it to create a new version."}
          </SetupCallout>
        </div>
      )}
      {data?.approval && (
        <div className="mb-4">
          <SetupCallout
            tone={data.approval.status === "pending" ? "yellow" : data.approval.status === "rejected" ? "red" : "blue"}
            title={
              <span className="inline-flex items-center gap-2">
                Approval: {data.approval.title} <StatusBadge status={data.approval.status} />
              </span>
            }
            action={
              <Button asChild size="sm" variant="secondary">
                <Link to={`/projects/${projectId}/approvals`}>Open approvals</Link>
              </Button>
            }
          >
            Requested by {data.approval.requestedBy} {ago(data.approval.createdAt)}
            {data.approval.decidedBy ? ` · decided by ${data.approval.decidedBy} ${ago(data.approval.decidedAt)}` : ""}. Editing the post after approval was requested invalidates it.
          </SetupCallout>
        </div>
      )}

      <div className="grid lg:grid-cols-12 gap-5 items-start">
        {/* ─────────── Left: composer ─────────── */}
        <div className="lg:col-span-7 space-y-5 min-w-0">
          <Card>
            <CardHeader title="Composer" description="Master copy used on every platform unless a variant overrides it." />
            <CardBody className="space-y-4">
              <div className="grid sm:grid-cols-[160px_1fr] gap-3">
                <Field label="Type">
                  <Select value={form.type} disabled={locked} onChange={(e) => update({ type: e.target.value })}>
                    {POST_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {titleCase(t)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Platforms">
                  <PlatformToggle value={form.platforms} disabled={locked} onChange={(v) => update({ platforms: v })} />
                </Field>
              </div>
              <Field label="Body">
                <Textarea value={form.body} disabled={locked} onChange={(e) => update({ body: e.target.value })} placeholder="Write the post…" className="min-h-[180px] text-[14px]" />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  {form.platforms.length ? (
                    form.platforms.map((pl) => (
                      <span key={pl} className="inline-flex items-center gap-1.5 text-[11.5px] text-muted">
                        <PlatformIcon platform={pl} size={11} />
                        <CharCount n={approxLength(form, pl, form.variants[pl]?.text)} max={PLATFORM_LIMITS[pl].maxChars} />
                        {form.variants[pl]?.text?.trim() ? <span className="text-faint">(variant)</span> : null}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11.5px] text-muted">{form.body.length} characters — select platforms to see limits</span>
                  )}
                  {form.platforms.length > 0 && <span className="text-[11px] text-faint">incl. CTA, hashtags{form.link ? ", link (23 on X)" : ""}</span>}
                </div>
              </Field>
              <Field label="Hashtags">
                <HashtagInput value={form.hashtags} disabled={locked} onChange={(v) => update({ hashtags: v })} max={form.platforms.length ? Math.min(...form.platforms.map((pl) => PLATFORM_LIMITS[pl].maxHashtags)) : undefined} />
              </Field>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Call to action">
                  <Input value={form.cta} disabled={locked} onChange={(e) => update({ cta: e.target.value })} placeholder="e.g. Start your free trial" />
                </Field>
                <Field label="Link" hint="UTM tags (source, medium, campaign, content) are added automatically at publish time.">
                  <div className="relative">
                    <LinkSimple size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                    <Input value={form.link} disabled={locked} onChange={(e) => update({ link: e.target.value })} placeholder="https://…" className="pl-7" />
                  </div>
                </Field>
              </div>
            </CardBody>
          </Card>

          {/* Variants */}
          <Card>
            <CardHeader title="Platform variants" description="Optional per-platform overrides." />
            <CardBody>
              {!form.platforms.length ? (
                <p className="text-[12.5px] text-muted">Select platforms above to customize their versions.</p>
              ) : (
                <>
                  <div className="flex gap-1 border-b border-line mb-4">
                    {form.platforms.map((pl) => (
                      <button
                        key={pl}
                        type="button"
                        onClick={() => setVariantTab(pl)}
                        className={cn("inline-flex items-center gap-1.5 px-3 py-2 -mb-px text-[13px] border-b-2", currentVariantTab === pl ? "border-ink text-ink font-medium" : "border-transparent text-muted hover:text-ink")}
                      >
                        <PlatformIcon platform={pl} size={13} /> {PLATFORM_LABEL[pl]}
                      </button>
                    ))}
                  </div>
                  {currentVariantTab === "x" && (
                    <div className="space-y-4">
                      <Field label="X text" hint="Leave empty to use the master body. Links count as 23 characters.">
                        <Textarea value={xVariant.text ?? ""} disabled={locked} onChange={(e) => setVariant("x", { text: e.target.value })} placeholder={form.body || "X-specific version"} className="min-h-[90px]" />
                        <CharCount n={approxLength(form, "x", xVariant.text)} max={280} />
                      </Field>
                      <div>
                        <SectionTitle>Thread {xThread.length ? `(${xThread.length} parts)` : ""}</SectionTitle>
                        {xThread.length === 0 && <p className="text-[12.5px] text-muted mb-2">A thread replaces the single post on X. The tracked link is appended to the last part.</p>}
                        <ThreadEditor parts={xThread} disabled={locked} onChange={(parts) => setVariant("x", { thread: parts })} />
                      </div>
                    </div>
                  )}
                  {currentVariantTab === "instagram" && (
                    <div className="space-y-3">
                      <p className="text-[12.5px] text-muted flex items-start gap-1.5">
                        <Info size={14} className="mt-0.5 shrink-0" /> Instagram uses the master body as caption. Links in captions aren't clickable — mention "link in bio".
                      </p>
                      {form.variants.instagram?.text ? (
                        <Field label="Instagram caption override">
                          <Textarea value={form.variants.instagram.text} disabled={locked} onChange={(e) => setVariant("instagram", { text: e.target.value })} className="min-h-[90px]" />
                          <div className="flex items-center gap-2">
                            <CharCount n={approxLength(form, "instagram", form.variants.instagram.text)} max={2200} />
                            <Button size="sm" variant="ghost" disabled={locked} onClick={() => setVariant("instagram", { text: "" })}>
                              Use master instead
                            </Button>
                          </div>
                        </Field>
                      ) : null}
                    </div>
                  )}
                  {currentVariantTab === "tiktok" && (
                    <div className="space-y-4">
                      <Field label="Privacy level" hint="Must be one of the options your TikTok account allows; unaudited apps can only post privately (SELF_ONLY).">
                        <Select value={form.variants.tiktok?.privacyLevel ?? ""} disabled={locked} onChange={(e) => setVariant("tiktok", { privacyLevel: e.target.value || undefined })}>
                          <option value="">Default (integration setting)</option>
                          {TIKTOK_PRIVACY.map((x) => (
                            <option key={x} value={x}>
                              {x}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="TikTok caption override" hint="Leave empty to use the master body.">
                        <Textarea value={form.variants.tiktok?.text ?? ""} disabled={locked} onChange={(e) => setVariant("tiktok", { text: e.target.value })} placeholder={form.body} className="min-h-[80px]" />
                        <CharCount n={approxLength(form, "tiktok", form.variants.tiktok?.text)} max={2200} />
                      </Field>
                    </div>
                  )}
                </>
              )}
            </CardBody>
          </Card>

          {/* Media */}
          <Card>
            <CardHeader
              title="Media"
              description={form.platforms.length ? form.platforms.map((pl) => `${PLATFORM_LABEL[pl]} ≤ ${PLATFORM_LIMITS[pl].maxImages} images`).join(" · ") : "Images and videos from the media library."}
              action={
                <Button size="sm" variant="secondary" disabled={locked} onClick={() => setPickerOpen(true)}>
                  <Images size={13} /> Choose media
                </Button>
              }
            />
            <CardBody>
              {!form.mediaAssetIds.length ? (
                <p className="text-[12.5px] text-muted">No media attached. Instagram and TikTok require an image or video.</p>
              ) : (
                <div className="flex flex-wrap gap-2.5">
                  {form.mediaAssetIds.map((id, i) => {
                    const a = assetsById[id];
                    return (
                      <div key={id} className="w-[120px] rounded-lg border border-line overflow-hidden bg-surface">
                        {a ? <AssetThumb projectId={projectId} asset={a} className="aspect-square" /> : <div className="aspect-square bg-canvas flex items-center justify-center text-[11px] text-muted">Unavailable</div>}
                        <div className="flex items-center gap-0.5 px-1 py-1">
                          <span className="text-[11px] text-muted px-1 tabular-nums">{i + 1}</span>
                          <span className="text-[11px] truncate flex-1" title={a?.name}>
                            {a?.name ?? id}
                          </span>
                        </div>
                        <div className="flex items-center justify-between border-t border-line px-1 py-0.5">
                          <Button size="icon-sm" variant="ghost" disabled={locked || i === 0} aria-label="Move left" onClick={() => { const n = [...form.mediaAssetIds]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; update({ mediaAssetIds: n }); }}>
                            <ArrowLeft size={12} />
                          </Button>
                          <Button size="icon-sm" variant="ghost" disabled={locked} aria-label="Remove" onClick={() => update({ mediaAssetIds: form.mediaAssetIds.filter((x) => x !== id) })}>
                            <Trash size={12} />
                          </Button>
                          <Button size="icon-sm" variant="ghost" disabled={locked || i === form.mediaAssetIds.length - 1} aria-label="Move right" onClick={() => { const n = [...form.mediaAssetIds]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; update({ mediaAssetIds: n }); }}>
                            <ArrowRight size={12} />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {media.some((a) => a.status !== "ready") && <p className="text-[12px] text-yellow-fg mt-2">Some media is still processing or failed — it must be ready before scheduling.</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Details" />
            <CardBody className="grid sm:grid-cols-2 gap-3">
              <Field label="Campaign">
                <Select value={form.campaignId} disabled={locked} onChange={(e) => update({ campaignId: e.target.value })}>
                  <option value="">No campaign</option>
                  {campaigns?.campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div />
              <Field label="Internal notes" className="sm:col-span-2">
                <Textarea value={form.notes} disabled={locked} onChange={(e) => update({ notes: e.target.value })} placeholder="Context for reviewers — never published" className="min-h-[64px]" />
              </Field>
            </CardBody>
          </Card>
        </div>

        {/* ─────────── Right: publishing + tools ─────────── */}
        <div className="lg:col-span-5 space-y-5 min-w-0 lg:sticky lg:top-4">
          <Card>
            <CardHeader title="Publishing" description={activeTargets.length ? `Times shown in ${post.timezone || tz}` : undefined} />
            <CardBody>
              <TargetsList projectId={projectId} targets={activeTargets} tz={post.timezone || tz} />
              {targets.length > activeTargets.length && <p className="text-[11.5px] text-faint mt-2">{targets.length - activeTargets.length} cancelled target(s) hidden.</p>}
            </CardBody>
          </Card>

          <Card>
            <Tabs defaultValue="preview">
              <div className="px-4 pt-2">
                <TabsList className="mb-0">
                  <TabsTrigger value="preview">Preview</TabsTrigger>
                  <TabsTrigger value="assist">AI assist</TabsTrigger>
                  <TabsTrigger value="quality">Quality</TabsTrigger>
                  <TabsTrigger value="history">History</TabsTrigger>
                </TabsList>
              </div>
              <div className="p-4 max-h-[calc(100vh-260px)] overflow-y-auto scrollbar-thin">
                <TabsContent value="preview" className="space-y-5">
                  {dirty && <p className="text-[12px] text-yellow-fg">Previews show the last saved version — save to refresh them.</p>}
                  {!post.platforms.length ? (
                    <Empty title="No platforms selected" description="Pick platforms and save to see the exact text that will be published." className="py-8" />
                  ) : (
                    post.platforms.map((pl) =>
                      data?.previews?.[pl] ? (
                        <PlatformPreview key={pl} platform={pl} projectId={projectId} preview={data.previews[pl]} media={previewMedia} name={project?.name ?? "Brand"} logoUrl={project?.logoUrl} />
                      ) : null,
                    )
                  )}
                </TabsContent>
                <TabsContent value="assist">
                  <AssistPanel
                    projectId={projectId}
                    sourceText={form.body}
                    platforms={form.platforms}
                    disabled={locked}
                    apply={{
                      body: (t) => update({ body: t }),
                      prependHook: (t) => update({ body: `${t}\n\n${form.body}`.trim() }),
                      hashtags: (tags) => update({ hashtags: Array.from(new Set([...form.hashtags, ...tags])).slice(0, 40) }),
                      cta: (t) => update({ cta: t }),
                      variant: (pl, t) => {
                        if (!form.platforms.includes(pl)) update({ platforms: [...form.platforms, pl] });
                        setVariant(pl, { text: t });
                        setVariantTab(pl);
                        toast.success(`Applied to ${PLATFORM_LABEL[pl]} variant`);
                      },
                      thread: (parts) => {
                        setVariant("x", { thread: parts });
                        if (!form.platforms.includes("x")) update({ platforms: [...form.platforms, "x"] });
                        setVariantTab("x");
                        toast.success("Thread applied to X");
                      },
                      appendThreadPart: (t) => {
                        setVariant("x", { thread: [...(form.variants.x?.thread ?? []), t] });
                        setVariantTab("x");
                      },
                    }}
                  />
                </TabsContent>
                <TabsContent value="quality" className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="primary" size="sm" loading={quality.isPending} onClick={() => quality.mutate()}>
                      <CheckCircle size={13} weight="bold" /> Run quality check
                    </Button>
                    <Checkbox checked={useAI} onCheckedChange={setUseAI} label="Include AI brand review" />
                  </div>
                  {dirty && <p className="text-[12px] text-yellow-fg">The check runs on the saved version — save first.</p>}
                  {report ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-[12px] text-muted">
                        <Badge tone={report.ok ? "green" : "red"}>{report.ok ? "Ready to schedule" : "Has errors"}</Badge>
                        Checked {ago(report.checkedAt)} on v{report.version}
                        {report.version !== post.version && <span className="text-yellow-fg">(outdated)</span>}
                      </div>
                      <ul className="space-y-1.5">
                        {report.checks.map((c) => (
                          <li key={c.id} className="flex items-start gap-2 text-[12.5px]">
                            {c.level === "error" ? <XCircle size={15} weight="fill" className="text-red-fg mt-0.5 shrink-0" /> : c.level === "warning" ? <Warning size={15} weight="fill" className="text-yellow-fg mt-0.5 shrink-0" /> : <CheckCircle size={15} weight="fill" className="text-green-fg mt-0.5 shrink-0" />}
                            <span className="text-ink-2">{c.message}</span>
                          </li>
                        ))}
                      </ul>
                      {report.ai ? (
                        <div className="rounded-lg border border-line bg-subtle p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] uppercase tracking-[0.08em] text-muted font-medium">AI review</span>
                            <Badge tone="purple">AI opinion</Badge>
                            <span className="flex-1" />
                            <span className="text-[13px] font-semibold text-ink tabular-nums">{report.ai.score}/10</span>
                          </div>
                          <div className="flex gap-2">
                            <Badge tone={report.ai.onBrand ? "green" : "yellow"}>{report.ai.onBrand ? "On brand" : "Off brand"}</Badge>
                            <Badge tone={report.ai.risk === "high" ? "red" : report.ai.risk === "medium" ? "yellow" : "green"}>{report.ai.risk} risk</Badge>
                          </div>
                          {report.ai.issues.length > 0 && (
                            <div>
                              <p className="text-[12px] font-medium text-ink mb-1">Issues</p>
                              <ul className="list-disc pl-4 text-[12.5px] text-ink-2 space-y-0.5">
                                {report.ai.issues.map((x, i) => (
                                  <li key={i}>{x}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {report.ai.suggestions.length > 0 && (
                            <div>
                              <p className="text-[12px] font-medium text-ink mb-1">Suggestions</p>
                              <ul className="list-disc pl-4 text-[12.5px] text-ink-2 space-y-0.5">
                                {report.ai.suggestions.map((x, i) => (
                                  <li key={i}>{x}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      ) : useAI && report.checkedAt && !quality.isPending ? (
                        <p className="text-[12px] text-muted">
                          No AI review returned — a text AI provider may not be configured. <Link to="/settings" className="underline underline-offset-2">Settings</Link>
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-[12.5px] text-muted">Checks length limits, hashtags, required media, platform support, blocked words and calls to action.</p>
                  )}
                </TabsContent>
                <TabsContent value="history">
                  {!post.versions?.length ? (
                    <p className="text-[12.5px] text-muted">No versions yet.</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {post.versions.map((v) => (
                        <li key={v.id} className="py-2.5 flex items-start gap-3">
                          <ClockCounterClockwise size={15} className="text-muted mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] text-ink">
                              Version {v.version} {v.version === post.version && <Badge tone="ink">current</Badge>}
                            </div>
                            <div className="text-[12px] text-muted">
                              {v.createdBy} · {fmtDate(v.createdAt)}
                            </div>
                            <p className="text-[12px] text-ink-2 truncate mt-0.5">{postLabel({ title: v.snapshot?.title ?? "", body: v.snapshot?.body ?? "" })}</p>
                          </div>
                          {v.version !== post.version && (
                            <Button size="sm" variant="secondary" disabled={locked} onClick={() => setRestoreV(v.version)}>
                              Restore
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>
              </div>
            </Tabs>
          </Card>
        </div>
      </div>

      <MediaPickerDialog projectId={projectId} open={pickerOpen} onOpenChange={setPickerOpen} initial={form.mediaAssetIds} onPick={(ids) => update({ mediaAssetIds: ids })} />
      <ScheduleDialog projectId={projectId} post={post} defaultTz={tz} open={scheduleOpen} onOpenChange={setScheduleOpen} />
      <ConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title="Publish now?"
        description="The post goes out immediately on the selected platforms after passing the quality check. Platforms that aren't connected or don't support this post type become manual handoffs."
        confirmLabel="Publish now"
        loading={publishNow.isPending}
        onConfirm={() => publishNow.mutate()}
      >
        <div className="flex flex-wrap gap-3">
          {post.platforms.map((pl) => (
            <Checkbox
              key={pl}
              checked={publishPlatforms.includes(pl)}
              onCheckedChange={(v) => setPublishPlatforms((s) => (v ? [...s, pl] : s.filter((x) => x !== pl)))}
              label={
                <span className="inline-flex items-center gap-1.5">
                  <PlatformIcon platform={pl} size={13} /> {PLATFORM_LABEL[pl]}
                </span>
              }
            />
          ))}
        </div>
        <p className="text-[12px] text-muted mt-3">You're publishing as yourself, so no approval is required. Agent-initiated publishing follows the project's approval policy.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this post?"
        description="Pending, scheduled and manual targets are cancelled. You can move it back to draft later."
        confirmLabel="Cancel post"
        danger
        loading={setStatus.isPending}
        onConfirm={() => setStatus.mutate("cancelled")}
      />
      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete this post?" description="The post and its version history are removed permanently." confirmLabel="Delete" danger loading={del.isPending} onConfirm={() => del.mutate()} />
      <ConfirmDialog
        open={restoreV !== null}
        onOpenChange={(v) => !v && setRestoreV(null)}
        title={`Restore version ${restoreV}?`}
        description={dirty ? "Your unsaved changes will be discarded. The restored content is saved as a new version." : "The restored content is saved as a new version; nothing is lost."}
        confirmLabel="Restore"
        loading={restore.isPending}
        onConfirm={() => { if (restoreV !== null) restore.mutate(restoreV); }}
      />
    </PageContainer>
  );
}
