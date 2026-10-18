import * as React from "react";
import { Link, NavLink, Outlet, useNavigate, useParams, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SquaresFour,
  PaintBrush,
  Article,
  Megaphone,
  CalendarBlank,
  ChatsCircle,
  ChartLineUp,
  Globe,
  Plugs,
  Robot,
  SealCheck,
  Lightning,
  GearSix,
  Compass,
  Bell,
  CaretUpDown,
  Plus,
  SignOut,
  StopCircle,
  Play,
  List,
  FolderSimple,
  Binoculars,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ago, cn, toastError } from "@/lib/utils";
import { useEvents, onServerEvent } from "@/hooks/useEvents";
import { useMe } from "@/components/common";
import { Badge, Button, ConfirmDialog, DropdownContent, DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, DropdownTrigger, Popover, PopoverContent, PopoverTrigger } from "@/components/ui";

const PROJECT_NAV = [
  { to: "", label: "Command center", icon: SquaresFour, end: true },
  { to: "workspace", label: "AI Workspace", icon: PaintBrush },
  { to: "content", label: "Content", icon: Article },
  { to: "campaigns", label: "Campaigns", icon: Megaphone },
  { to: "calendar", label: "Calendar", icon: CalendarBlank },
  { to: "inbox", label: "Inbox", icon: ChatsCircle },
  { to: "analytics", label: "Analytics", icon: ChartLineUp },
  { to: "website", label: "Website", icon: Globe },
  { to: "agents", label: "Agents & tasks", icon: Robot },
  { to: "approvals", label: "Approvals", icon: SealCheck, badge: "approvals" },
  { to: "automations", label: "Automations", icon: Lightning },
  { to: "integrations", label: "Integrations", icon: Plugs },
  { to: "settings", label: "Project settings", icon: GearSix },
];

function ProjectSwitcher({ projectId }: { projectId?: string }) {
  const { data } = useQuery({ queryKey: ["projects"], queryFn: () => api.get<{ projects: any[] }>("/projects") });
  const navigate = useNavigate();
  const current = data?.projects.find((x) => x.id === projectId);
  return (
    <DropdownMenu>
      <DropdownTrigger asChild>
        <button className="w-full flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-black/[0.04] text-left">
          <div className="h-7 w-7 rounded-md bg-ink text-white flex items-center justify-center text-[12px] font-semibold shrink-0 overflow-hidden">
            {current?.logoUrl ? <img src={current.logoUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : (current?.name ?? "S").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-ink truncate">{current?.name ?? "All projects"}</div>
            <div className="text-[11px] text-muted truncate">{current?.websiteUrl?.replace(/^https?:\/\//, "") ?? "SocialPilot"}</div>
          </div>
          <CaretUpDown size={14} className="text-muted shrink-0" />
        </button>
      </DropdownTrigger>
      <DropdownContent align="start" className="w-[240px]">
        <DropdownLabel>Projects</DropdownLabel>
        {data?.projects.map((pr) => (
          <DropdownItem key={pr.id} onSelect={() => navigate(`/projects/${pr.id}`)}>
            <span className="h-5 w-5 rounded bg-canvas border border-line flex items-center justify-center text-[10px] font-semibold">{pr.name.slice(0, 1).toUpperCase()}</span>
            <span className="truncate flex-1">{pr.name}</span>
            {pr._count?.approvals > 0 && <Badge tone="yellow">{pr._count.approvals}</Badge>}
          </DropdownItem>
        ))}
        <DropdownSeparator />
        <DropdownItem onSelect={() => navigate("/")}>
          <FolderSimple size={14} /> All projects
        </DropdownItem>
        <DropdownItem onSelect={() => navigate("/projects/new")}>
          <Plus size={14} /> New project
        </DropdownItem>
      </DropdownContent>
    </DropdownMenu>
  );
}

function Notifications() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ["notifications"], queryFn: () => api.get<{ items: any[]; unread: number }>("/notifications?limit=25"), refetchInterval: 120_000 });
  React.useEffect(
    () =>
      onServerEvent((e) => {
        if (e.type === "notification" && e.data?.title) toast(e.data.title);
      }),
    [],
  );
  const markAll = useMutation({ mutationFn: () => api.post("/notifications/read", { all: true }), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="relative h-8 w-8 rounded-md flex items-center justify-center hover:bg-black/[0.04] text-ink-2" aria-label="Notifications">
          <Bell size={17} />
          {!!data?.unread && <span className="absolute top-1 right-1 h-4 min-w-4 px-1 rounded-full bg-ink text-white text-[9.5px] font-semibold flex items-center justify-center">{data.unread > 9 ? "9+" : data.unread}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-line">
          <span className="text-[13px] font-semibold">Notifications</span>
          <Button size="sm" variant="ghost" onClick={() => markAll.mutate()}>
            Mark all read
          </Button>
        </div>
        <div className="max-h-[420px] overflow-y-auto scrollbar-thin">
          {data?.items.length ? (
            data.items.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  void api.post("/notifications/read", { ids: [n.id] }).then(() => qc.invalidateQueries({ queryKey: ["notifications"] }));
                  if (n.link) navigate(n.link);
                }}
                className={cn("w-full text-left px-4 py-2.5 border-b border-line last:border-0 hover:bg-subtle", !n.read && "bg-blue-bg/30")}
              >
                <div className="text-[12.5px] font-medium text-ink line-clamp-2">{n.title}</div>
                {n.body && <div className="text-[12px] text-muted line-clamp-2 mt-0.5 whitespace-pre-line">{n.body}</div>}
                <div className="text-[11px] text-faint mt-1">{ago(n.createdAt)}</div>
              </button>
            ))
          ) : (
            <div className="px-4 py-8 text-center text-[12.5px] text-muted">No notifications yet.</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EmergencyStop({ active }: { active: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const m = useMutation({
    mutationFn: (v: boolean) => api.post("/system/emergency-stop", { active: v }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["me"] });
      setOpen(false);
      toast[v ? "warning" : "success"](v ? "Emergency stop engaged — all automated and outbound actions are halted." : "Emergency stop lifted.");
    },
    onError: (e) => toastError(e),
  });
  return (
    <>
      {active ? (
        <Button size="sm" variant="danger" onClick={() => m.mutate(false)} loading={m.isPending}>
          <Play size={13} weight="fill" /> Resume operations
        </Button>
      ) : (
        <Button size="sm" variant="danger-ghost" onClick={() => setOpen(true)} className="border border-[#f3cfd1]">
          <StopCircle size={14} weight="fill" /> Emergency stop
        </Button>
      )}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Engage emergency stop?"
        description="Cancels running agent tasks, pauses automations and holds all publishing, replies, merges and deployments across every project until you resume."
        confirmLabel="Stop everything"
        danger
        loading={m.isPending}
        onConfirm={() => m.mutate(true)}
      />
    </>
  );
}

export function AppShell() {
  const { projectId } = useParams();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  useEvents(!!me);
  React.useEffect(() => setMobileOpen(false), [location.pathname]);
  const { data: approvals } = useQuery({
    queryKey: ["approvals", projectId, "count"],
    queryFn: () => api.get<{ approvals: any[] }>(`/projects/${projectId}/approvals?status=pending`),
    enabled: !!projectId,
    refetchInterval: 60_000,
  });
  const logout = async () => {
    await api.post("/auth/logout");
    qc.clear();
    navigate("/login");
  };
  const sidebar = (
    <aside className="flex flex-col h-full w-[248px] shrink-0 border-r border-line bg-[#fbfbfa]">
      <div className="px-2.5 pt-3 pb-2">
        <ProjectSwitcher projectId={projectId} />
      </div>
      <nav className="flex-1 overflow-y-auto scrollbar-thin px-2.5 pb-3">
        {projectId ? (
          <div className="space-y-px">
            {PROJECT_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={`/projects/${projectId}${item.to ? `/${item.to}` : ""}`}
                end={item.end}
                className={({ isActive }) =>
                  cn("flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors", isActive ? "bg-black/[0.055] text-ink font-medium" : "text-ink-2 hover:bg-black/[0.035]")
                }
              >
                <item.icon size={16} weight="bold" className="opacity-80" />
                <span className="flex-1">{item.label}</span>
                {item.badge === "approvals" && !!approvals?.approvals.length && <Badge tone="yellow">{approvals.approvals.length}</Badge>}
              </NavLink>
            ))}
          </div>
        ) : (
          <div className="px-2.5 py-2 text-[12px] text-muted">Open a project to manage its website, social accounts, content and agents.</div>
        )}
        <div className="mt-5 pt-4 border-t border-line space-y-px">
          <NavLink to={projectId ? `/discover?project=${projectId}` : "/discover"} className={({ isActive }) => cn("flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px]", isActive ? "bg-black/[0.055] text-ink font-medium" : "text-ink-2 hover:bg-black/[0.035]")}>
            <Compass size={16} weight="bold" className="opacity-80" /> Discover
          </NavLink>
          <NavLink to="/intel" className={({ isActive }) => cn("flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px]", isActive ? "bg-black/[0.055] text-ink font-medium" : "text-ink-2 hover:bg-black/[0.035]")}>
            <Binoculars size={16} weight="bold" className="opacity-80" /> Social Intel
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => cn("flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px]", isActive ? "bg-black/[0.055] text-ink font-medium" : "text-ink-2 hover:bg-black/[0.035]")}>
            <GearSix size={16} weight="bold" className="opacity-80" /> Settings & AI providers
          </NavLink>
        </div>
      </nav>
      <div className="px-2.5 py-2.5 border-t border-line">
        <DropdownMenu>
          <DropdownTrigger asChild>
            <button className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-black/[0.04] text-left">
              <div className="h-6 w-6 rounded-full bg-canvas border border-line flex items-center justify-center text-[11px] font-semibold">{me?.name?.slice(0, 1).toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium truncate">{me?.name}</div>
                <div className="text-[11px] text-muted truncate">{me?.email}</div>
              </div>
            </button>
          </DropdownTrigger>
          <DropdownContent align="start" side="top">
            <DropdownItem onSelect={() => navigate("/settings")}>
              <GearSix size={14} /> Settings
            </DropdownItem>
            <DropdownItem onSelect={logout}>
              <SignOut size={14} /> Sign out
            </DropdownItem>
          </DropdownContent>
        </DropdownMenu>
      </div>
    </aside>
  );
  return (
    <div className="flex h-full">
      <div className="hidden lg:flex">{sidebar}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/20" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 bg-surface shadow-pop">{sidebar}</div>
        </div>
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-12 shrink-0 border-b border-line bg-canvas/80 backdrop-blur flex items-center gap-2 px-4">
          <button className="lg:hidden h-8 w-8 flex items-center justify-center rounded-md hover:bg-black/[0.04]" onClick={() => setMobileOpen(true)} aria-label="Menu">
            <List size={18} />
          </button>
          <Link to="/" className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden>
              <rect width="32" height="32" rx="7" fill="#111" />
              <path d="M9 21.5 16 8l7 13.5-7-3.6z" fill="#F7F6F3" />
            </svg>
            SocialPilot
          </Link>
          {me?.emergencyStop && <Badge tone="red" dot>Emergency stop active</Badge>}
          <div className="flex-1" />
          <EmergencyStop active={!!me?.emergencyStop} />
          <Notifications />
        </header>
        <main className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
          <PageErrorBoundary key={location.pathname}>
            <Outlet />
          </PageErrorBoundary>
        </main>
      </div>
    </div>
  );
}

/** Contains render errors to the current page and reports them instead of unmounting the app. */
class PageErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <h2 className="serif-title text-[28px]">This page hit an error</h2>
        <p className="text-muted mt-2 text-[13px]">{this.state.error.message}</p>
        <Button className="mt-5" onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </div>
    );
  }
}

export function PageContainer({ children, wide, className }: { children: React.ReactNode; wide?: boolean; className?: string }) {
  return <div className={cn("mx-auto px-6 py-8 animate-enter", wide ? "max-w-[1440px]" : "max-w-6xl", className)}>{children}</div>;
}
