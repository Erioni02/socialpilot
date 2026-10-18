import * as React from "react";
import { InstagramLogo, TiktokLogo, XLogo, GithubLogo, ChartLine, TriangleDashed, Globe, Plug, Sparkle, PaperPlaneTilt, Paperclip, X as XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, p } from "@/lib/api";
import { cn, toastError } from "@/lib/utils";
import { Button, Select, Textarea, Badge, Tooltip } from "@/components/ui";

export function PlatformIcon({ platform, size = 16, className }: { platform: string; size?: number; className?: string }) {
  const props = { size, className, weight: "fill" as const };
  switch (platform) {
    case "instagram":
      return <InstagramLogo {...props} />;
    case "tiktok":
      return <TiktokLogo {...props} />;
    case "x":
      return <XLogo {...props} weight="bold" />;
    case "github":
      return <GithubLogo {...props} />;
    case "ga4":
    case "plausible":
      return <ChartLine {...props} weight="bold" />;
    case "vercel":
      return <TriangleDashed {...props} weight="fill" />;
    case "website":
      return <Globe {...props} weight="bold" />;
    default:
      return <Plug {...props} weight="bold" />;
  }
}

export type Meta = {
  integrations: Record<string, any>;
  aiProviders: Record<string, any>;
  dataProviders: Record<string, any>;
  capabilities: Record<string, Record<string, any>>;
  permissions: Record<string, { label: string; description: string }>;
  autonomy: Record<string, { name: string; description: string }>;
  agents: Record<string, { name: string; description: string }>;
  oauthCallbackBase: string;
};
export function useMeta() {
  return useQuery({ queryKey: ["meta"], queryFn: () => api.get<Meta>("/meta"), staleTime: Infinity });
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return (await api.get<{ user: { id: string; email: string; name: string; emergencyStop: boolean } }>("/auth/me")).user;
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

export function useProject(projectId?: string) {
  return useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.get<{ project: any; readiness: any; policy: any; effective: Record<string, { allowed: boolean; requiresApproval: boolean; reason?: string }> }>(p(projectId!)),
    enabled: !!projectId,
  });
}

const AGENT_OPTIONS = [
  ["general", "Operator (all agents)"],
  ["marketing_strategy", "Marketing strategist"],
  ["trend_research", "Trend researcher"],
  ["content_creation", "Content creator"],
  ["image_editing", "Image editor"],
  ["video_creation", "Video creator"],
  ["social_publishing", "Publisher"],
  ["community_management", "Community manager"],
  ["website_audit", "Website auditor"],
  ["website_code", "Website engineer"],
  ["analytics", "Analyst"],
  ["growth_experiments", "Growth experimenter"],
];

/**
 * Natural-language command bar: creates a real agent task that runs in the worker with project-scoped tools.
 * Used on the dashboard, in the workspace and on the agents page.
 */
export function CommandBar({
  projectId,
  defaultAgent = "general",
  placeholder = "Ask the AI to do something — e.g. “Research what's trending, draft 3 posts and generate images for them”",
  attachments = [],
  onClearAttachment,
  onCreated,
  compact,
  presets,
}: {
  projectId: string;
  defaultAgent?: string;
  placeholder?: string;
  attachments?: { id: string; name: string }[];
  onClearAttachment?: (id: string) => void;
  onCreated?: (taskId: string) => void;
  compact?: boolean;
  presets?: string[];
}) {
  const [text, setText] = React.useState("");
  const [agent, setAgent] = React.useState(defaultAgent);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => api.post<{ task: { id: string } }>(p(projectId, "/tasks"), { instruction: text, agentType: agent, attachmentAssetIds: attachments.map((a) => a.id) }),
    onSuccess: (r) => {
      setText("");
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task started", { action: { label: "Open", onClick: () => navigate(`/projects/${projectId}/agents?task=${r.task.id}`) } });
      onCreated?.(r.task.id);
    },
    onError: (e) => toastError(e),
  });
  return (
    <div className="rounded-xl border border-line bg-surface focus-within:border-ink/30 transition-colors">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
          {attachments.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1 rounded-md border border-line bg-canvas px-2 py-0.5 text-[12px]">
              <Paperclip size={12} /> {a.name.slice(0, 30)}
              {onClearAttachment && (
                <button onClick={() => onClearAttachment(a.id)} className="text-muted hover:text-ink" aria-label="Remove attachment">
                  <XIcon size={11} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className={cn("border-0 focus:ring-0 resize-none bg-transparent", compact ? "min-h-[44px]" : "min-h-[72px]")}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim().length >= 3) create.mutate();
        }}
      />
      <div className="flex items-center gap-2 px-3 pb-2.5">
        <Sparkle size={14} className="text-muted" weight="fill" />
        <Select value={agent} onChange={(e) => setAgent(e.target.value)} className="h-7 w-auto text-[12px] py-0">
          {AGENT_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        {presets && (
          <div className="hidden lg:flex items-center gap-1 overflow-hidden">
            {presets.slice(0, 3).map((pr) => (
              <button key={pr} onClick={() => setText(pr)} className="text-[11.5px] text-muted hover:text-ink border border-line rounded-full px-2 py-0.5 truncate max-w-[180px]">
                {pr}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1" />
        <span className="text-[11px] text-faint hidden sm:inline">
          <kbd>Ctrl</kbd> <kbd>Enter</kbd>
        </span>
        <Button variant="primary" size="sm" loading={create.isPending} disabled={text.trim().length < 3} onClick={() => create.mutate()}>
          <PaperPlaneTilt size={13} weight="fill" /> Run
        </Button>
      </div>
    </div>
  );
}

export function CapabilityPill({ available, label, note }: { available: boolean; label: string; note?: string }) {
  return (
    <Tooltip content={note ?? (available ? "Available" : "Unavailable")}>
      <span>
        <Badge tone={available ? "green" : "gray"} className="normal-case tracking-normal text-[11px]">
          {label}
        </Badge>
      </span>
    </Tooltip>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-[12px] uppercase tracking-[0.08em] text-muted font-medium">{children}</h2>
      {action}
    </div>
  );
}

/** Renders a unified diff with added/removed line coloring. */
export function DiffView({ diff, className }: { diff: string; className?: string }) {
  const lines = diff.split("\n");
  return (
    <pre className={cn("font-mono text-[12px] leading-[1.55] bg-subtle border border-line rounded-lg overflow-auto scrollbar-thin max-h-[560px]", className)}>
      {lines.map((l, i) => (
        <div
          key={i}
          className={cn(
            "px-3 whitespace-pre",
            l.startsWith("+++") || l.startsWith("---") ? "text-muted font-medium" : l.startsWith("+") ? "bg-green-bg text-green-fg" : l.startsWith("-") ? "bg-red-bg text-red-fg" : l.startsWith("@@") ? "text-blue-fg bg-blue-bg/50" : l.startsWith("Index:") || l.startsWith("====") ? "text-ink font-semibold bg-canvas" : "",
          )}
        >
          {l || " "}
        </div>
      ))}
    </pre>
  );
}
