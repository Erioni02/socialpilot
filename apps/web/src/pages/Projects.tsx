import { ArrowRight, Globe, Plus, Wand2 } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, Skeleton } from "@/components/ui/primitives";
import { useProjects } from "@/lib/queries";
import type { ProjectListItem } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

function SiteBadge({ snapshot }: { snapshot: ProjectListItem["latestSnapshot"] }) {
  if (!snapshot) return <Badge variant="outline">Not analyzed</Badge>;
  if (snapshot.httpStatus >= 400) return <Badge variant="destructive">HTTP {snapshot.httpStatus}</Badge>;
  return <Badge variant="success">Online · {snapshot.responseMs} ms</Badge>;
}

export function Projects() {
  const projects = useProjects();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 lg:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">One project per business: its website, social accounts, content, analytics and AI agents.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to="/projects/new?from=url">
              <Wand2 /> Create from URL
            </Link>
          </Button>
          <Button asChild>
            <Link to="/projects/new">
              <Plus /> New project
            </Link>
          </Button>
        </div>
      </div>

      {projects.isPending && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      )}

      {projects.isError && <p className="text-sm text-destructive">{projects.error.message}</p>}

      {projects.data?.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <Globe className="size-8 text-muted-foreground" />
            <h2 className="text-lg font-medium">Start with your first business</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              Enter a website URL and SocialPilot crawls it, drafts a brand profile you can edit, and builds a dashboard. Social accounts and other integrations can be connected later.
            </p>
            <Button asChild className="mt-2">
              <Link to="/projects/new?from=url">
                <Wand2 /> Create a project from a URL
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.data?.map((p) => {
          const target = p.status === "draft" ? `/projects/${p.id}/setup` : `/projects/${p.id}`;
          return (
            <Link key={p.id} to={target} className="group min-w-0">
              <Card className="h-full transition-colors group-hover:border-primary/50">
                <CardContent className="flex h-full flex-col gap-3 p-5">
                  <div className="flex flex-wrap items-start gap-3">
                    {p.hasLogo ? (
                      <img src={`/api/projects/${p.id}/logo?v=${encodeURIComponent(p.updatedAt)}`} alt="" className="size-10 rounded-md bg-muted object-contain" />
                    ) : (
                      <span className="grid size-10 place-items-center rounded-md bg-muted text-sm font-semibold uppercase">{p.name.slice(0, 2)}</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-medium">{p.name}</h3>
                      <p className="truncate text-xs text-muted-foreground">{p.websiteUrl ?? "No website yet"}</p>
                    </div>
                    {p.status === "draft" && <Badge variant="warning">Setup step {p.wizardStep}/8</Badge>}
                  </div>
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <SiteBadge snapshot={p.latestSnapshot} />
                    <span className="flex items-center gap-1">
                      {p.latestSnapshot ? `Analyzed ${timeAgo(p.latestSnapshot.fetchedAt)}` : "Open"} <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
