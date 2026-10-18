import * as React from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowCounterClockwise, DownloadSimple, Eraser, FrameCorners, GitDiff, MagicWand, Palette, Sparkle, Trash, X as XIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { api, assetUrl, p } from "@/lib/api";
import { cn, fmtBytes, fmtDate, fmtUsd, titleCase, toastError } from "@/lib/utils";
import { Badge, Button, Checkbox, ConfirmDialog, Dialog, DialogContent, Field, Input, Select, SetupCallout, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from "@/components/ui";
import { SectionTitle } from "@/components/common";
import { AssetThumb, MediaPickerDialog, type Asset, type AssetVersion, type Campaign } from "@/components/content/shared";

function Section({ title, icon, children, className }: { title: React.ReactNode; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("py-3.5 border-b border-line last:border-0", className)}>
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink mb-2.5">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

const PRESETS: { id: string; label: string; dims: string }[] = [
  { id: "instagram_square", label: "Instagram square", dims: "1080×1080" },
  { id: "instagram_portrait", label: "Instagram portrait", dims: "1080×1350" },
  { id: "story_9_16", label: "Story 9:16", dims: "1080×1920" },
  { id: "x_landscape", label: "X landscape", dims: "1600×900" },
  { id: "tiktok_9_16", label: "TikTok 9:16", dims: "1080×1920" },
];

export function ImageEditPanel({
  projectId,
  asset,
  run,
  busy,
  imageAI,
  brandColors,
}: {
  projectId: string;
  asset: Asset;
  run: (op: Record<string, unknown>) => void;
  busy: boolean;
  imageAI: boolean;
  brandColors: string[];
}) {
  const cur = asset.versions.find((v) => v.id === asset.currentVersionId) ?? asset.versions[0];
  const [w, setW] = React.useState(String(cur?.width ?? 1080));
  const [h, setH] = React.useState(String(cur?.height ?? 1080));
  const [fit, setFit] = React.useState("cover");
  const [format, setFormat] = React.useState("webp");
  const [quality, setQuality] = React.useState(90);
  const [overlay, setOverlay] = React.useState("");
  const [position, setPosition] = React.useState("bottom");
  const [color, setColor] = React.useState(brandColors[0] ?? "#111111");
  const [border, setBorder] = React.useState(0);
  const [logo, setLogo] = React.useState<Asset | null>(null);
  const [logoPicker, setLogoPicker] = React.useState(false);
  const [instruction, setInstruction] = React.useState("");
  const [varN, setVarN] = React.useState(2);
  const [varInstruction, setVarInstruction] = React.useState("");
  React.useEffect(() => {
    setW(String(cur?.width ?? 1080));
    setH(String(cur?.height ?? 1080));
  }, [cur?.id, cur?.width, cur?.height]);
  const d = busy;
  return (
    <div>
      <Section title="Platform presets" icon={<FrameCorners size={14} />}>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map((x) => (
            <button key={x.id} disabled={d} onClick={() => run({ op: "preset", preset: x.id })} className="rounded-md border border-line bg-surface px-2 py-1.5 text-left hover:border-line-strong disabled:opacity-50">
              <div className="text-[12px] text-ink">{x.label}</div>
              <div className="text-[11px] text-muted tabular-nums">{x.dims}</div>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Resize">
        <div className="grid grid-cols-[1fr_1fr_1.2fr] gap-1.5">
          <Input type="number" min={16} max={8192} value={w} onChange={(e) => setW(e.target.value)} aria-label="Width" />
          <Input type="number" min={16} max={8192} value={h} onChange={(e) => setH(e.target.value)} aria-label="Height" />
          <Select value={fit} onChange={(e) => setFit(e.target.value)}>
            {["cover", "contain", "fill", "inside"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
        </div>
        <Button size="sm" className="mt-2 w-full" disabled={d || Number(w) < 16 || Number(h) < 16} onClick={() => run({ op: "resize", width: Math.round(Number(w)), height: Math.round(Number(h)), fit })}>
          Resize to {w}×{h}
        </Button>
      </Section>
      <Section title="Format">
        <div className="flex gap-1.5">
          <Select value={format} onChange={(e) => setFormat(e.target.value)} className="w-28">
            {["jpeg", "png", "webp"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
          {format !== "png" && <Input type="number" min={30} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} aria-label="Quality" className="w-20" />}
          <Button size="md" disabled={d} onClick={() => run({ op: "format", format, quality: Math.max(30, Math.min(100, quality || 90)) })}>
            Convert
          </Button>
        </div>
      </Section>
      <Section title="Brand overlay" icon={<Palette size={14} />}>
        <div className="space-y-2">
          <Input value={overlay} onChange={(e) => setOverlay(e.target.value)} placeholder="Overlay text (optional)" maxLength={200} />
          <div className="grid grid-cols-2 gap-1.5">
            <Select value={position} onChange={(e) => setPosition(e.target.value)}>
              {["top", "center", "bottom"].map((x) => (
                <option key={x} value={x}>
                  Text {x}
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-1.5">
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#111111"} onChange={(e) => setColor(e.target.value)} className="h-8.5 w-9 rounded border border-line bg-surface" aria-label="Color" />
              <Input value={color} onChange={(e) => setColor(e.target.value)} className="font-mono text-[12px]" />
            </div>
          </div>
          {brandColors.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {brandColors.map((c) => (
                <button key={c} onClick={() => setColor(c)} title={c} className={cn("h-5 w-5 rounded border", color === c ? "border-ink ring-2 ring-ink/20" : "border-line")} style={{ background: c }} />
              ))}
            </div>
          )}
          <Field label={`Border: ${border}px`}>
            <input type="range" min={0} max={200} value={border} onChange={(e) => setBorder(Number(e.target.value))} />
          </Field>
          <div className="flex items-center gap-2">
            {logo ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-line px-1.5 py-1 text-[12px]">
                <AssetThumb projectId={projectId} asset={logo} className="h-6 w-6 rounded" showStatus={false} /> <span className="truncate max-w-[120px]">{logo.name}</span>
                <button onClick={() => setLogo(null)} aria-label="Remove logo" className="text-muted hover:text-ink">
                  <XIcon size={11} />
                </button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setLogoPicker(true)}>
                + Logo from library
              </Button>
            )}
          </div>
          <Button
            size="sm"
            className="w-full"
            disabled={d || (!overlay.trim() && !logo && !border)}
            onClick={() => run({ op: "brand", ...(overlay.trim() ? { overlayText: overlay.trim() } : {}), textPosition: position, ...(color ? { color } : {}), ...(logo ? { logoAssetId: logo.id } : {}), border })}
          >
            Apply brand overlay
          </Button>
        </div>
        <MediaPickerDialog projectId={projectId} open={logoPicker} onOpenChange={setLogoPicker} kind="image" single title="Choose a logo" onPick={(_ids, a) => setLogo(a[0] ?? null)} />
      </Section>
      <Section title="AI editing" icon={<Sparkle size={14} weight="fill" />}>
        {!imageAI ? (
          <SetupCallout title="No image AI key" action={<Button asChild size="sm" variant="secondary"><Link to="/settings">Settings</Link></Button>}>
            Add a ByteDance (BytePlus), OpenAI, Replicate or Stability key to edit with AI.
          </SetupCallout>
        ) : (
          <div className="space-y-3">
            <div>
              <Textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Describe the edit — e.g. “replace the background with a sunlit kitchen”" className="min-h-[64px]" />
              <Button size="sm" variant="primary" className="mt-1.5 w-full" disabled={d || instruction.trim().length < 3} onClick={() => run({ op: "ai_edit", instruction: instruction.trim() })}>
                <MagicWand size={13} /> Apply AI edit
              </Button>
            </div>
            <Button size="sm" className="w-full" disabled={d} onClick={() => run({ op: "remove_background" })}>
              <Eraser size={13} /> Remove background
            </Button>
            <div>
              <div className="flex gap-1.5">
                <Select value={String(varN)} onChange={(e) => setVarN(Number(e.target.value))} className="w-20">
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </Select>
                <Input value={varInstruction} onChange={(e) => setVarInstruction(e.target.value)} placeholder="Variation direction (optional)" />
              </div>
              <Button size="sm" className="mt-1.5 w-full" disabled={d} onClick={() => run({ op: "variations", n: varN, ...(varInstruction.trim() ? { instruction: varInstruction.trim() } : {}) })}>
                Create {varN} variation{varN > 1 ? "s" : ""}
              </Button>
              <p className="text-[11px] text-faint mt-1">Variations are saved as new assets. AI edits use your provider and may incur costs.</p>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

export function VideoEditPanel({
  projectId,
  asset,
  run,
  busy,
  range,
  currentTime,
  concatCandidates,
}: {
  projectId: string;
  asset: Asset;
  run: (op: Record<string, unknown>) => void;
  busy: boolean;
  range: [number, number];
  currentTime: number;
  concatCandidates: Asset[];
}) {
  const [aspect, setAspect] = React.useState("9:16");
  const [mode, setMode] = React.useState("crop");
  const [srt, setSrt] = React.useState("");
  const [auto, setAuto] = React.useState(false);
  const [crf, setCrf] = React.useState(26);
  const [concatIds, setConcatIds] = React.useState<string[]>([]);
  React.useEffect(() => setConcatIds(concatCandidates.map((a) => a.id)), [concatCandidates]);
  const d = busy;
  return (
    <div>
      <Section title="Trim">
        <p className="text-[12px] text-muted mb-2">
          Set the range on the timeline: {range[0].toFixed(1)}s → {range[1].toFixed(1)}s
        </p>
        <Button size="sm" className="w-full" disabled={d || range[1] - range[0] < 0.1} onClick={() => run({ op: "trim", start: range[0], end: range[1] })}>
          Trim to selection
        </Button>
      </Section>
      <Section title="Aspect ratio">
        <div className="grid grid-cols-2 gap-1.5">
          <Select value={aspect} onChange={(e) => setAspect(e.target.value)}>
            {["9:16", "1:1", "4:5", "16:9"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
          <Select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="crop">Crop to fill</option>
            <option value="pad">Pad (letterbox)</option>
          </Select>
        </div>
        <Button size="sm" className="mt-2 w-full" disabled={d} onClick={() => run({ op: "aspect", aspect, mode })}>
          Convert to {aspect}
        </Button>
      </Section>
      <Section title="Subtitles">
        <Checkbox checked={auto} onCheckedChange={setAuto} label="Auto-transcribe (uses your transcription provider)" />
        {!auto && <Textarea value={srt} onChange={(e) => setSrt(e.target.value)} placeholder={"1\n00:00:00,000 --> 00:00:02,000\nHello!"} className="mt-2 min-h-[90px] font-mono text-[12px]" />}
        <Button size="sm" className="mt-2 w-full" disabled={d || (!auto && !srt.trim())} onClick={() => run({ op: "subtitles", ...(auto ? { autoTranscribe: true } : { srt }) })}>
          Burn in subtitles
        </Button>
      </Section>
      <Section title="Concatenate">
        {!concatCandidates.length ? (
          <p className="text-[12px] text-muted">Select other video clips in the library (Ctrl/⌘-click) to append them to this one.</p>
        ) : (
          <>
            <div className="space-y-1">
              {concatCandidates.map((a) => (
                <Checkbox key={a.id} checked={concatIds.includes(a.id)} onCheckedChange={(v) => setConcatIds((s) => (v ? [...s, a.id] : s.filter((x) => x !== a.id)))} label={<span className="truncate max-w-[200px] inline-block align-bottom">{a.name}</span>} />
              ))}
            </div>
            <Button size="sm" className="mt-2 w-full" disabled={d || !concatIds.length} onClick={() => run({ op: "concat", assetIds: concatCandidates.filter((a) => concatIds.includes(a.id)).map((a) => a.id) })}>
              Append {concatIds.length} clip{concatIds.length === 1 ? "" : "s"}
            </Button>
            <p className="text-[11px] text-faint mt-1">Creates a new asset in selection order.</p>
          </>
        )}
      </Section>
      <Section title="Thumbnail">
        <Button size="sm" className="w-full" disabled={d} onClick={() => run({ op: "thumbnail", at: Math.round(currentTime * 10) / 10 })}>
          Capture frame at {currentTime.toFixed(1)}s
        </Button>
        <p className="text-[11px] text-faint mt-1">Saved as a new image asset.</p>
      </Section>
      <Section title="Compress">
        <Field label={`Quality (CRF ${crf} — lower is better)`}>
          <input type="range" min={18} max={35} value={crf} onChange={(e) => setCrf(Number(e.target.value))} />
        </Field>
        <Button size="sm" className="mt-2 w-full" disabled={d} onClick={() => run({ op: "compress", crf })}>
          Compress
        </Button>
      </Section>
      <p className="text-[11px] text-faint pt-2">
        Asset {asset.name} · <a className="underline" href={assetUrl(projectId, asset.id, asset.currentVersionId ?? undefined, true)}>download</a>
      </p>
    </div>
  );
}

export function PropertiesPanel({ projectId, asset, campaigns, folders, usedIn, onDeleted }: { projectId: string; asset: Asset; campaigns: Campaign[]; folders: string[]; usedIn: { id: string; title: string; status: string }[]; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = React.useState(asset.name);
  const [folder, setFolder] = React.useState(asset.folder);
  const [campaignId, setCampaignId] = React.useState(asset.campaignId ?? "");
  const [tags, setTags] = React.useState<string[]>(asset.tags);
  const [tagDraft, setTagDraft] = React.useState("");
  React.useEffect(() => {
    setName(asset.name);
    setFolder(asset.folder);
    setCampaignId(asset.campaignId ?? "");
    setTags(asset.tags);
  }, [asset.id, asset.name, asset.folder, asset.campaignId, asset.tags]);
  const dirty = name !== asset.name || folder !== asset.folder || campaignId !== (asset.campaignId ?? "") || tags.join("|") !== asset.tags.join("|");
  const save = useMutation({
    mutationFn: () => api.patch(p(projectId, `/assets/${asset.id}`), { name: name.trim(), folder: folder.trim() || "/", campaignId: campaignId || null, tags }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset"] });
      qc.invalidateQueries({ queryKey: ["assets"] });
      toast.success("Asset updated");
    },
    onError: (e) => toastError(e),
  });
  const [delOpen, setDelOpen] = React.useState(false);
  const del = useMutation({
    mutationFn: () => api.del(p(projectId, `/assets/${asset.id}`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      setDelOpen(false);
      toast.success("Asset deleted");
      onDeleted();
    },
    onError: (e) => toastError(e),
  });
  const addTag = () => {
    const t = tagDraft.trim().slice(0, 40);
    if (t && !tags.includes(t) && tags.length < 20) setTags([...tags, t]);
    setTagDraft("");
  };
  return (
    <div className="space-y-3 py-2">
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
      </Field>
      <Field label="Folder">
        <Input value={folder} onChange={(e) => setFolder(e.target.value)} list="ws-folders" placeholder="/" />
        <datalist id="ws-folders">
          {folders.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </Field>
      <Field label="Campaign">
        <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
          <option value="">No campaign</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Tags">
        <div className="flex flex-wrap gap-1 mb-1">
          {tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-canvas border border-line px-2 py-0.5 text-[11.5px]">
              {t}
              <button onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={`Remove ${t}`} className="text-muted hover:text-ink">
                <XIcon size={10} />
              </button>
            </span>
          ))}
        </div>
        <Input
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTag();
            }
          }}
          onBlur={addTag}
          placeholder="Add tag — Enter"
        />
      </Field>
      <Button size="sm" variant="primary" className="w-full" disabled={!dirty || !name.trim()} loading={save.isPending} onClick={() => save.mutate()}>
        Save properties
      </Button>
      <div className="grid grid-cols-2 gap-2 text-[12px] pt-2">
        <div>
          <div className="text-faint">Source</div>
          <div className="text-ink-2">{titleCase(asset.source)}</div>
        </div>
        <div>
          <div className="text-faint">Created</div>
          <div className="text-ink-2">{fmtDate(asset.createdAt, "MMM d, HH:mm")}</div>
        </div>
        <div>
          <div className="text-faint">By</div>
          <div className="text-ink-2">{asset.createdBy}</div>
        </div>
        <div>
          <div className="text-faint">Approval</div>
          <div className="text-ink-2">{asset.approvalStatus ?? "none"}</div>
        </div>
      </div>
      <div className="pt-2">
        <SectionTitle>Used in posts</SectionTitle>
        {usedIn.length ? (
          <ul className="space-y-1">
            {usedIn.map((x) => (
              <li key={x.id}>
                <Link to={`/projects/${projectId}/content/${x.id}`} className="text-[12.5px] text-ink-2 hover:underline underline-offset-2">
                  {x.title || "Untitled post"}
                </Link>{" "}
                <Badge>{x.status.replace(/_/g, " ")}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-muted">Not attached to any post.</p>
        )}
      </div>
      <Button size="sm" variant="danger-ghost" className="w-full" onClick={() => setDelOpen(true)}>
        <Trash size={13} /> Delete asset
      </Button>
      <ConfirmDialog open={delOpen} onOpenChange={setDelOpen} title="Delete this asset?" description="All versions and files are removed permanently. Assets attached to scheduled posts can't be deleted." confirmLabel="Delete" danger loading={del.isPending} onConfirm={() => del.mutate()} />
    </div>
  );
}

export function HistoryPanel({ projectId, asset, busy, onCompare }: { projectId: string; asset: Asset; busy: boolean; onCompare: (versionId: string) => void }) {
  const qc = useQueryClient();
  const restore = useMutation({
    mutationFn: (versionId: string) => api.post(p(projectId, `/assets/${asset.id}/restore`), { versionId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset"] });
      qc.invalidateQueries({ queryKey: ["assets"] });
      toast.success("Version restored");
    },
    onError: (e) => toastError(e),
  });
  const total = asset.versions.reduce((s, v) => s + (v.costUsd ?? 0), 0);
  return (
    <div className="py-2">
      {total > 0 && <p className="text-[12px] text-muted mb-2">Total AI cost for this asset: {fmtUsd(total)}</p>}
      <ol className="space-y-2">
        {asset.versions.map((v: AssetVersion) => {
          const current = v.id === asset.currentVersionId;
          return (
            <li key={v.id} className={cn("rounded-lg border p-2.5", current ? "border-ink/40 bg-subtle" : "border-line")}>
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] font-medium text-ink">v{v.version}</span>
                <Badge tone={v.operation === "generate" ? "purple" : v.operation === "upload" ? "gray" : "blue"}>{v.operation.replace(/_/g, " ")}</Badge>
                {current && <Badge tone="ink">current</Badge>}
                <span className="flex-1" />
                <span className="text-[11px] text-faint">{v.createdAt ? fmtDate(v.createdAt, "MMM d, HH:mm") : ""}</span>
              </div>
              <div className="text-[11.5px] text-muted mt-1 space-x-2">
                {v.width && v.height ? <span className="tabular-nums">{v.width}×{v.height}</span> : null}
                {v.durationSec ? <span>{v.durationSec.toFixed(1)}s</span> : null}
                <span>{fmtBytes(v.sizeBytes)}</span>
                {v.provider && (
                  <span>
                    {v.provider}
                    {v.model ? ` / ${v.model}` : ""}
                  </span>
                )}
                {!!v.costUsd && <span>{fmtUsd(v.costUsd)}</span>}
                {v.createdBy && <span>by {v.createdBy}</span>}
              </div>
              {v.prompt && <p className="text-[12px] text-ink-2 mt-1 line-clamp-3">“{v.prompt}”</p>}
              {v.params && Object.keys(v.params).length > 0 && !v.prompt && <p className="text-[11px] font-mono text-faint mt-1 truncate">{JSON.stringify(v.params)}</p>}
              <div className="flex gap-1 mt-1.5">
                {!current && (
                  <Button size="sm" variant="secondary" disabled={busy} loading={restore.isPending && restore.variables === v.id} onClick={() => restore.mutate(v.id)}>
                    <ArrowCounterClockwise size={12} /> Restore
                  </Button>
                )}
                {!current && (
                  <Button size="sm" variant="ghost" onClick={() => onCompare(v.id)}>
                    <GitDiff size={12} /> Compare
                  </Button>
                )}
                <Button asChild size="sm" variant="ghost">
                  <a href={assetUrl(projectId, asset.id, v.id, true)}>
                    <DownloadSimple size={12} /> Download
                  </a>
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function GenerateDialog({
  projectId,
  open,
  onOpenChange,
  initialTab,
  initialPrompt,
  folders,
  campaigns,
  defaultFolder,
  defaultCampaignId,
  imageAI,
  videoAI,
  onStarted,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialTab: "image" | "video";
  initialPrompt?: string;
  folders: string[];
  campaigns: Campaign[];
  defaultFolder: string;
  defaultCampaignId: string;
  imageAI: boolean;
  videoAI: boolean;
  onStarted: (r: { jobId: string; placeholderId: string }, kind: "image" | "video") => void;
}) {
  const [tab, setTab] = React.useState(initialTab);
  const [prompt, setPrompt] = React.useState("");
  const [size, setSize] = React.useState("1024x1024");
  const [n, setN] = React.useState(1);
  const [aspect, setAspect] = React.useState("9:16");
  const [duration, setDuration] = React.useState(6);
  const [firstFrame, setFirstFrame] = React.useState<Asset | null>(null);
  const [picker, setPicker] = React.useState(false);
  const [folder, setFolder] = React.useState(defaultFolder);
  const [campaignId, setCampaignId] = React.useState(defaultCampaignId);
  React.useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    if (initialPrompt) setPrompt(initialPrompt);
    setFolder(defaultFolder || "/");
    setCampaignId(defaultCampaignId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const m = useMutation({
    mutationFn: () =>
      tab === "image"
        ? api.post<{ jobId: string; placeholderId: string }>(p(projectId, "/assets/generate-image"), { prompt: prompt.trim(), size, n, folder: folder || "/", campaignId: campaignId || null })
        : api.post<{ jobId: string; placeholderId: string }>(p(projectId, "/assets/generate-video"), {
            prompt: prompt.trim(),
            aspect,
            durationSec: duration,
            folder: folder || "/",
            campaignId: campaignId || null,
            ...(firstFrame ? { imageAssetId: firstFrame.id } : {}),
          }),
    onSuccess: (r) => {
      onStarted(r, tab);
      onOpenChange(false);
      setPrompt("");
    },
    onError: (e) => toastError(e),
  });
  const ready = tab === "image" ? imageAI : videoAI;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Generate media"
        description="Runs on your own provider keys. The result appears in the library when it's ready."
        className="max-w-xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={m.isPending} disabled={!ready || prompt.trim().length < 3} onClick={() => m.mutate()}>
              <Sparkle size={13} weight="fill" /> Generate {tab}
            </Button>
          </>
        }
      >
        <Tabs value={tab} onValueChange={(v) => setTab(v as "image" | "video")}>
          <TabsList>
            <TabsTrigger value="image">Image</TabsTrigger>
            <TabsTrigger value="video">Video</TabsTrigger>
          </TabsList>
          {!ready && (
            <div className="mb-3">
              <SetupCallout title={`No ${tab} AI provider configured`} action={<Button asChild size="sm" variant="secondary"><Link to="/settings">Settings</Link></Button>}>
                {tab === "image" ? "Add an OpenAI, Replicate or Stability API key." : "Video generation needs a Replicate API key."}
              </SetupCallout>
            </div>
          )}
          <Field label="Prompt">
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={tab === "image" ? "A flat-lay of our product on warm linen, soft morning light" : "Slow push-in on the product on a desk, cinematic lighting"} className="min-h-[90px]" autoFocus />
          </Field>
          <TabsContent value="image" className="grid grid-cols-2 gap-3 mt-3">
            <Field label="Size">
              <Select value={size} onChange={(e) => setSize(e.target.value)}>
                <option value="1024x1024">Square 1024×1024</option>
                <option value="1024x1536">Portrait 1024×1536</option>
                <option value="1536x1024">Landscape 1536×1024</option>
              </Select>
            </Field>
            <Field label="Count">
              <Select value={String(n)} onChange={(e) => setN(Number(e.target.value))}>
                {[1, 2, 3, 4].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
            </Field>
          </TabsContent>
          <TabsContent value="video" className="grid grid-cols-2 gap-3 mt-3">
            <Field label="Aspect">
              <Select value={aspect} onChange={(e) => setAspect(e.target.value)}>
                {["9:16", "16:9", "1:1"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
            </Field>
            <Field label={`Duration: ${duration}s`}>
              <input type="range" min={2} max={20} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="mt-2" />
            </Field>
            <Field label="First frame (optional)" className="col-span-2">
              {firstFrame ? (
                <span className="inline-flex items-center gap-2 rounded-md border border-line px-2 py-1 text-[12.5px]">
                  <AssetThumb projectId={projectId} asset={firstFrame} className="h-8 w-8 rounded" showStatus={false} />
                  {firstFrame.name}
                  <button onClick={() => setFirstFrame(null)} className="text-muted hover:text-ink" aria-label="Remove">
                    <XIcon size={11} />
                  </button>
                </span>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setPicker(true)}>
                  Choose image
                </Button>
              )}
            </Field>
          </TabsContent>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="Folder">
              <Input value={folder} onChange={(e) => setFolder(e.target.value)} list="gen-folders" />
              <datalist id="gen-folders">
                {folders.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </Field>
            <Field label="Campaign">
              <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                <option value="">None</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Tabs>
        <MediaPickerDialog projectId={projectId} open={picker} onOpenChange={setPicker} kind="image" single title="First frame" onPick={(_ids, a) => setFirstFrame(a[0] ?? null)} />
      </DialogContent>
    </Dialog>
  );
}
