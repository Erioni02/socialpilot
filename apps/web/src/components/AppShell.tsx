import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, LogOut, Sparkles } from "lucide-react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router";
import { api } from "@/lib/api";
import { useMe, useProjects } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Select } from "./ui/select";
import { EmergencyStop } from "./EmergencyStop";

/** Signed-in frame: top bar (project switcher, AI providers, emergency stop, sign out) + page outlet. */
export function AppShell() {
  const me = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams();
  const projects = useProjects();
  const logout = useMutation({
    mutationFn: () => api("/auth/logout", { method: "POST" }),
    onSettled: () => {
      queryClient.clear();
      navigate("/login");
    }
  });

  if (me.isPending) return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading…</div>;
  if (me.isError) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;

  const projectOptions = (projects.data ?? []).map((p) => ({ value: p.id, label: p.name }));

  return (
    <div className="flex min-h-screen flex-col">
      {me.data.workspace.emergencyStop && (
        <div className="bg-destructive px-4 py-1.5 text-center text-sm font-medium text-destructive-foreground">
          Emergency stop is on: no AI or automation action that changes anything will run until you turn it off.
        </div>
      )}
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <div className="flex h-14 items-center gap-2 px-3 sm:gap-4 lg:px-6">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-7 place-items-center rounded-md bg-primary/15 text-primary">
              <Sparkles className="size-4" />
            </span>
            <span>SocialPilot</span>
          </Link>
          {projectOptions.length > 0 && (
            <div className="hidden w-56 sm:block">
              <Select
                ariaLabel="Switch project"
                value={id && projectOptions.some((p) => p.value === id) ? id : ""}
                onValueChange={(value) => navigate(`/projects/${value}`)}
                options={projectOptions}
              />
            </div>
          )}
          <nav className="ml-auto flex items-center gap-1">
            <NavLink
              to="/settings/ai-providers"
              aria-label="AI providers"
              className={({ isActive }) => cn("inline-flex h-8 items-center gap-2 rounded-md px-2 text-sm sm:px-3 text-muted-foreground hover:bg-accent hover:text-foreground", isActive && "bg-accent text-foreground")}
            >
              <Bot className="size-4" /> <span className="hidden sm:inline">AI providers</span>
            </NavLink>
            <EmergencyStop enabled={me.data.workspace.emergencyStop} />
            <Button variant="ghost" size="icon" aria-label="Sign out" title={`Sign out ${me.data.user.email}`} onClick={() => logout.mutate()} loading={logout.isPending}>
              {!logout.isPending && <LogOut />}
            </Button>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
