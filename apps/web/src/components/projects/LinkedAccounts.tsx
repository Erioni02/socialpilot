import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowsClockwise, Globe, LinkSimple, Trash, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, Input, Tooltip } from "@/components/ui";
import { PlatformIcon } from "@/components/common";
import { api, p } from "@/lib/api";
import { ago, fmtNum, toastError } from "@/lib/utils";
import { useRapidStatus } from "@/components/insights/Audience";

type LinkedAccount = {
  integrationId: string;
  platform: string;
  handle: string | null;
  name: string | null;
  avatar: string | null;
  url: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  stats: { followers?: number; avgER?: number } | null;
  feed: { postCount: number } | null;
};

export function useLinkedAccounts(projectId: string) {
  return useQuery({ queryKey: ["linked-accounts", projectId], queryFn: () => api.get<{ accounts: LinkedAccount[] }>(p(projectId, "/analytics/accounts")) });
}

const PLATFORM_NAME: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", x: "X" };

/** Link social accounts by pasting their profile URL. Read-only analytics — SocialPilot never posts. */
export function LinkedAccountsManager({ projectId, suggestions = [] }: { projectId: string; suggestions?: { platform: string; url: string }[] }) {
  const qc = useQueryClient();
  const accounts = useLinkedAccounts(projectId);
  const rapid = useRapidStatus();
  const [url, setUrl] = React.useState("");
  const [removing, setRemoving] = React.useState<LinkedAccount | null>(null);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["linked-accounts", projectId] });
    qc.invalidateQueries({ queryKey: ["integrations", projectId] });
    qc.invalidateQueries({ queryKey: ["intel", "rapidapi"] });
  };
  const link = useMutation({
    mutationFn: (u: string) => api.post(p(projectId, "/integrations/public-profile"), { url: u }),
    onSuccess: () => {
      setUrl("");
      toast.success("Account linked — analytics are loading");
      invalidate();
      setTimeout(invalidate, 8000);
    },
    onError: (e) => toastError(e),
  });
  const sync = useMutation({
    mutationFn: (id: string) => api.post<{ ok?: boolean; error?: string; skipped?: string; posts?: number }>(p(projectId, `/integrations/${id}/sync`)),
    onSuccess: (r) => {
      if (r.ok) toast.success(`Analytics refreshed${r.posts ? ` — ${r.posts} posts analyzed` : ""}`);
      else toast.error(r.error ?? r.skipped ?? "Nothing refreshed");
      invalidate();
    },
    onError: (e) => toastError(e),
  });
  const unlink = useMutation({
    mutationFn: (id: string) => api.del(p(projectId, `/linked-accounts/${id}`)),
    onSuccess: () => {
      setRemoving(null);
      toast.success("Account unlinked");
      invalidate();
    },
    onError: (e) => toastError(e),
  });
  const list = accounts.data?.accounts ?? [];
  const linkedUrls = new Set(list.map((a) => `${a.platform}:${a.handle}`));
  const open = suggestions.filter((s) => ["instagram", "tiktok", "x"].includes(s.platform) && !linkedUrls.has(`${s.platform}:${s.url.replace(/\/+$/, "").split("/").pop()?.replace("@", "").toLowerCase()}`));
  return (
    <Card>
      <CardHeader
        icon={<LinkSimple size={15} weight="bold" />}
        title="Social accounts"
        description="Paste your Instagram, TikTok or X profile link. SocialPilot reads public analytics only — it never logs in and never posts. You post yourself from Ready to post."
      />
      <CardBody className="space-y-4">
        <form
          className="flex flex-col sm:flex-row gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) link.mutate(url.trim());
          }}
        >
          <div className="relative flex-1">
            <Globe size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.instagram.com/yourbrand" className="pl-8" />
          </div>
          <Button type="submit" variant="primary" loading={link.isPending && link.variables === url.trim()} disabled={!url.trim()}>
            Link account
          </Button>
        </form>
        {open.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-muted">Found on your website:</span>
            {open.map((s) => (
              <button key={s.url} onClick={() => link.mutate(s.url)} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[12px] text-ink-2 hover:border-line-strong hover:text-ink">
                <PlatformIcon platform={s.platform} size={12} /> {s.url.replace(/^https?:\/\/(www\.)?/, "")}
              </button>
            ))}
          </div>
        )}

        {list.length > 0 && (
          <div className="divide-y divide-line rounded-lg border border-line">
            {list.map((a) => (
              <div key={a.integrationId} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                {a.avatar ? <img src={a.avatar} alt="" className="h-8 w-8 rounded-full object-cover border border-line" referrerPolicy="no-referrer" /> : <div className="h-8 w-8 rounded-full border border-line bg-subtle flex items-center justify-center"><PlatformIcon platform={a.platform} size={14} /></div>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[13px] text-ink">
                    <PlatformIcon platform={a.platform} size={12} />
                    <a href={a.url ?? "#"} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                      @{a.handle}
                    </a>
                    {a.name && a.name !== a.handle && <span className="text-muted truncate">· {a.name}</span>}
                  </div>
                  <div className="text-[11.5px] text-muted">
                    {PLATFORM_NAME[a.platform]}
                    {a.stats?.followers != null && ` · ${fmtNum(a.stats.followers)} followers`}
                    {a.feed && ` · ${a.feed.postCount} posts analyzed`}
                    {a.lastSyncAt ? ` · updated ${ago(a.lastSyncAt)}` : " · waiting for first sync"}
                  </div>
                  {a.lastError && (
                    <div className="flex gap-1 text-[11.5px] text-yellow-fg mt-0.5">
                      <Warning size={12} className="shrink-0 mt-0.5" /> {a.lastError}
                    </div>
                  )}
                </div>
                <Badge tone="green">Linked</Badge>
                {rapid.data?.configured && (
                  <Tooltip content={`Refresh stats, audience and post analytics · 2 requests (${rapid.data.budgetLeft} left this month)`}>
                    <span>
                      <Button size="sm" loading={sync.isPending && sync.variables === a.integrationId} disabled={rapid.data.budgetLeft < 2} onClick={() => sync.mutate(a.integrationId)}>
                        <ArrowsClockwise size={12} /> Refresh
                      </Button>
                    </span>
                  </Tooltip>
                )}
                <Button size="icon-sm" variant="danger-ghost" aria-label={`Unlink @${a.handle}`} onClick={() => setRemoving(a)}>
                  <Trash size={13} />
                </Button>
              </div>
            ))}
          </div>
        )}
        {!rapid.data?.configured && (
          <p className="text-[12px] text-muted">
            Account stats, audience and per-post analytics come from the Instagram Statistics API — add a RapidAPI key in Settings → Data sources. Without it, SocialPilot still tracks the posts you publish (TikTok fully, X likes/replies).
          </p>
        )}
      </CardBody>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={`Unlink @${removing?.handle}?`}
        description="Its stored account analytics are removed from this project. Posts you tracked keep their history."
        confirmLabel="Unlink"
        loading={unlink.isPending}
        onConfirm={() => {
          if (removing) unlink.mutate(removing.integrationId);
        }}
      />
    </Card>
  );
}
