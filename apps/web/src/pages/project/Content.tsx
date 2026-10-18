import * as React from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Article, CopySimple, DotsThree, MagnifyingGlass, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/AppShell";
import { Badge, Button, Card, ConfirmDialog, DropdownContent, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger, Empty, Input, PageHeader, Select, Skeleton, StatusBadge, Table, Td, Th } from "@/components/ui";
import { useProject } from "@/components/common";
import { api, p } from "@/lib/api";
import { ago, titleCase, toastError } from "@/lib/utils";
import { fmtTz, PlatformIcons, POST_STATUS_OPTIONS, postLabel, useCampaigns, type Post } from "@/components/content/shared";

export default function Content() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const campaignId = params.get("campaign") ?? "";
  const [search, setSearch] = React.useState(params.get("q") ?? "");
  const [q, setQ] = React.useState(search);
  React.useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const { data: proj } = useProject(projectId);
  const tz = proj?.project?.timezone ?? "UTC";
  const { data: campaigns } = useCampaigns(projectId);
  const filters = { status, campaignId, q };
  const { data, isLoading } = useQuery({
    queryKey: ["posts", projectId, filters],
    queryFn: () => {
      const s = new URLSearchParams();
      if (status) s.set("status", status);
      if (campaignId) s.set("campaignId", campaignId);
      if (q) s.set("q", q);
      return api.get<{ posts: Post[] }>(p(projectId, `/posts?${s.toString()}`));
    },
  });
  const posts = data?.posts ?? [];

  const create = useMutation({
    mutationFn: () => api.post<{ post: Post }>(p(projectId, "/posts"), { title: "", type: "text", body: "", platforms: [], ...(campaignId ? { campaignId } : {}) }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["posts"] });
      navigate(`/projects/${projectId}/content/${r.post.id}`);
    },
    onError: (e) => toastError(e),
  });
  const duplicate = useMutation({
    mutationFn: (id: string) => api.post<{ post: Post }>(p(projectId, `/posts/${id}/duplicate`)),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["posts"] });
      toast.success("Post duplicated", { action: { label: "Open", onClick: () => navigate(`/projects/${projectId}/content/${r.post.id}`) } });
    },
    onError: (e) => toastError(e),
  });
  const [toDelete, setToDelete] = React.useState<Post | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api.del(p(projectId, `/posts/${id}`)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["posts"] });
      qc.invalidateQueries({ queryKey: ["calendar"] });
      setToDelete(null);
      toast.success("Post deleted");
    },
    onError: (e) => toastError(e),
  });

  const counts = React.useMemo(() => {
    const c: Record<string, number> = {};
    posts.forEach((x) => (c[x.status] = (c[x.status] ?? 0) + 1));
    return c;
  }, [posts]);

  return (
    <PageContainer>
      <PageHeader
        title="Content"
        description="Every post across platforms — drafts, reviews, scheduled and published work."
        actions={
          <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
            <Plus size={14} weight="bold" /> New post
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or text" className="pl-8" />
        </div>
        <Select value={status} onChange={(e) => setParam("status", e.target.value)} className="w-44">
          <option value="">All statuses</option>
          {POST_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </Select>
        <Select value={campaignId} onChange={(e) => setParam("campaign", e.target.value)} className="w-48">
          <option value="">All campaigns</option>
          {campaigns?.campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        {(status || campaignId || q) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setParams({}, { replace: true });
            }}
          >
            Clear
          </Button>
        )}
        <div className="flex-1" />
        {!isLoading && (
          <div className="hidden md:flex items-center gap-1.5 text-[12px] text-muted">
            {Object.entries(counts).map(([s, n]) => (
              <span key={s}>
                {n} {s.replace(/_/g, " ")}
              </span>
            )).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, <span key={`d${i}`}>·</span>, el] : [el]), [])}
          </div>
        )}
      </div>

      <Card>
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : !posts.length ? (
          <Empty
            icon={<Article size={18} />}
            title={status || campaignId || q ? "No posts match these filters" : "No posts yet"}
            description={status || campaignId || q ? "Try clearing the filters." : "Create a post, or ask the AI to draft some from the command center."}
            action={
              <Button variant="primary" size="sm" onClick={() => create.mutate()} loading={create.isPending}>
                <Plus size={13} weight="bold" /> New post
              </Button>
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Post</Th>
                <Th>Platforms</Th>
                <Th>Status</Th>
                <Th>Scheduled</Th>
                <Th className="hidden md:table-cell">Campaign</Th>
                <Th className="hidden lg:table-cell">Updated</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.id} className="hover:bg-subtle group">
                  <Td className="max-w-[380px]">
                    <Link to={`/projects/${projectId}/content/${post.id}`} className="block">
                      <div className="text-[13px] font-medium text-ink truncate group-hover:underline underline-offset-2">{postLabel(post)}</div>
                      <div className="text-[12px] text-muted truncate">
                        <span className="mr-1.5">{titleCase(post.type)}</span>
                        {post.title && post.body ? `· ${post.body.slice(0, 90)}` : ""}
                      </div>
                    </Link>
                  </Td>
                  <Td>
                    <PlatformIcons platforms={post.platforms} />
                  </Td>
                  <Td>
                    <StatusBadge status={post.status} />
                    {post.targets?.some((t) => t.status === "failed") && post.status !== "failed" && (
                      <Badge tone="red" className="ml-1">
                        target failed
                      </Badge>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-[12.5px] text-ink-2">{post.scheduledAt ? fmtTz(post.scheduledAt, tz) : <span className="text-faint">—</span>}</Td>
                  <Td className="hidden md:table-cell text-[12.5px]">
                    {post.campaign ? (
                      <Link to={`/projects/${projectId}/campaigns/${post.campaign.id}`} className="text-ink-2 hover:underline underline-offset-2">
                        {post.campaign.name}
                      </Link>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </Td>
                  <Td className="hidden lg:table-cell text-[12px] text-muted whitespace-nowrap">{ago(post.updatedAt)}</Td>
                  <Td>
                    <DropdownMenu>
                      <DropdownTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="Post actions">
                          <DotsThree size={16} weight="bold" />
                        </Button>
                      </DropdownTrigger>
                      <DropdownContent>
                        <DropdownItem onSelect={() => navigate(`/projects/${projectId}/content/${post.id}`)}>
                          <PencilSimple size={14} /> Open editor
                        </DropdownItem>
                        <DropdownItem onSelect={() => duplicate.mutate(post.id)}>
                          <CopySimple size={14} /> Duplicate
                        </DropdownItem>
                        <DropdownSeparator />
                        <DropdownItem danger onSelect={() => setToDelete(post)}>
                          <Trash size={14} /> Delete
                        </DropdownItem>
                      </DropdownContent>
                    </DropdownMenu>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Delete this post?"
        description={toDelete ? `“${postLabel(toDelete)}” and its version history will be removed. Scheduled posts must be unscheduled first.` : undefined}
        confirmLabel="Delete post"
        danger
        loading={del.isPending}
        onConfirm={() => { if (toDelete) del.mutate(toDelete.id); }}
      />
    </PageContainer>
  );
}
