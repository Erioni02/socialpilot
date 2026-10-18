import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowsClockwise, Plus, Rss, WarningCircle } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { cn, fmtNum, toastError } from "@/lib/utils";
import { Button, Card, CardHeader, Dialog, DialogContent, Field, Input, Select, Skeleton, Switch } from "@/components/ui";
import { TimeAgo } from "./shared";

export type DiscoverSource = {
  id: string;
  type: string;
  name: string;
  url: string | null;
  category: string;
  enabled: boolean;
  lastFetchAt: string | null;
  lastError: string | null;
  itemCount: number;
};

export const TYPE_LABEL: Record<string, string> = { hn: "Hacker News", github: "GitHub", rss: "RSS", newsapi: "NewsAPI", producthunt: "Product Hunt" };
export const CATEGORY_LABEL: Record<string, string> = {
  all: "Top developments",
  ai: "AI models & tools",
  devtools: "Developer ecosystem",
  startup: "Startups & launches",
  social: "Social conversations",
  business: "Business",
  tech: "Technology",
};

export function useRefreshDiscover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ jobId: string }>("/discover/refresh"),
    onSuccess: () => {
      toast.success("Refreshing sources", { description: "New items appear here as soon as the fetch finishes." });
      qc.invalidateQueries({ queryKey: ["discover", "sources"] });
    },
    onError: (e) => toastError(e),
  });
}

function AddFeedDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [category, setCategory] = React.useState("tech");
  React.useEffect(() => {
    if (!open) {
      setName("");
      setUrl("");
      setCategory("tech");
    }
  }, [open]);
  const add = useMutation({
    mutationFn: () => api.post("/discover/sources", { name: name.trim(), url: url.trim(), category }),
    onSuccess: () => {
      toast.success("Feed added", { description: "It will be fetched on the next refresh." });
      qc.invalidateQueries({ queryKey: ["discover", "sources"] });
      onOpenChange(false);
    },
    onError: (e) => toastError(e),
  });
  const valid = name.trim().length >= 2 && /^https:\/\/.+/.test(url.trim());
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add RSS feed"
        description="Any public RSS or Atom feed served over HTTPS. Items are fetched by the background worker."
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!valid} loading={add.isPending} onClick={() => add.mutate()}>
              Add feed
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. The Verge — AI" autoFocus />
          </Field>
          <Field label="Feed URL" hint="Must start with https://" error={url && !/^https:\/\//.test(url.trim()) ? "Feed URL must use HTTPS" : undefined}>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/feed.xml" />
          </Field>
          <Field label="Default category" hint="Items are re-categorized by keywords; this is the fallback.">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {Object.entries(CATEGORY_LABEL)
                .filter(([k]) => k !== "all")
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SourcesPanel() {
  const qc = useQueryClient();
  const [adding, setAdding] = React.useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["discover", "sources"], queryFn: () => api.get<{ sources: DiscoverSource[] }>("/discover/sources") });
  const refresh = useRefreshDiscover();
  const toggle = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => api.patch(`/discover/sources/${v.id}`, { enabled: v.enabled }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["discover", "sources"] });
      const prev = qc.getQueryData<{ sources: DiscoverSource[] }>(["discover", "sources"]);
      if (prev) qc.setQueryData(["discover", "sources"], { sources: prev.sources.map((s) => (s.id === v.id ? { ...s, enabled: v.enabled } : s)) });
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["discover", "sources"], ctx.prev);
      toastError(e);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["discover", "sources"] }),
  });
  const sources = data?.sources ?? [];
  return (
    <Card>
      <CardHeader
        title="Sources"
        description="Where Discover reads from. Nothing is shown that these sources didn't publish."
        action={
          <Button size="icon-sm" variant="ghost" aria-label="Add RSS feed" onClick={() => setAdding(true)}>
            <Plus size={14} weight="bold" />
          </Button>
        }
      />
      <div className="px-5 pb-3">
        <Button size="sm" className="w-full" loading={refresh.isPending} onClick={() => refresh.mutate()}>
          <ArrowsClockwise size={13} weight="bold" /> Refresh now
        </Button>
      </div>
      <div className="border-t border-line">
        {isLoading ? (
          <div className="p-5 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : !sources.length ? (
          <div className="px-5 py-6 text-[12.5px] text-muted text-center">No sources yet. Refresh to seed the default sources.</div>
        ) : (
          <ul>
            {sources.map((s) => {
              const notConfigured = s.lastError?.startsWith("Not configured");
              return (
                <li key={s.id} className={cn("px-5 py-3 border-b border-line last:border-0", !s.enabled && "opacity-60")}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {s.type === "rss" && <Rss size={12} weight="bold" className="text-muted shrink-0" />}
                        <span className="text-[13px] font-medium text-ink truncate">{s.name}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] text-muted">
                        <span>{TYPE_LABEL[s.type] ?? s.type}</span>
                        <span className="text-faint">·</span>
                        <span>{CATEGORY_LABEL[s.category] ?? s.category}</span>
                        <span className="text-faint">·</span>
                        {s.lastFetchAt ? <TimeAgo date={s.lastFetchAt} prefix="fetched " /> : <span>never fetched</span>}
                        {s.lastFetchAt && !s.lastError && (
                          <>
                            <span className="text-faint">·</span>
                            <span className="tabular-nums">{fmtNum(s.itemCount)} items</span>
                          </>
                        )}
                      </div>
                    </div>
                    <Switch checked={s.enabled} onCheckedChange={(v) => toggle.mutate({ id: s.id, enabled: v })} />
                  </div>
                  {s.lastError && (
                    <div className={cn("mt-2 flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11.5px]", notConfigured ? "bg-yellow-bg/70 text-yellow-fg" : "bg-red-bg/70 text-red-fg")}>
                      <WarningCircle size={12} weight="bold" className="mt-[2px] shrink-0" />
                      <span className="min-w-0 break-words">
                        {s.lastError}
                        {notConfigured && (
                          <>
                            {" "}
                            <Link to="/settings" className="underline underline-offset-2">
                              Open settings
                            </Link>
                          </>
                        )}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="px-5 py-3 border-t border-line flex items-center justify-between">
        <span className="text-[11.5px] text-muted">{sources.filter((s) => s.enabled).length} of {sources.length} enabled</span>
        <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
          <Rss size={13} weight="bold" /> Add RSS feed
        </Button>
      </div>
      <AddFeedDialog open={adding} onOpenChange={setAdding} />
    </Card>
  );
}
