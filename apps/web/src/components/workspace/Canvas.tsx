import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Crop, FileText, MusicNote, Scissors, Warning } from "@phosphor-icons/react";
import { assetUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button, Select, Skeleton, Spinner } from "@/components/ui";
import type { Asset, AssetVersion } from "@/components/content/shared";

/** Checkerboard backdrop so transparent pixels are visible. */
export const CHECKER: React.CSSProperties = {
  backgroundColor: "#f6f6f4",
  backgroundImage: "linear-gradient(45deg,#ebebe8 25%,transparent 25%,transparent 75%,#ebebe8 75%),linear-gradient(45deg,#ebebe8 25%,transparent 25%,transparent 75%,#ebebe8 75%)",
  backgroundSize: "20px 20px",
  backgroundPosition: "0 0,10px 10px",
};

type Rect = { x: number; y: number; w: number; h: number };
const ASPECTS: Record<string, number | null> = { Free: null, "1:1": 1, "4:5": 4 / 5, "9:16": 9 / 16, "16:9": 16 / 9 };

/** Drag-to-select crop region over an image; converts the selection to natural pixel coordinates. */
export function CropBox({ src, onApply, onCancel, busy }: { src: string; onApply: (r: { left: number; top: number; width: number; height: number }) => void; onCancel: () => void; busy?: boolean }) {
  const imgRef = React.useRef<HTMLImageElement>(null);
  const [rect, setRect] = React.useState<Rect | null>(null);
  const [aspect, setAspect] = React.useState("Free");
  const [natural, setNatural] = React.useState<{ w: number; h: number } | null>(null);
  const drag = React.useRef<{ mode: "new" | "move"; sx: number; sy: number; orig: Rect | null } | null>(null);

  const bounds = () => imgRef.current!.getBoundingClientRect();
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const pos = (e: React.PointerEvent) => {
    const b = bounds();
    return { x: clamp(e.clientX - b.left, 0, b.width), y: clamp(e.clientY - b.top, 0, b.height), bw: b.width, bh: b.height };
  };
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = pos(e);
    const inside = rect && p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
    drag.current = { mode: inside ? "move" : "new", sx: p.x, sy: p.y, orig: rect };
    if (!inside) setRect({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = pos(e);
    if (d.mode === "move" && d.orig) {
      const nx = clamp(d.orig.x + p.x - d.sx, 0, p.bw - d.orig.w);
      const ny = clamp(d.orig.y + p.y - d.sy, 0, p.bh - d.orig.h);
      setRect({ ...d.orig, x: nx, y: ny });
      return;
    }
    let w = p.x - d.sx;
    let h = p.y - d.sy;
    const ar = ASPECTS[aspect];
    if (ar) {
      const sign = (n: number) => (n < 0 ? -1 : 1);
      if (Math.abs(w) / ar > Math.abs(h)) h = sign(h) * Math.abs(w) / ar;
      else w = sign(w) * Math.abs(h) * ar;
      // keep inside the image
      const maxW = w < 0 ? d.sx : p.bw - d.sx;
      const maxH = h < 0 ? d.sy : p.bh - d.sy;
      const k = Math.min(1, maxW / Math.max(1, Math.abs(w)), maxH / Math.max(1, Math.abs(h)));
      w *= k;
      h *= k;
    }
    setRect({ x: w < 0 ? d.sx + w : d.sx, y: h < 0 ? d.sy + h : d.sy, w: Math.abs(w), h: Math.abs(h) });
  };
  const onUp = () => {
    drag.current = null;
  };
  const toNatural = () => {
    if (!rect || !natural || !imgRef.current) return null;
    const b = bounds();
    const sx = natural.w / b.width;
    const sy = natural.h / b.height;
    const left = Math.max(0, Math.round(rect.x * sx));
    const top = Math.max(0, Math.round(rect.y * sy));
    const width = Math.min(natural.w - left, Math.round(rect.w * sx));
    const height = Math.min(natural.h - top, Math.round(rect.h * sy));
    return width >= 1 && height >= 1 ? { left, top, width, height } : null;
  };
  const nat = toNatural();
  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line bg-surface">
        <Crop size={14} className="text-muted" />
        <span className="text-[12.5px] text-ink-2">Drag on the image to select the crop area</span>
        <Select value={aspect} onChange={(e) => setAspect(e.target.value)} className="h-7 w-24 text-[12px]">
          {Object.keys(ASPECTS).map((a) => (
            <option key={a}>{a}</option>
          ))}
        </Select>
        <span className="text-[12px] text-muted tabular-nums">{nat ? `${nat.width}×${nat.height}px at ${nat.left},${nat.top}` : natural ? `${natural.w}×${natural.h}px` : ""}</span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={!nat || (nat.width < 8 && nat.height < 8)} loading={busy} onClick={() => nat && onApply(nat)}>
          Apply crop
        </Button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center p-6 overflow-hidden" style={CHECKER}>
        <div className="relative inline-block max-h-full select-none">
          <img
            ref={imgRef}
            src={src}
            alt=""
            draggable={false}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className="block max-h-[calc(100vh-330px)] max-w-full object-contain"
          />
          <div className="absolute inset-0 cursor-crosshair overflow-hidden touch-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            {rect && rect.w > 0 && (
              <div className="absolute border border-white cursor-move" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, boxShadow: "0 0 0 9999px rgba(17,17,17,0.45)" }}>
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} className="border border-white/25" />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function fmtSec(s: number) {
  if (!Number.isFinite(s)) return "0:00.0";
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

/** HTML5 video with a simple trim timeline (start/end handles + current time). */
export function VideoTimeline({
  src,
  duration: knownDuration,
  range,
  onRange,
  onTrim,
  onTime,
  busy,
}: {
  src: string;
  duration?: number | null;
  range: [number, number];
  onRange: (r: [number, number]) => void;
  onTrim: () => void;
  onTime?: (t: number) => void;
  busy?: boolean;
}) {
  const ref = React.useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = React.useState(knownDuration ?? 0);
  const [t, setT] = React.useState(0);
  const [start, end] = range;
  const step = 0.1;
  const pct = (x: number) => (duration ? (x / duration) * 100 : 0);
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 bg-black flex items-center justify-center">
        <video
          ref={ref}
          src={src}
          controls
          className="max-h-full max-w-full"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) {
              setDuration(d);
              if (end <= 0 || end > d) onRange([0, Math.round(d * 10) / 10]);
            }
          }}
          onTimeUpdate={(e) => {
            const v = e.currentTarget.currentTime;
            setT(v);
            onTime?.(v);
            if (v > end && end > start && !e.currentTarget.paused && e.currentTarget.dataset.preview === "1") {
              e.currentTarget.pause();
              e.currentTarget.dataset.preview = "";
            }
          }}
        />
      </div>
      <div className="border-t border-line bg-surface px-4 py-3 space-y-2.5">
        <div className="relative h-8 rounded-md bg-canvas border border-line overflow-hidden">
          <div className="absolute inset-y-0 bg-blue-bg border-x-2 border-blue-fg" style={{ left: `${pct(start)}%`, width: `${Math.max(0, pct(end) - pct(start))}%` }} />
          <div className="absolute inset-y-0 w-px bg-ink" style={{ left: `${pct(t)}%` }} />
          <input type="range" min={0} max={duration || 0} step={step} value={start} onChange={(e) => onRange([Math.min(Number(e.target.value), end - step), end])} className="absolute inset-0 w-full opacity-0 cursor-ew-resize" aria-label="Trim start" style={{ zIndex: start > duration / 2 ? 3 : 2 }} />
          <input type="range" min={0} max={duration || 0} step={step} value={end} onChange={(e) => onRange([start, Math.max(Number(e.target.value), start + step)])} className="absolute inset-0 w-full opacity-0 cursor-ew-resize" aria-label="Trim end" style={{ zIndex: start > duration / 2 ? 2 : 3 }} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-muted">Current</span>
          <span className="tabular-nums text-ink font-medium">{fmtSec(t)}</span>
          <span className="text-faint">/ {fmtSec(duration)}</span>
          <span className="mx-1 text-line-strong">|</span>
          <Scissors size={13} className="text-muted" />
          <span className="tabular-nums">
            {fmtSec(start)} → {fmtSec(end)}
          </span>
          <span className="text-muted">({(end - start).toFixed(1)}s)</span>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => onRange([Math.min(t, end - step), end])}>
            Start at current
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onRange([start, Math.max(t, start + step)])}>
            End at current
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const v = ref.current;
              if (!v) return;
              v.currentTime = start;
              v.dataset.preview = "1";
              void v.play();
            }}
          >
            Preview range
          </Button>
          <Button size="sm" variant="primary" loading={busy} disabled={!duration || end - start < 0.1 || (start <= 0.05 && Math.abs(end - duration) < 0.05)} onClick={onTrim}>
            Trim
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DocumentPreview({ src }: { src: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["asset", "text", src],
    queryFn: async () => {
      const r = await fetch(src, { credentials: "include" });
      if (!r.ok) throw new Error(`Could not load file (${r.status})`);
      return r.text();
    },
    staleTime: 60_000,
  });
  if (isLoading) return <Skeleton className="m-6 h-64" />;
  if (error) return <p className="p-6 text-[13px] text-red-fg">{(error as Error).message}</p>;
  const text = data ?? "";
  return (
    <div className="h-full overflow-auto scrollbar-thin p-6">
      <pre className="mx-auto max-w-3xl whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-ink-2 bg-surface border border-line rounded-lg p-5">
        {text.length > 200_000 ? `${text.slice(0, 200_000)}\n\n… truncated` : text || "(empty file)"}
      </pre>
    </div>
  );
}

/** Before/after: drag the divider to compare the current version with a previous one. */
export function CompareView({ projectId, asset, versions, compareId, onCompareId }: { projectId: string; asset: Asset; versions: AssetVersion[]; compareId: string; onCompareId: (id: string) => void }) {
  const [pos, setPos] = React.useState(50);
  const [mode, setMode] = React.useState<"slider" | "side">(asset.kind === "image" ? "slider" : "side");
  const others = versions.filter((v) => v.id !== asset.currentVersionId);
  const cur = versions.find((v) => v.id === asset.currentVersionId);
  const prev = versions.find((v) => v.id === compareId);
  const before = prev ? assetUrl(projectId, asset.id, prev.id) : "";
  const after = cur ? assetUrl(projectId, asset.id, cur.id) : "";
  const Media = ({ src, className }: { src: string; className?: string }) =>
    asset.kind === "video" ? <video src={src} controls muted className={cn("max-h-full max-w-full", className)} /> : <img src={src} alt="" draggable={false} className={cn("max-h-full max-w-full object-contain", className)} />;
  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line bg-surface text-[12.5px]">
        <span className="text-muted">Before</span>
        <Select value={compareId} onChange={(e) => onCompareId(e.target.value)} className="h-7 w-auto text-[12px]">
          {!others.length && <option value="">No previous versions</option>}
          {others.map((v) => (
            <option key={v.id} value={v.id}>
              v{v.version} · {v.operation}
            </option>
          ))}
        </Select>
        <span className="text-muted">After: v{cur?.version} · {cur?.operation}</span>
        <span className="flex-1" />
        {asset.kind === "image" && (
          <div className="inline-flex rounded-md border border-line p-0.5">
            {(["slider", "side"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={cn("px-2.5 h-6 rounded text-[12px]", mode === m ? "bg-ink text-white" : "text-ink-2")}>
                {m === "slider" ? "Slider" : "Side by side"}
              </button>
            ))}
          </div>
        )}
      </div>
      {!prev ? (
        <div className="flex-1 flex items-center justify-center text-[13px] text-muted">This asset has only one version.</div>
      ) : mode === "side" || asset.kind !== "image" ? (
        <div className={cn("flex-1 min-h-0 grid grid-cols-2 gap-px bg-line")}>
          {[
            ["Before", before],
            ["After", after],
          ].map(([l, s]) => (
            <div key={l} className="relative flex items-center justify-center p-4 min-h-0" style={CHECKER}>
              <span className="absolute top-2 left-2 rounded bg-ink/70 text-white text-[11px] px-1.5 py-0.5">{l}</span>
              {asset.kind === "document" ? <DocumentPreview src={s} /> : <Media src={s} className="max-h-[calc(100vh-330px)]" />}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center p-6" style={CHECKER}>
          <div className="relative inline-block select-none">
            <img src={after} alt="" draggable={false} className="block max-h-[calc(100vh-330px)] max-w-full object-contain" />
            <img src={before} alt="" draggable={false} className="absolute inset-0 h-full w-full object-contain" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
            <div className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)] pointer-events-none" style={{ left: `${pos}%` }} />
            <span className="absolute top-2 left-2 rounded bg-ink/70 text-white text-[11px] px-1.5 py-0.5">Before</span>
            <span className="absolute top-2 right-2 rounded bg-ink/70 text-white text-[11px] px-1.5 py-0.5">After</span>
            <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize" aria-label="Compare position" />
          </div>
        </div>
      )}
    </div>
  );
}

export function AssetStage({ projectId, asset, children }: { projectId: string; asset: Asset; children?: React.ReactNode }) {
  const src = asset.currentVersionId ? assetUrl(projectId, asset.id, asset.currentVersionId) : "";
  if (!asset.currentVersionId)
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-[13px] text-muted">
        {asset.status === "failed" ? (
          <>
            <Warning size={22} className="text-red-fg" />
            <span className="text-red-fg">Generation failed</span>
            {asset.error && <span className="max-w-md text-center text-[12px]">{asset.error}</span>}
          </>
        ) : (
          <>
            <Spinner size={22} />
            Generating…
          </>
        )}
      </div>
    );
  if (asset.kind === "image")
    return (
      <div className="h-full flex items-center justify-center p-6" style={CHECKER}>
        <img src={src} alt={asset.name} className="max-h-full max-w-full object-contain shadow-soft" />
        {children}
      </div>
    );
  if (asset.kind === "audio")
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        <MusicNote size={36} className="text-muted" />
        <audio src={src} controls />
      </div>
    );
  if (asset.kind === "document") return <DocumentPreview src={src} />;
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 text-muted">
      <FileText size={30} />
      <span className="text-[13px]">No preview for this file type.</span>
    </div>
  );
}
