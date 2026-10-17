import { Navigate, NavLink, Outlet, useParams } from "react-router";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { useApprovals, useProject } from "@/lib/queries";
import { useProjectEvents } from "@/lib/sse";
import { cn } from "@/lib/utils";
import { SECTIONS } from "./sections";

export function ProjectLayout() {
  const { id = "" } = useParams();
  const project = useProject(id);
  const approvals = useApprovals(id);
  useProjectEvents(project.data ? id : undefined);

  if (project.isError) return <Navigate to="/" replace />;

  const pending = approvals.data?.length ?? 0;

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      <aside className="hidden w-56 shrink-0 border-r px-3 py-5 md:block">
        <div className="mb-4 px-2">
          {project.data ? (
            <>
              <p className="truncate font-medium">{project.data.name}</p>
              <p className="truncate text-xs text-muted-foreground">{project.data.websiteUrl ?? "No website"}</p>
            </>
          ) : (
            <Skeleton className="h-9" />
          )}
        </div>
        <nav className="grid gap-0.5">
          {SECTIONS.map((s) => (
            <NavLink
              key={s.key}
              to={s.key ? `/projects/${id}/${s.key}` : `/projects/${id}`}
              end={!s.key}
              className={({ isActive }) =>
                cn("flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground", isActive && "bg-accent font-medium text-foreground")
              }
            >
              <s.icon className="size-4" />
              <span className="flex-1">{s.label}</span>
              {s.cycle && <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">soon</span>}
              {s.key === "approvals" && pending > 0 && <Badge variant="warning">{pending}</Badge>}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        {/* Mobile section switcher */}
        <nav className="flex gap-1 overflow-x-auto border-b px-3 py-2 md:hidden">
          {SECTIONS.map((s) => (
            <NavLink
              key={s.key}
              to={s.key ? `/projects/${id}/${s.key}` : `/projects/${id}`}
              end={!s.key}
              className={({ isActive }) => cn("whitespace-nowrap rounded-md px-2.5 py-1 text-xs text-muted-foreground", isActive && "bg-accent text-foreground")}
            >
              {s.label}
            </NavLink>
          ))}
        </nav>
        <div className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
