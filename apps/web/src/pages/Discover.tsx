import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ArrowsClockwise, Compass, Lightbulb, MagnifyingGlass, Newspaper, Sparkle } from "@phosphor-icons/react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/AppShell";
import { Badge, Button, Card, Empty, PageHeader, Select, Skeleton, Input } from "@/components/ui";
import { SectionTitle } from "@/components/common";
import { api, p } from "@/lib/api";
import { cn, fmtDate, toastError } from "@/lib/utils";
import { Dot, ExtLink, MethodBadge, Signals, TimeAgo } from "@/components/insights/shared";
import { CATEGORY_LABEL, SourcesPanel, useRefreshDiscover } from "@/components/insights/SourcesPanel";
import { OpportunityCard, type Opportunity } from "@/components/insights/OpportunityCard";

type DiscoverItem = {
  id: string;
  sourceType: string;
  sourceName: string;
  title: string;
  url: string;
  summary: string;
  author: string | null;
  publishedAt: string;
  score: number | null;
  comments: number | null;
  category: string;
  tags: string[];
  relevance?: { score: number; matched: string[] };
};

type BriefingItem = {
  itemId: string;
  title: string;
  url: string;
  sourceName: string;
  publishedAt: string;
  score: number | null;
  comments: number | null;
  category: string;
  summary: string;
  whyItMatters: string;
};
type Briefing = { id: string | null; date: string; method: string; createdAt?: string; content: { headline: string; sections: { title: string; items: BriefingItem[] }[] } };

const CATEGORIES = ["all", "ai", "devtools", "startup", "social", "business", "tech"];
const WINDOWS = [
  { v: 24, l: "Last 24 hours" },
  { v: 72, l: "Last 72 hours" },
  { v: 168, l: "Last 7 days" },
];

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ───────────── Briefing ─────────────
function BriefingSection({ projectId }: { projectId?: string }) {
  const qc = useQueryClient();
  const key = ["discover", "briefing", projectId ?? null];
  const qs = projectId ? `?projectId=${projectId}` : "";
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => api.get<{ briefing: Briefing }>(`/discover/briefing${qs}`), staleTime: 5 * 60_000 });
  const regen = useMutation({
    mutationFn: () => api.get<{ briefing: Briefing }>(`/discover/briefing${qs ? `${qs}&` : "?"}regenerate=1`),
    onSuccess: (r) => {
      qc.setQueryData(key, r);
      toast.success("Briefing regenerated");
    },
    onError: (e) => toastError(e),
  });
  const refresh = useRefreshDiscover();
  const b = data?.briefing;
  const sections = b?.content?.sections ?? [];

  return (
    <Card className="overflow-hidden">
      <div className="px-6 pt-5 pb-4 border-b border-line flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
            <Newspaper size={13} weight="bold" /> Daily briefing
            {b?.date && <span className="normal-case tracking-normal text-faint">{fmtDate(`${b.date}T12:00:00`, "EEEE, MMM d")}</span>}
            {b?.method === "ai" && (
              <Badge tone="purple">
                <Sparkle size={10} weight="fill" /> AI briefing
              </Badge>
            )}
            {b?.method === "ranked" && <Badge tone="yellow">Ranked by engagement</Badge>}
          </div>
          {isLoading ? (
            <Skeleton className="h-7 w-3/4 mt-2" />
          ) : (
            <h2 className="serif-title text-[24px] leading-tight text-ink mt-1.5">{b?.content?.headline ?? (error ? "The briefing could not be loaded." : "")}</h2>
          )}
          {b?.method === "ranked" && <p className="text-[12.5px] text-muted mt-1">Ranked by engagement — add an AI provider in Settings for summaries and “why it matters”.</p>}
          {b?.createdAt && <p className="text-[11.5px] text-faint mt-1">Generated <TimeAgo date={b.createdAt} /></p>}
        </div>
        <div className="flex items-center gap-1.5">
          {b?.method === "empty" ? (
            <Button size="sm" variant="primary" loading={refresh.isPending} onClick={() => refresh.mutate()}>
              <ArrowsClockwise size={13} weight="bold" /> Refresh sources
            </Button>
          ) : (
            <Button size="sm" loading={regen.isPending} onClick={() => regen.mutate()} disabled={isLoading}>
              <ArrowsClockwise size={13} weight="bold" /> Regenerate
            </Button>
          )}
        </div>
      </div>
      {isLoading ? (
        <div className="grid md:grid-cols-2 gap-px bg-line">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-surface p-5 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : sections.length ? (
        <div className="grid md:grid-cols-2 gap-px bg-line">
          {sections.map((s) => (
            <section key={s.title} className="bg-surface px-6 py-4">
              <h3 className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium mb-2.5">{s.title}</h3>
              <ol className="space-y-3.5">
                {s.items.map((it) => (
                  <li key={it.itemId}>
                    <ExtLink href={it.url} className="text-[13.5px] font-medium text-ink leading-snug">
                      {it.title}
                    </ExtLink>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted mt-0.5">
                      <span>{it.sourceName}</span>
                      <Dot />
                      <TimeAgo date={it.publishedAt} />
                      <Signals score={it.score} comments={it.comments} source={it.sourceName} className="ml-1" />
                    </div>
                    {it.summary && <p className="text-[12.5px] text-ink-2 mt-1 leading-relaxed line-clamp-3">{it.summary}</p>}
                    {it.whyItMatters && (
                      <p className="text-[12.5px] text-muted mt-1 leading-relaxed">
                        <span className="text-ink-2 font-medium">Why it matters: </span>
                        {it.whyItMatters}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      ) : (
        !isLoading && (
          <Empty icon={<Newspaper size={18} />} title="Nothing to brief yet" description="Discover hasn't fetched any items from the last 36 hours. Refresh sources to load today's developments." />
        )
      )}
    </Card>
  );
}

// ───────────── Opportunities ─────────────
function OpportunitiesSection({ projectId, projectName }: { projectId: string; projectName?: string }) {
  const qc = useQueryClient();
  const [count, setCount] = React.useState(5);
  const [filter, setFilter] = React.useState<"open" | "saved" | "used" | "dismissed">("open");
  const statusParam = filter === "open" ? "" : `?status=${filter}`;
  const { data, isLoading } = useQuery({
    queryKey: ["opportunities", projectId, filter],
    queryFn: () => api.get<{ opportunities: Opportunity[] }>(p(projectId, `/opportunities${statusParam}`)),
  });
  const gen = useMutation({
    mutationFn: () => api.post<{ opportunities: Opportunity[] }>(p(projectId, "/opportunities/generate"), { count }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["opportunities", projectId] });
      if (r.opportunities.length) toast.success(`${r.opportunities.length} opportunit${r.opportunities.length === 1 ? "y" : "ies"} found`);
      else toast.message("No grounded opportunities found", { description: "Nothing in the recent items matched this project closely enough." });
      setFilter("open");
    },
    onError: (e) => toastError(e),
  });
  const list = (data?.opportunities ?? []).filter((o) => (filter === "open" ? o.status !== "used" : true));
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="text-[12px] uppercase tracking-[0.08em] text-muted font-medium">Opportunities for {projectName ?? "this project"}</h2>
          <p className="text-[12.5px] text-muted mt-0.5">Grounded in fetched items only — every opportunity cites its sources.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="h-7 w-auto text-[12px]">
            <option value="open">Open</option>
            <option value="saved">Saved</option>
            <option value="used">Used</option>
            <option value="dismissed">Dismissed</option>
          </Select>
          <Select value={count} onChange={(e) => setCount(Number(e.target.value))} className="h-7 w-auto text-[12px]" aria-label="How many">
            {[3, 5, 8, 10].map((n) => (
              <option key={n} value={n}>
                {n} ideas
              </option>
            ))}
          </Select>
          <Button size="sm" variant="primary" loading={gen.isPending} onClick={() => gen.mutate()}>
            <Lightbulb size={13} weight="bold" /> Find opportunities
          </Button>
        </div>
      </div>
      {isLoading ? (
        <div className="grid lg:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : list.length ? (
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          {list.map((o) => (
            <OpportunityCard key={o.id} projectId={projectId} opp={o} />
          ))}
        </div>
      ) : (
        <Card>
          <Empty
            icon={<Lightbulb size={18} />}
            title={filter === "open" ? "No open opportunities" : `No ${filter} opportunities`}
            description={filter === "open" ? "Find opportunities to connect recent developments to this project. Without an AI provider, keyword matches are shown and labelled as heuristic." : undefined}
            action={
              filter === "open" && (
                <Button size="sm" loading={gen.isPending} onClick={() => gen.mutate()}>
                  <Lightbulb size={13} weight="bold" /> Find opportunities
                </Button>
              )
            }
          />
        </Card>
      )}
    </section>
  );
}

// ───────────── Feed ─────────────
function ItemRow({ item, showRelevance }: { item: DiscoverItem; showRelevance: boolean }) {
  return (
    <li className="px-5 py-4 border-b border-line last:border-0">
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted mb-1">
        <span className="font-medium text-ink-2">{item.sourceName}</span>
        <Dot />
        <TimeAgo date={item.publishedAt} />
        {item.author && (
          <>
            <Dot />
            <span className="truncate max-w-[160px]">{item.author}</span>
          </>
        )}
        <Signals score={item.score} comments={item.comments} source={item.sourceType} className="ml-1" />
      </div>
      <ExtLink href={item.url} className="text-[14px] font-medium text-ink leading-snug" icon>
        {item.title}
      </ExtLink>
      {item.summary && <p className="text-[12.5px] text-ink-2 mt-1 leading-relaxed line-clamp-3">{item.summary}</p>}
      <div className="flex flex-wrap items-center gap-1 mt-2">
        <Badge tone="gray" className="normal-case tracking-normal">
          {CATEGORY_LABEL[item.category] ?? item.category}
        </Badge>
        {item.tags.slice(0, 6).map((t) => (
          <span key={t} className="text-[11px] text-muted border border-line rounded-full px-1.5 py-[0.5px]">
            {t}
          </span>
        ))}
        {showRelevance && item.relevance && (
          <span className="ml-auto inline-flex flex-wrap items-center gap-1 text-[11px]">
            {item.relevance.score > 0 ? (
              <>
                <span className="text-muted">Matches</span>
                {item.relevance.matched.slice(0, 5).map((m) => (
                  <Badge key={m} tone="blue" className="normal-case tracking-normal">
                    {m}
                  </Badge>
                ))}
              </>
            ) : (
              <span className="text-faint">No keyword match</span>
            )}
          </span>
        )}
      </div>
    </li>
  );
}

function Feed({ projectId }: { projectId?: string }) {
  const [category, setCategory] = React.useState("all");
  const [q, setQ] = React.useState("");
  const [hours, setHours] = React.useState(72);
  const dq = useDebounced(q.trim());
  const refresh = useRefreshDiscover();
  const params = new URLSearchParams();
  if (category !== "all") params.set("category", category);
  if (dq) params.set("q", dq);
  params.set("hours", String(hours));
  if (projectId) params.set("projectId", projectId);
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["discover", "items", { category, q: dq, hours, projectId: projectId ?? null }],
    queryFn: () => api.get<{ items: DiscoverItem[] }>(`/discover/items?${params.toString()}`),
    placeholderData: (prev) => prev,
  });
  const items = data?.items ?? [];
  return (
    <div className="min-w-0">
      <div className="border-b border-line mb-4 overflow-x-auto scrollbar-thin">
        <div className="flex items-center gap-0.5 min-w-max">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={cn("px-3 py-2 -mb-px text-[13px] border-b-2 font-medium transition-colors whitespace-nowrap", category === c ? "text-ink border-ink" : "text-muted border-transparent hover:text-ink")}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles and summaries" className="pl-8" maxLength={100} />
        </div>
        <Select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="w-auto">
          {WINDOWS.map((w) => (
            <option key={w.v} value={w.v}>
              {w.l}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-center justify-between text-[11.5px] text-muted mb-2 px-0.5">
        <span>
          {isLoading ? "Loading…" : `${items.length} item${items.length === 1 ? "" : "s"}`}
          {projectId && !isLoading && items.length > 0 && " · sorted by relevance to the selected project"}
        </span>
        {isFetching && !isLoading && <span>Updating…</span>}
      </div>
      <Card>
        {isLoading ? (
          <div className="divide-y divide-line">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-5 py-4 space-y-2">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3 w-full" />
              </div>
            ))}
          </div>
        ) : items.length ? (
          <ul>
            {items.map((it) => (
              <ItemRow key={it.id} item={it} showRelevance={!!projectId} />
            ))}
          </ul>
        ) : (
          <Empty
            icon={<Compass size={18} />}
            title={dq ? `No items match “${dq}”` : "No items in this window"}
            description={dq ? "Try a different search, a wider time window or another category." : "Sources may not have been fetched yet, or nothing was published in this category recently."}
            action={
              <Button size="sm" loading={refresh.isPending} onClick={() => refresh.mutate()}>
                <ArrowsClockwise size={13} weight="bold" /> Refresh sources
              </Button>
            }
          />
        )}
      </Card>
    </div>
  );
}

// ───────────── Page ─────────────
export default function Discover() {
  const [params, setParams] = useSearchParams();
  const projectId = params.get("project") || undefined;
  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: () => api.get<{ projects: { id: string; name: string }[] }>("/projects") });
  const project = projects?.projects.find((x) => x.id === projectId);
  const refresh = useRefreshDiscover();

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Research"
        title="Discover"
        description="Today's developments in AI, developer tools, startups and business — from real sources, with links and upstream signals. Pick a project to rank by relevance and turn news into content."
        actions={
          <>
            <Select
              value={projectId ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setParams(v ? { project: v } : {}, { replace: true });
              }}
              className="w-auto min-w-[180px]"
              aria-label="Project"
            >
              <option value="">All topics (no project)</option>
              {projects?.projects.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.name}
                </option>
              ))}
            </Select>
            <Button loading={refresh.isPending} onClick={() => refresh.mutate()}>
              <ArrowsClockwise size={14} weight="bold" /> Refresh sources
            </Button>
          </>
        }
      />

      <div className="space-y-8">
        <BriefingSection projectId={projectId} />

        {projectId && <OpportunitiesSection projectId={projectId} projectName={project?.name} />}

        <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
          <div className="min-w-0">
            <SectionTitle>
              Latest {project ? <span className="normal-case tracking-normal text-faint ml-1">· relevance to {project.name}</span> : null}
            </SectionTitle>
            <Feed projectId={projectId} />
          </div>
          <div className="lg:sticky lg:top-4 space-y-3 lg:pt-[29px]">
            <SourcesPanel />
            <p className="text-[11.5px] text-faint px-1 leading-relaxed">
              Points, stars and comment counts are the upstream platform's own numbers at fetch time. <MethodBadge method="ai" /> marks AI-written text; everything else is the source's own words.
            </p>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
