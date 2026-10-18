import * as React from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crop, DownloadSimple, Eye, Folder, FolderOpen, GitDiff, ImageSquare, MagnifyingGlass, Robot, Sparkle, UploadSimple, VideoCamera } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Badge, Button, Empty, Input, Select, SetupCallout, Skeleton, StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { CommandBar, SectionTitle, useProject } from "@/components/common";
import { api, ApiError, assetUrl, p } from "@/lib/api";
import { ago, cn, fmtBytes, titleCase, toastError } from "@/lib/utils";
import { AssetThumb, useAssets, useCampaigns, useJobWatcher, type Asset } from "@/components/content/shared";
import { AssetStage, CompareView, CropBox, fmtSec, VideoTimeline } from "@/components/workspace/Canvas";
import { GenerateDialog, HistoryPanel, ImageEditPanel, PropertiesPanel, VideoEditPanel } from "@/components/workspace/Panels";

const KINDS = [
  ["", "All"],
  ["image", "Images"],
  ["video", "Videos"],
  ["document", "Docs"],
  ["audio", "Audio"],
] as const;

const JOB_LABEL: Record<string, string> = {
  "media.imageOp": "Edit",
  "media.videoOp": "Video edit",
  "media.generateImage": "Image generation",
  "media.generateVideo": "Video generation",
};

export default function Workspace() {
  const { projectId = "" } = useParams();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data: proj } = useProject(projectId);
  const project = proj?.project;
  const imageAI = !!proj?.readiness?.ai?.image;
  const videoAI = !!proj?.readiness?.ai?.video;

  // ───── Library filters ─────
  const [kind, setKind] = React.useState("");
  const [folder, setFolder] = React.useState("");
  const [campaignId, setCampaignId] = React.useState(params.get("campaign") ?? "");
  const [search, setSearch] = React.useState("");
  const [q, setQ] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const { data: lib, isLoading: libLoading } = useAssets(projectId, { kind, folder, campaignId, q });
  const assets = lib?.assets ?? [];
  const folders = (lib?.folders ?? []).sort((a, b) => a.folder.localeCompare(b.folder));
  const { data: camps } = useCampaigns(projectId);
  const campaigns = camps?.campaigns ?? [];
  const { data: tasks } = useQuery({ queryKey: ["tasks", projectId, "recent"], queryFn: () => api.get<{ tasks: any[] }>(p(projectId, "/tasks?limit=8")) });

  // ───── Selection ─────
  const selectedId = params.get("asset") ?? "";
  const [multi, setMulti] = React.useState<string[]>([]);
  const select = (id: string, additive: boolean) => {
    if (additive) {
      setMulti((m) => {
        const base = m.length ? m : selectedId ? [selectedId] : [];
        return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
      });
      if (!selectedId) setParam("asset", id);
      return;
    }
    setMulti([]);
    setParam("asset", id);
  };
  function setParam(k: string, v: string | null) {
    setParams(
      (cur) => {
        const n = new URLSearchParams(cur);
        if (v) n.set(k, v);
        else n.delete(k);
        return n;
      },
      { replace: true },
    );
  }
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["asset", projectId, selectedId],
    queryFn: () => api.get<{ asset: Asset; usedIn: { id: string; title: string; status: string }[] }>(p(projectId, `/assets/${selectedId}`)),
    enabled: !!selectedId,
    refetchInterval: (query) => (query.state.data?.asset.status === "processing" ? 15_000 : false),
  });
  const asset = detail?.asset;
  const busy = asset?.status === "processing";
  const selectionIds = multi.length ? multi : selectedId ? [selectedId] : [];
  const assetIndex = React.useMemo(() => Object.fromEntries(assets.map((a) => [a.id, a])), [assets]);
  const attachments = selectionIds.map((id) => ({ id, name: assetIndex[id]?.name ?? (id === asset?.id ? asset.name : id) }));
  const concatCandidates = React.useMemo(() => selectionIds.filter((id) => id !== selectedId).map((id) => assetIndex[id]).filter((a) => a && a.kind === "video" && a.status === "ready"), [selectionIds.join("|"), selectedId, assetIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // ───── Jobs & ops ─────
  const jobs = useJobWatcher((_id, ok, err, name) => {
    qc.invalidateQueries({ queryKey: ["asset"] });
    qc.invalidateQueries({ queryKey: ["assets"] });
    const label = (name && JOB_LABEL[name]) || "Job";
    if (ok) toast.success(`${label} finished`);
    else toast.error(`${label} failed${err ? `: ${err}` : ""}`);
  });
  const onOpError = (e: unknown) => {
    if (e instanceof ApiError && e.code === "asset_busy") toast.warning("This asset is still processing a previous edit — try again when it finishes.");
    else toastError(e);
  };
  const imageOp = useMutation({
    mutationFn: (op: Record<string, unknown>) => api.post<{ jobId: string }>(p(projectId, `/assets/${selectedId}/image-op`), op),
    onSuccess: (r, op) => {
      jobs.track(r.jobId, String(op.op));
      qc.invalidateQueries({ queryKey: ["asset", projectId, selectedId] });
      qc.invalidateQueries({ queryKey: ["assets"] });
      toast(op.op === "variations" ? "Generating variations — they'll appear as new assets" : `Applying ${titleCase(String(op.op))}…`);
      setMode("view");
    },
    onError: onOpError,
  });
  const videoOp = useMutation({
    mutationFn: (op: Record<string, unknown>) => api.post<{ jobId: string }>(p(projectId, `/assets/${selectedId}/video-op`), op),
    onSuccess: (r, op) => {
      jobs.track(r.jobId, String(op.op));
      qc.invalidateQueries({ queryKey: ["asset", projectId, selectedId] });
      qc.invalidateQueries({ queryKey: ["assets"] });
      toast(op.op === "concat" || op.op === "thumbnail" ? `${titleCase(String(op.op))} started — the result is saved as a new asset` : `Applying ${titleCase(String(op.op))}…`);
    },
    onError: onOpError,
  });
  const opPending = imageOp.isPending || videoOp.isPending;

  // ───── Canvas state ─────
  const [mode, setMode] = React.useState<"view" | "crop" | "compare">("view");
  const [compareId, setCompareId] = React.useState("");
  const [range, setRange] = React.useState<[number, number]>([0, 0]);
  const [videoTime, setVideoTime] = React.useState(0);
  React.useEffect(() => {
    setMode("view");
    setVideoTime(0);
    const d = asset?.versions.find((v) => v.id === asset.currentVersionId)?.durationSec ?? 0;
    setRange([0, d]);
    setCompareId(asset?.versions.find((v) => v.id !== asset.currentVersionId)?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.id, asset?.currentVersionId]);

  // ───── Generation & upload ─────
  const promptParam = params.get("prompt") ?? "";
  const [genOpen, setGenOpen] = React.useState(!!promptParam);
  const [genTab, setGenTab] = React.useState<"image" | "video">("image");
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(0);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(files.length);
    let last: string | null = null;
    for (const file of Array.from(files)) {
      const form = new FormData();
      // Fields must precede the file part so the server sees them.
      form.append("folder", folder || "/");
      if (campaignId) form.append("campaignId", campaignId);
      form.append("file", file);
      try {
        const r = await api.upload<{ asset: Asset }>(p(projectId, "/assets/upload"), form);
        last = r.asset.id;
      } catch (e) {
        toastError(e);
      }
      setUploading((n) => n - 1);
    }
    qc.invalidateQueries({ queryKey: ["assets"] });
    if (last) {
      toast.success("Uploaded");
      select(last, false);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const cur = asset?.versions.find((v) => v.id === asset.currentVersionId);
  const brand = (project?.brand ?? {}) as { colors?: string[]; fonts?: string[]; voice?: string; tone?: string[]; guidelines?: string; doNotSay?: string[] };
  const aiConfig = (project?.aiConfig ?? {}) as Record<string, string | null>;

  return (
    <div className="flex flex-col xl:h-full min-h-0">
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_300px]">
        {/* ─────────── Left: library ─────────── */}
        <aside className="border-b md:border-b-0 md:border-r border-line bg-subtle min-h-0 flex flex-col">
          <div className="p-3 space-y-2 border-b border-line">
            <div className="grid grid-cols-3 gap-1.5">
              <Button
                variant="primary"
                size="sm"
                className="col-span-3"
                onClick={() => {
                  setGenTab("image");
                  setGenOpen(true);
                }}
              >
                <Sparkle size={13} weight="fill" /> Generate
              </Button>
              <Button variant="secondary" size="sm" className="col-span-2" loading={uploading > 0} onClick={() => fileRef.current?.click()}>
                <UploadSimple size={13} /> Upload
              </Button>
              <Button
                variant="secondary"
                size="sm"
                title="New text file in the shared AI workspace"
                onClick={async () => {
                  const name = window.prompt("New file name (saved under /workspace)", "notes.md");
                  if (!name) return;
                  try {
                    const r = await api.put<{ assetId: string }>(p(projectId, "/files"), { path: name, content: "" });
                    setParam("asset", r.assetId);
                  } catch (e) {
                    toastError(e);
                  }
                }}
              >
                + File
              </Button>
              <input ref={fileRef} type="file" multiple hidden accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,.txt,.md,.json,.srt" onChange={(e) => void upload(e.target.files)} />
            </div>
            <div className="relative">
              <MagnifyingGlass size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search assets" className="pl-7 h-8" />
            </div>
            <div className="flex flex-wrap gap-1">
              {KINDS.map(([k, l]) => (
                <button key={k} onClick={() => setKind(k)} className={cn("px-2 h-6 rounded-full text-[11.5px] border", kind === k ? "bg-ink text-white border-ink" : "bg-surface border-line text-ink-2 hover:border-line-strong")}>
                  {l}
                </button>
              ))}
            </div>
            <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="h-8 text-[12.5px]">
              <option value="">All campaigns</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-3 space-y-4 max-h-[60vh] lg:max-h-none">
            <div>
              <SectionTitle>Folders</SectionTitle>
              <div className="space-y-px">
                <button onClick={() => setFolder("")} className={cn("w-full flex items-center gap-2 rounded-md px-2 py-1 text-[12.5px]", !folder ? "bg-black/[0.055] text-ink font-medium" : "text-ink-2 hover:bg-black/[0.035]")}>
                  <FolderOpen size={14} /> All folders
                </button>
                {folders.map((f) => (
                  <button key={f.folder} onClick={() => setFolder(f.folder)} className={cn("w-full flex items-center gap-2 rounded-md px-2 py-1 text-[12.5px]", folder === f.folder ? "bg-black/[0.055] text-ink font-medium" : "text-ink-2 hover:bg-black/[0.035]")}>
                    <Folder size={14} /> <span className="truncate flex-1 text-left">{f.folder}</span>
                    <span className="text-[11px] text-muted tabular-nums">{f.count}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <SectionTitle action={multi.length > 1 ? <button className="text-[11px] text-muted hover:text-ink" onClick={() => setMulti([])}>Clear {multi.length}</button> : undefined}>Media</SectionTitle>
              {libLoading ? (
                <div className="grid grid-cols-2 gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="aspect-square" />
                  ))}
                </div>
              ) : !assets.length ? (
                <p className="text-[12px] text-muted">No assets here yet. Upload or generate one.</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 lg:grid-cols-2 gap-2">
                    {assets.map((a) => {
                      const active = a.id === selectedId;
                      const inMulti = selectionIds.includes(a.id);
                      return (
                        <button
                          key={a.id}
                          onClick={(e) => select(a.id, e.ctrlKey || e.metaKey || e.shiftKey)}
                          className={cn("relative rounded-lg border bg-surface overflow-hidden text-left transition-colors", active ? "border-ink ring-2 ring-ink/15" : inMulti ? "border-ink/50" : "border-line hover:border-line-strong")}
                          title={a.name}
                        >
                          <AssetThumb projectId={projectId} asset={a} className="aspect-square" />
                          <div className="px-1.5 py-1 text-[11px] text-ink-2 truncate">{a.name}</div>
                          {inMulti && selectionIds.length > 1 && <span className="absolute top-1 left-1 h-4 min-w-4 px-1 rounded-full bg-ink text-white text-[10px] flex items-center justify-center">{selectionIds.indexOf(a.id) + 1}</span>}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-faint mt-2">Ctrl/⌘-click to select several (for the AI or concatenation).</p>
                </>
              )}
            </div>
            <div>
              <SectionTitle>Recent tasks</SectionTitle>
              {!tasks?.tasks.length ? (
                <p className="text-[12px] text-muted">No agent tasks yet.</p>
              ) : (
                <ul className="space-y-1">
                  {tasks.tasks.map((t) => (
                    <li key={t.id}>
                      <Link to={`/projects/${projectId}/agents?task=${t.id}`} className="flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-black/[0.035]">
                        <Robot size={13} className="text-muted mt-0.5 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12px] text-ink-2 truncate">{t.title || t.instruction}</span>
                          <span className="block text-[10.5px] text-faint">
                            {t.status.replace(/_/g, " ")} · {ago(t.createdAt)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </aside>

        {/* ─────────── Center: canvas ─────────── */}
        <section className="min-h-[420px] lg:min-h-0 flex flex-col bg-canvas">
          {asset ? (
            <div className="flex flex-wrap items-center gap-2 px-4 h-11 border-b border-line bg-surface shrink-0">
              <span className="text-[13px] font-medium text-ink truncate max-w-[260px]">{asset.name}</span>
              <StatusBadge status={asset.status} />
              {cur && (
                <span className="text-[11.5px] text-muted tabular-nums hidden md:inline">
                  v{cur.version}
                  {cur.width && cur.height ? ` · ${cur.width}×${cur.height}` : ""}
                  {cur.durationSec ? ` · ${fmtSec(cur.durationSec)}` : ""} · {fmtBytes(cur.sizeBytes)} · {cur.mimeType}
                </span>
              )}
              <span className="flex-1" />
              {asset.kind === "image" && asset.currentVersionId && (
                <Button size="sm" variant={mode === "crop" ? "primary" : "ghost"} disabled={busy} onClick={() => setMode(mode === "crop" ? "view" : "crop")}>
                  <Crop size={13} /> Crop
                </Button>
              )}
              {asset.versions.length > 1 && (
                <Button size="sm" variant={mode === "compare" ? "primary" : "ghost"} onClick={() => setMode(mode === "compare" ? "view" : "compare")}>
                  <GitDiff size={13} /> Compare
                </Button>
              )}
              {mode !== "view" && (
                <Button size="sm" variant="ghost" onClick={() => setMode("view")}>
                  <Eye size={13} /> View
                </Button>
              )}
              {asset.currentVersionId && (
                <Button asChild size="sm" variant="secondary">
                  <a href={assetUrl(projectId, asset.id, asset.currentVersionId, true)}>
                    <DownloadSimple size={13} /> Export
                  </a>
                </Button>
              )}
            </div>
          ) : null}
          <div className="flex-1 min-h-0 relative">
            {!selectedId ? (
              <div className="h-full flex items-center justify-center">
                <Empty
                  icon={<ImageSquare size={18} />}
                  title="Select an asset to start editing"
                  description="Pick something from the library, upload a file, or generate a new image or video."
                  action={
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" onClick={() => { setGenTab("image"); setGenOpen(true); }}>
                        <Sparkle size={13} weight="fill" /> Generate image
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => { setGenTab("video"); setGenOpen(true); }}>
                        <VideoCamera size={13} /> Generate video
                      </Button>
                    </div>
                  }
                />
              </div>
            ) : detailLoading || !asset ? (
              <div className="p-6 h-full">
                <Skeleton className="h-full min-h-[300px]" />
              </div>
            ) : mode === "crop" && asset.kind === "image" && asset.currentVersionId ? (
              <CropBox src={assetUrl(projectId, asset.id, asset.currentVersionId)} busy={imageOp.isPending} onCancel={() => setMode("view")} onApply={(r) => imageOp.mutate({ op: "crop", ...r })} />
            ) : mode === "compare" ? (
              <CompareView projectId={projectId} asset={asset} versions={asset.versions} compareId={compareId} onCompareId={setCompareId} />
            ) : asset.kind === "video" && asset.currentVersionId ? (
              <VideoTimeline
                key={asset.currentVersionId}
                src={assetUrl(projectId, asset.id, asset.currentVersionId)}
                duration={cur?.durationSec}
                range={range}
                onRange={setRange}
                onTime={setVideoTime}
                busy={videoOp.isPending}
                onTrim={() => videoOp.mutate({ op: "trim", start: Math.round(range[0] * 10) / 10, end: Math.round(range[1] * 10) / 10 })}
              />
            ) : (
              <AssetStage projectId={projectId} asset={asset} />
            )}
            {asset && busy && asset.currentVersionId && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full border border-line bg-surface px-3 py-1 text-[12px] text-ink-2 shadow-pop flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-blue-fg animate-pulse-soft" /> Processing — controls are disabled until it finishes
              </div>
            )}
            {asset?.status === "failed" && asset.currentVersionId && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 max-w-md rounded-lg border border-[#f3cfd1] bg-red-bg px-3 py-1.5 text-[12px] text-red-fg">Last operation failed{asset.error ? `: ${asset.error}` : ""}</div>
            )}
          </div>
          {/* Command bar */}
          <div className="shrink-0 border-t border-line bg-canvas p-3 space-y-2">
            {proj && !imageAI && (
              <SetupCallout
                title="No image AI key configured"
                action={
                  <Button asChild size="sm" variant="secondary">
                    <Link to="/settings">Add a key</Link>
                  </Button>
                }
              >
                The image agent can still crop, resize and brand assets; AI edits and generation need a ByteDance (BytePlus), OpenAI, Replicate or Stability key.
              </SetupCallout>
            )}
            <CommandBar
              projectId={projectId}
              defaultAgent="image_editing"
              compact
              attachments={attachments}
              onClearAttachment={(id) => {
                if (multi.length) setMulti((m) => m.filter((x) => x !== id));
                else setParam("asset", null);
              }}
              placeholder={attachments.length ? "Tell the AI what to do with the selected assets — e.g. “make an Instagram portrait version with our logo bottom-right”" : "Ask the image or video agent — e.g. “create 3 launch visuals in our brand colors”"}
            />
          </div>
        </section>

        {/* ─────────── Right: properties & controls ─────────── */}
        <aside className="border-t xl:border-t-0 xl:border-l border-line bg-surface min-h-0 overflow-y-auto scrollbar-thin md:col-span-2 xl:col-span-1">
          {!asset ? (
            <div className="p-4 space-y-5">
              <BrandSummary projectId={projectId} brand={brand} />
              <ModelSettings projectId={projectId} aiConfig={aiConfig} imageAI={imageAI} videoAI={videoAI} />
              {Object.keys(jobs.pending).length > 0 && <p className="text-[12px] text-muted">{Object.keys(jobs.pending).length} job(s) running…</p>}
            </div>
          ) : (
            <Tabs defaultValue="edit" key={asset.id}>
              <div className="px-4 pt-2 sticky top-0 bg-surface z-10">
                <TabsList className="mb-0">
                  <TabsTrigger value="edit">Edit</TabsTrigger>
                  <TabsTrigger value="props">Properties</TabsTrigger>
                  <TabsTrigger value="history">
                    History <Badge className="ml-1">{asset.versions.length}</Badge>
                  </TabsTrigger>
                </TabsList>
              </div>
              <div className="px-4 pb-6">
                <TabsContent value="edit">
                  {!asset.currentVersionId ? (
                    <p className="text-[12.5px] text-muted py-4">{asset.status === "failed" ? "Generation failed — nothing to edit." : "Waiting for the file to be generated…"}</p>
                  ) : asset.kind === "image" ? (
                    <ImageEditPanel projectId={projectId} asset={asset} run={(op) => imageOp.mutate(op)} busy={busy || opPending} imageAI={imageAI} brandColors={brand.colors ?? []} />
                  ) : asset.kind === "video" ? (
                    <VideoEditPanel projectId={projectId} asset={asset} run={(op) => videoOp.mutate(op)} busy={busy || opPending} range={range} currentTime={videoTime} concatCandidates={concatCandidates as Asset[]} />
                  ) : (
                    <p className="text-[12.5px] text-muted py-4">No editing tools for {asset.kind} files. You can rename, move, tag or download it.</p>
                  )}
                  <div className="pt-4 space-y-5">
                    <ModelSettings projectId={projectId} aiConfig={aiConfig} imageAI={imageAI} videoAI={videoAI} />
                    <BrandSummary projectId={projectId} brand={brand} />
                  </div>
                </TabsContent>
                <TabsContent value="props">
                  <PropertiesPanel projectId={projectId} asset={asset} campaigns={campaigns} folders={folders.map((f) => f.folder)} usedIn={detail?.usedIn ?? []} onDeleted={() => setParam("asset", null)} />
                </TabsContent>
                <TabsContent value="history">
                  <HistoryPanel
                    projectId={projectId}
                    asset={asset}
                    busy={busy}
                    onCompare={(id) => {
                      setCompareId(id);
                      setMode("compare");
                    }}
                  />
                </TabsContent>
              </div>
            </Tabs>
          )}
        </aside>
      </div>

      <GenerateDialog
        projectId={projectId}
        open={genOpen}
        onOpenChange={(v) => {
          setGenOpen(v);
          if (!v && promptParam) setParam("prompt", null);
        }}
        initialTab={genTab}
        initialPrompt={promptParam}
        folders={folders.map((f) => f.folder)}
        campaigns={campaigns}
        defaultFolder={folder || "/"}
        defaultCampaignId={campaignId}
        imageAI={imageAI}
        videoAI={videoAI}
        onStarted={(r, k) => {
          jobs.track(r.jobId, k === "image" ? "generateImage" : "generateVideo");
          qc.invalidateQueries({ queryKey: ["assets"] });
          toast(`${k === "image" ? "Image" : "Video"} generation started`);
          select(r.placeholderId, false);
        }}
      />
    </div>
  );
}

function BrandSummary({ projectId, brand }: { projectId: string; brand: { colors?: string[]; fonts?: string[]; voice?: string; tone?: string[]; guidelines?: string; doNotSay?: string[] } }) {
  const empty = !brand.colors?.length && !brand.fonts?.length && !brand.voice && !brand.guidelines;
  return (
    <div>
      <SectionTitle action={<Link to={`/projects/${projectId}/settings`} className="text-[11px] text-muted hover:text-ink">Edit</Link>}>Brand guidelines</SectionTitle>
      {empty ? (
        <p className="text-[12px] text-muted">No brand profile yet — add colors, fonts and voice in project settings.</p>
      ) : (
        <div className="space-y-2 text-[12px]">
          {!!brand.colors?.length && (
            <div className="flex flex-wrap gap-1">
              {brand.colors.map((c) => (
                <span key={c} className="inline-flex items-center gap-1 rounded border border-line px-1 py-0.5 font-mono text-[10.5px]">
                  <span className="h-3 w-3 rounded-sm border border-line" style={{ background: c }} />
                  {c}
                </span>
              ))}
            </div>
          )}
          {!!brand.fonts?.length && <div className="text-ink-2">Fonts: {brand.fonts.join(", ")}</div>}
          {brand.voice && <div className="text-ink-2 line-clamp-3">Voice: {brand.voice}</div>}
          {!!brand.tone?.length && <div className="text-muted">Tone: {brand.tone.join(", ")}</div>}
          {brand.guidelines && <p className="text-muted line-clamp-4 whitespace-pre-line">{brand.guidelines}</p>}
          {!!brand.doNotSay?.length && <div className="text-muted">Avoid: {brand.doNotSay.join(", ")}</div>}
        </div>
      )}
    </div>
  );
}

function ModelSettings({ projectId, aiConfig, imageAI, videoAI }: { projectId: string; aiConfig: Record<string, string | null>; imageAI: boolean; videoAI: boolean }) {
  const rows: [string, string | null | undefined, string | null | undefined][] = [
    ["Image", aiConfig.imageProvider, aiConfig.imageModel],
    ["Video", aiConfig.videoProvider, aiConfig.videoModel],
    ["Text", aiConfig.textProvider, aiConfig.textModel],
    ["Transcription", aiConfig.transcriptionProvider, null],
  ];
  return (
    <div>
      <SectionTitle action={<Link to={`/projects/${projectId}/settings`} className="text-[11px] text-muted hover:text-ink">Change</Link>}>Model settings</SectionTitle>
      <div className="space-y-1 text-[12px]">
        {rows.map(([l, prov, model]) => (
          <div key={l} className="flex justify-between gap-2">
            <span className="text-muted">{l}</span>
            <span className="text-ink-2 truncate text-right">{prov ? `${prov}${model ? ` / ${model}` : ""}` : "Automatic"}</span>
          </div>
        ))}
        <div className="flex gap-1.5 pt-1">
          <Badge tone={imageAI ? "green" : "gray"}>image key {imageAI ? "ready" : "missing"}</Badge>
          <Badge tone={videoAI ? "green" : "gray"}>video key {videoAI ? "ready" : "missing"}</Badge>
        </div>
        {(!imageAI || !videoAI) && (
          <Link to="/settings" className="text-[11.5px] text-muted underline underline-offset-2">
            Manage provider keys
          </Link>
        )}
      </div>
    </div>
  );
}
