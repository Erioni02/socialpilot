import { ChatCircle, Heart, Repeat, BookmarkSimple, PaperPlaneTilt, MusicNotes, ShareFat, ChartBar } from "@phosphor-icons/react";
import { assetUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/common";
import { CharCount, PLATFORM_LIMITS, type Asset, type SocialPlatform } from "./shared";

export type Preview = { text: string; thread?: string[]; title?: string; privacyLevel?: string };

function Avatar({ name, logoUrl, size = 36 }: { name: string; logoUrl?: string | null; size?: number }) {
  return (
    <div className="rounded-full bg-ink text-white flex items-center justify-center font-semibold shrink-0 overflow-hidden" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {logoUrl ? <img src={logoUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function Media({ projectId, asset, className }: { projectId: string; asset: Asset; className?: string }) {
  const src = asset.currentVersionId ? assetUrl(projectId, asset.id, asset.currentVersionId) : "";
  if (asset.kind === "video") return <video src={src} muted controls preload="metadata" className={cn("w-full h-full object-cover bg-black", className)} />;
  return <img src={src} alt={asset.name} className={cn("w-full h-full object-cover", className)} />;
}

function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+|#\w+|@\w+)/g);
  return (
    <>
      {parts.map((s, i) =>
        /^(https?:\/\/|#|@)/.test(s) ? (
          <span key={i} className="text-[#1d9bf0] break-all">
            {s}
          </span>
        ) : (
          <span key={i}>{s}</span>
        ),
      )}
    </>
  );
}

export function XPreview({ projectId, preview, media, name, logoUrl }: { projectId: string; preview: Preview; media: Asset[]; name: string; logoUrl?: string | null }) {
  const parts = preview.thread?.length ? preview.thread : [preview.text];
  const max = PLATFORM_LIMITS.x.maxChars;
  const shown = media.slice(0, 4);
  return (
    <div className="rounded-xl border border-line bg-white">
      {parts.map((t, i) => (
        <div key={i} className={cn("flex gap-2.5 px-3.5 pt-3", i < parts.length - 1 ? "pb-1" : "pb-3")}>
          <div className="flex flex-col items-center">
            <Avatar name={name} logoUrl={logoUrl} />
            {i < parts.length - 1 && <div className="w-0.5 flex-1 bg-line mt-1" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-[13px]">
              <span className="font-semibold text-ink truncate">{name}</span>
              <span className="text-muted truncate">@{name.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 15) || "brand"} · now</span>
              <span className="flex-1" />
              <CharCount n={t.length} max={max} />
            </div>
            <p className="text-[13.5px] text-ink whitespace-pre-wrap break-words leading-snug mt-0.5">
              <Linkify text={t} />
            </p>
            {i === 0 && shown.length > 0 && (
              <div className={cn("mt-2 grid gap-0.5 rounded-xl overflow-hidden border border-line", shown.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
                {shown.map((a) => (
                  <Media key={a.id} projectId={projectId} asset={a} className={shown.length > 1 ? "aspect-square" : "max-h-72"} />
                ))}
              </div>
            )}
            <div className="flex items-center justify-between text-muted mt-2 max-w-[300px]">
              <ChatCircle size={15} />
              <Repeat size={15} />
              <Heart size={15} />
              <ChartBar size={15} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function InstagramPreview({ projectId, preview, media, name, logoUrl }: { projectId: string; preview: Preview; media: Asset[]; name: string; logoUrl?: string | null }) {
  const first = media[0];
  const handle = name.toLowerCase().replace(/[^a-z0-9_.]/g, "") || "brand";
  return (
    <div className="rounded-xl border border-line bg-white overflow-hidden max-w-[380px] mx-auto">
      <div className="flex items-center gap-2 px-3 py-2">
        <Avatar name={name} logoUrl={logoUrl} size={28} />
        <span className="text-[13px] font-semibold text-ink">{handle}</span>
      </div>
      <div className="aspect-[4/5] bg-canvas relative">
        {first ? <Media projectId={projectId} asset={first} /> : <div className="h-full flex items-center justify-center text-[12px] text-muted px-6 text-center">Instagram requires an image or video</div>}
        {media.length > 1 && <span className="absolute top-2 right-2 rounded-full bg-ink/70 text-white text-[11px] px-2 py-0.5">1/{media.length}</span>}
      </div>
      <div className="flex items-center gap-3.5 px-3 pt-2.5 text-ink">
        <Heart size={20} />
        <ChatCircle size={20} />
        <PaperPlaneTilt size={20} />
        <span className="flex-1" />
        <BookmarkSimple size={20} />
      </div>
      <div className="px-3 pt-1.5 pb-3 text-[13px] text-ink leading-snug">
        <p className="whitespace-pre-wrap break-words">
          <span className="font-semibold mr-1">{handle}</span>
          <Linkify text={preview.text} />
        </p>
        <div className="mt-1.5">
          <CharCount n={preview.text.length} max={PLATFORM_LIMITS.instagram.maxChars} />
        </div>
      </div>
    </div>
  );
}

export function TikTokPreview({ projectId, preview, media, name }: { projectId: string; preview: Preview; media: Asset[]; name: string }) {
  const first = media[0];
  const handle = name.toLowerCase().replace(/[^a-z0-9_.]/g, "") || "brand";
  return (
    <div className="rounded-2xl bg-black overflow-hidden aspect-[9/16] max-w-[280px] mx-auto relative text-white">
      {first ? <Media projectId={projectId} asset={first} className="absolute inset-0" /> : <div className="absolute inset-0 flex items-center justify-center text-[12px] text-white/60 px-6 text-center">TikTok requires a video or images</div>}
      <div className="absolute inset-x-0 bottom-0 bg-black/45 pt-2.5 pb-3 px-3 pr-12 pointer-events-none">
        <p className="text-[13px] font-semibold">@{handle}</p>
        <p className="text-[12px] whitespace-pre-wrap break-words line-clamp-6 leading-snug mt-0.5">{preview.text}</p>
        <p className="text-[11px] mt-1.5 flex items-center gap-1 opacity-80">
          <MusicNotes size={11} /> Original sound
        </p>
      </div>
      <div className="absolute right-2 bottom-20 flex flex-col items-center gap-3.5 pointer-events-none">
        <Heart size={24} weight="fill" />
        <ChatCircle size={24} weight="fill" />
        <BookmarkSimple size={24} weight="fill" />
        <ShareFat size={24} weight="fill" />
      </div>
      <div className="absolute top-2 left-2 right-2 flex justify-between items-center text-[10.5px]">
        <span className="rounded bg-black/50 px-1.5 py-0.5">{preview.text.length}/{PLATFORM_LIMITS.tiktok.maxChars}</span>
        {preview.privacyLevel && <span className="rounded bg-black/50 px-1.5 py-0.5">{preview.privacyLevel.replace(/_/g, " ").toLowerCase()}</span>}
      </div>
    </div>
  );
}

export function PlatformPreview({ platform, ...rest }: { platform: SocialPlatform; projectId: string; preview: Preview; media: Asset[]; name: string; logoUrl?: string | null }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[12px] text-muted mb-2">
        <PlatformIcon platform={platform} size={12} /> {platform === "x" ? "X" : platform === "instagram" ? "Instagram" : "TikTok"}
      </div>
      {platform === "x" ? <XPreview {...rest} /> : platform === "instagram" ? <InstagramPreview {...rest} /> : <TikTokPreview {...rest} />}
    </div>
  );
}
