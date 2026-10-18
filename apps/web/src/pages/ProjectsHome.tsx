import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Globe, Plus, SealCheck, Article, Robot, FolderSimple, Warning } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { ago, cn, PLATFORM_LABEL } from "@/lib/utils";
import { PageContainer } from "@/components/layout/AppShell";
import { PlatformIcon, SectionTitle, useMe } from "@/components/common";
import { Badge, Button, Card, Empty, Input, PageHeader, Skeleton, Tooltip } from "@/components/ui";

type ProjectRow = {
  id: string;
  name: string;
  websiteUrl: string | null;
  logoUrl: string | null;
  description: string;
  paused: boolean;
  setupComplete: boolean;
  setupStep: number;
  updatedAt: string;
  integrations: { provider: string; status: string; accountHandle: string | null }[];
  _count: { posts: number; tasks: number; approvals: number };
};

function UrlStarter({ autoFocus }: { autoFocus?: boolean }) {
  const [url, setUrl] = React.useState("");
  const navigate = useNavigate();
  const go = () => {
    const v = url.trim();
    if (!v) return;
    navigate(`/projects/new?url=${encodeURIComponent(v)}`);
  };
  return (
    <form
      className="flex flex-col sm:flex-row gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <div className="relative flex-1">
        <Globe size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="yourbusiness.com" className="pl-9 h-10 text-[14px]" autoFocus={autoFocus} aria-label="Website URL" />
      </div>
      <Button type="submit" size="lg" variant="primary" disabled={!url.trim()}>
        Create from website <ArrowRight size={14} weight="bold" />
      </Button>
    </form>
  );
}

const statusTone = (s: string) => (s === "connected" ? "text-ink" : s === "error" || s === "expired" ? "text-red-fg" : "text-faint");

function ProjectCard({ pr }: { pr: ProjectRow }) {
  const host = pr.websiteUrl?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const target = pr.setupComplete ? `/projects/${pr.id}` : `/projects/${pr.id}/setup?step=${Math.max(3, pr.setupStep)}`;
  return (
    <Link to={target} className="group block">
      <Card className="h-full p-5 transition-colors group-hover:border-line-strong flex flex-col">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-canvas border border-line flex items-center justify-center overflow-hidden shrink-0 text-[15px] font-semibold text-ink">
            {pr.logoUrl ? <img src={pr.logoUrl} alt="" className="h-full w-full object-contain p-1" referrerPolicy="no-referrer" /> : pr.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-semibold text-ink truncate">{pr.name}</h3>
              {pr.paused && <Badge tone="yellow">Paused</Badge>}
              {!pr.setupComplete && <Badge tone="blue">Setup {pr.setupStep}/8</Badge>}
            </div>
            <div className="text-[12.5px] text-muted truncate">{host ?? "No website"}</div>
          </div>
          <ArrowRight size={15} className="text-faint group-hover:text-ink transition-colors mt-1" />
        </div>
        {pr.description && <p className="text-[12.5px] text-ink-2 mt-3 line-clamp-2">{pr.description}</p>}
        <div className="flex-1" />
        <div className="mt-4 flex items-center gap-2 min-h-[20px]">
          {pr.integrations.length ? (
            pr.integrations.map((i, idx) => (
              <Tooltip key={`${i.provider}-${idx}`} content={`${PLATFORM_LABEL[i.provider] ?? i.provider}${i.accountHandle ? ` · @${i.accountHandle}` : ""} — ${i.status.replace(/_/g, " ")}`}>
                <span className={cn("inline-flex", statusTone(i.status))}>
                  <PlatformIcon platform={i.provider} size={15} />
                </span>
              </Tooltip>
            ))
          ) : (
            <span className="text-[12px] text-faint">No integrations yet</span>
          )}
        </div>
        <div className="mt-3 pt-3 border-t border-line grid grid-cols-3 gap-2 text-[12px]">
          <div className={cn("flex items-center gap-1.5", pr._count.approvals ? "text-yellow-fg font-medium" : "text-muted")}>
            <SealCheck size={13} weight="bold" /> {pr._count.approvals} pending
          </div>
          <div className="flex items-center gap-1.5 text-muted">
            <Article size={13} weight="bold" /> {pr._count.posts} posts
          </div>
          <div className="flex items-center gap-1.5 text-muted">
            <Robot size={13} weight="bold" /> {pr._count.tasks} tasks
          </div>
        </div>
        <div className="text-[11px] text-faint mt-2">Updated {ago(pr.updatedAt)}</div>
      </Card>
    </Link>
  );
}

export default function ProjectsHome() {
  const [params, setParams] = useSearchParams();
  const { data: me } = useMe();
  const { data, isLoading, error } = useQuery({ queryKey: ["projects"], queryFn: () => api.get<{ projects: ProjectRow[] }>("/projects") });

  React.useEffect(() => {
    const err = params.get("oauth_error");
    if (err) {
      toast.error(`Connection failed: ${err}`);
      params.delete("oauth_error");
      setParams(params, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const projects = data?.projects ?? [];
  const firstName = me?.name?.split(" ")[0];

  return (
    <PageContainer>
      <PageHeader
        eyebrow={firstName ? `Welcome back, ${firstName}` : "SocialPilot"}
        title="Projects"
        description="Each project is one business: its website, social accounts, content, agents and rules."
        actions={
          projects.length > 0 && (
            <Button asChild variant="primary">
              <Link to="/projects/new">
                <Plus size={14} weight="bold" /> New project
              </Link>
            </Button>
          )
        }
      />

      {error ? (
        <Card className="p-6">
          <Empty icon={<Warning size={18} />} title="Could not load projects" description={(error as Error).message} />
        </Card>
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[210px] rounded-xl" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <Card className="px-6 py-14 sm:px-12">
          <div className="max-w-xl mx-auto text-center">
            <div className="mx-auto mb-4 h-11 w-11 rounded-xl bg-canvas border border-line flex items-center justify-center text-muted">
              <FolderSimple size={20} />
            </div>
            <h2 className="serif-title text-[28px] text-ink">Start with your website</h2>
            <p className="text-[13.5px] text-muted mt-2">
              SocialPilot reads your site, proposes a business profile and brand voice, and helps you connect accounts. Nothing is published without your approval.
            </p>
            <div className="mt-6 text-left">
              <UrlStarter autoFocus />
            </div>
            <div className="mt-3">
              <Button asChild variant="link" size="sm">
                <Link to="/projects/new">Or start without a website</Link>
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <Card className="p-4 sm:p-5 mb-8">
            <div className="text-[13px] font-medium text-ink mb-2.5">Create a project from a website URL</div>
            <UrlStarter />
          </Card>
          <SectionTitle>
            {projects.length} project{projects.length === 1 ? "" : "s"}
          </SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((pr) => (
              <ProjectCard key={pr.id} pr={pr} />
            ))}
          </div>
        </>
      )}
    </PageContainer>
  );
}
