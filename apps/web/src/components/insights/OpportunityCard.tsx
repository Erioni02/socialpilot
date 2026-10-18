import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Article, BookmarkSimple, CaretDown, ImageSquare, Megaphone, PaintBrush, Robot, X } from "@phosphor-icons/react";
import { api, p } from "@/lib/api";
import { cn, PLATFORM_LABEL, toastError } from "@/lib/utils";
import { Badge, Button, DropdownContent, DropdownItem, DropdownMenu, DropdownTrigger, StatusBadge } from "@/components/ui";
import { PlatformIcon } from "@/components/common";
import { Dot, ExtLink, MethodBadge, Signals, TimeAgo } from "./shared";

export type Opportunity = {
  id: string;
  title: string;
  whatHappened: string;
  whyItMatters: string;
  sources: { itemId: string; title: string; url: string; sourceName: string; publishedAt: string; score?: number | null; comments?: number | null }[];
  relevance: string;
  relevanceScore: number;
  angle: string;
  audience: string;
  platform: string;
  hook: string;
  outline: string[];
  cta: string;
  timeliness: string;
  confidence: string;
  risks: string;
  method: string;
  status: string;
  createdAt: string;
};

const SOCIAL = ["x", "instagram", "tiktok"];
const CONF_TONE: Record<string, "green" | "yellow" | "gray"> = { high: "green", medium: "yellow", low: "gray" };

function Block({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-[10.5px] uppercase tracking-[0.08em] text-faint font-medium mb-1">{label}</div>
      <div className="text-[13px] text-ink-2 leading-relaxed">{children}</div>
    </div>
  );
}

export function OpportunityCard({ projectId, opp }: { projectId: string; opp: Opportunity }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [expanded, setExpanded] = React.useState(false);
  const promptText = opp.hook || opp.angle || opp.title;
  const invalidate = () => qc.invalidateQueries({ queryKey: ["opportunities", projectId] });

  const setStatus = useMutation({
    mutationFn: (status: "saved" | "dismissed" | "new") => api.patch(p(projectId, `/opportunities/${opp.id}`), { status }),
    onSuccess: (_r, status) => {
      toast.success(status === "saved" ? "Saved" : status === "dismissed" ? "Dismissed" : "Restored");
      invalidate();
    },
    onError: (e) => toastError(e),
  });
  const toPost = useMutation({
    mutationFn: (platform: string) => api.post<{ post: { id: string } }>(p(projectId, `/opportunities/${opp.id}/to-post`), { platforms: [platform], useAi: true }),
    onSuccess: (r) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["posts"] });
      toast.success("Draft post created");
      navigate(`/projects/${projectId}/content/${r.post.id}`);
    },
    onError: (e) => toastError(e),
  });
  const toCampaign = useMutation({
    mutationFn: () => api.post<{ campaign: { id: string } }>(p(projectId, `/opportunities/${opp.id}/to-campaign`)),
    onSuccess: (r) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success("Campaign created");
      navigate(`/projects/${projectId}/campaigns/${r.campaign.id}`);
    },
    onError: (e) => toastError(e),
  });

  const defaultPlatform = SOCIAL.includes(opp.platform) ? opp.platform : "x";
  const outline = Array.isArray(opp.outline) ? opp.outline : [];
  const hasStrategy = !!(opp.angle || opp.hook || outline.length || opp.cta || opp.audience);
  const workspaceUrl = `/projects/${projectId}/workspace?prompt=${encodeURIComponent(promptText)}`;
  const askPrompt = `Help me act on this opportunity: “${opp.title}”. ${opp.angle ? `Angle: ${opp.angle}. ` : ""}Sources: ${opp.sources.map((s) => s.url).join(", ")}`;

  return (
    <article className={cn("bg-surface border border-line rounded-xl flex flex-col", opp.status === "used" && "opacity-75")}>
      <div className="px-5 pt-4 pb-3">
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <MethodBadge method={opp.method} />
          {opp.confidence && <Badge tone={CONF_TONE[opp.confidence] ?? "gray"}>{opp.confidence} confidence</Badge>}
          {opp.platform && (
            <span className="inline-flex items-center gap-1 text-[11.5px] text-muted">
              <PlatformIcon platform={opp.platform} size={12} /> {PLATFORM_LABEL[opp.platform] ?? opp.platform}
            </span>
          )}
          <div className="flex-1" />
          {opp.status !== "new" && <StatusBadge status={opp.status} />}
        </div>
        <h3 className="text-[15px] font-semibold text-ink leading-snug">{opp.title}</h3>
        {opp.whatHappened && <p className="text-[13px] text-ink-2 mt-1.5 leading-relaxed">{opp.whatHappened}</p>}
      </div>

      <div className="px-5 pb-4 space-y-3">
        {opp.whyItMatters && <Block label="Why it matters">{opp.whyItMatters}</Block>}
        {opp.relevance && (
          <Block label="Relevance">
            {opp.relevance}
            {opp.relevanceScore > 0 && <span className="text-muted text-[12px]"> ({opp.relevanceScore} keyword match{opp.relevanceScore === 1 ? "" : "es"})</span>}
          </Block>
        )}

        {opp.sources?.length > 0 && (
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.08em] text-faint font-medium mb-1">Sources</div>
            <ul className="space-y-1">
              {opp.sources.map((s) => (
                <li key={s.itemId ?? s.url} className="text-[12.5px] leading-snug">
                  <ExtLink href={s.url} className="text-ink" icon>
                    {s.title}
                  </ExtLink>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted mt-0.5">
                    <span>{s.sourceName}</span>
                    <Dot />
                    <TimeAgo date={s.publishedAt} />
                    <Signals score={s.score} comments={s.comments} source={s.sourceName} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasStrategy && (
          <div className="rounded-lg bg-subtle border border-line">
            <button onClick={() => setExpanded((v) => !v)} className="w-full flex items-center justify-between px-3 py-2 text-left">
              <span className="text-[12px] font-medium text-ink">
                {opp.hook ? <span className="text-ink-2 font-normal italic">“{opp.hook}”</span> : "Content plan"}
              </span>
              <CaretDown size={12} className={cn("text-muted shrink-0 ml-2 transition-transform", expanded && "rotate-180")} />
            </button>
            {expanded && (
              <div className="px-3 pb-3 grid sm:grid-cols-2 gap-3 border-t border-line pt-3">
                {opp.angle && <Block label="Suggested angle">{opp.angle}</Block>}
                {opp.audience && <Block label="Audience">{opp.audience}</Block>}
                {opp.platform && <Block label="Recommended platform">{PLATFORM_LABEL[opp.platform] ?? opp.platform}</Block>}
                {opp.cta && <Block label="Call to action">{opp.cta}</Block>}
                {outline.length > 0 && (
                  <Block label="Outline" className="sm:col-span-2">
                    <ol className="list-decimal pl-4 space-y-0.5">
                      {outline.map((o, i) => (
                        <li key={i}>{o}</li>
                      ))}
                    </ol>
                  </Block>
                )}
              </div>
            )}
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          {opp.timeliness && <Block label="Timeliness">{/^Published \d{4}-/.test(opp.timeliness) ? <TimeAgo date={opp.timeliness.replace("Published ", "")} prefix="Published " /> : opp.timeliness}</Block>}
          {opp.risks && <Block label="Risks">{opp.risks}</Block>}
        </div>
      </div>

      <div className="mt-auto px-4 py-3 border-t border-line flex flex-wrap items-center gap-1.5">
        <DropdownMenu>
          <DropdownTrigger asChild>
            <Button size="sm" variant="primary" loading={toPost.isPending}>
              <Article size={13} weight="bold" /> Create post
            </Button>
          </DropdownTrigger>
          <DropdownContent align="start">
            {SOCIAL.map((pl) => (
              <DropdownItem key={pl} onSelect={() => toPost.mutate(pl)}>
                <PlatformIcon platform={pl} size={13} /> {PLATFORM_LABEL[pl]}
                {pl === defaultPlatform && <span className="ml-auto text-[11px] text-muted">recommended</span>}
              </DropdownItem>
            ))}
          </DropdownContent>
        </DropdownMenu>
        <Button size="sm" loading={toCampaign.isPending} onClick={() => toCampaign.mutate()}>
          <Megaphone size={13} weight="bold" /> Campaign
        </Button>
        <Button size="sm" variant="ghost" onClick={() => navigate(workspaceUrl)} title="Generate an image from the hook in the AI Workspace">
          <ImageSquare size={13} weight="bold" /> Image
        </Button>
        <DropdownMenu>
          <DropdownTrigger asChild>
            <Button size="sm" variant="ghost">
              More <CaretDown size={11} />
            </Button>
          </DropdownTrigger>
          <DropdownContent align="start">
            <DropdownItem onSelect={() => navigate(workspaceUrl)}>
              <PaintBrush size={14} /> Open in AI Workspace
            </DropdownItem>
            <DropdownItem onSelect={() => navigate(`/projects/${projectId}/agents?prompt=${encodeURIComponent(askPrompt)}`)}>
              <Robot size={14} /> Ask AI about this
            </DropdownItem>
          </DropdownContent>
        </DropdownMenu>
        <div className="flex-1" />
        {opp.status === "saved" ? (
          <Button size="icon-sm" variant="ghost" aria-label="Unsave" title="Unsave" onClick={() => setStatus.mutate("new")}>
            <BookmarkSimple size={14} weight="fill" />
          </Button>
        ) : (
          <Button size="icon-sm" variant="ghost" aria-label="Save" title="Save" onClick={() => setStatus.mutate("saved")}>
            <BookmarkSimple size={14} weight="bold" />
          </Button>
        )}
        <Button size="icon-sm" variant="ghost" aria-label="Dismiss" title="Dismiss" onClick={() => setStatus.mutate("dismissed")}>
          <X size={14} weight="bold" />
        </Button>
      </div>
    </article>
  );
}
