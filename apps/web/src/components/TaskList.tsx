import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed, Clock, Loader2, OctagonX, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { TaskSummary } from "@/lib/types";
import { timeAgo } from "@/lib/utils";
import { Button } from "./ui/button";

const LABELS: Record<string, string> = {
  "website.analyze": "Website analysis",
  "brand.draftProfile": "Brand profile draft",
  "brand.updateProfile": "Brand profile edit",
  "project.summary": "Project summary",
  "website.fetch": "Page fetch",
  "ai.testProvider": "AI provider test"
};
export const taskLabel = (tool: string) => LABELS[tool] ?? tool;

const ICONS = {
  queued: <Clock className="size-4 text-muted-foreground" />,
  running: <Loader2 className="size-4 animate-spin text-primary" />,
  awaiting_approval: <CircleDashed className="size-4 text-warning" />,
  succeeded: <CheckCircle2 className="size-4 text-success" />,
  failed: <XCircle className="size-4 text-destructive" />,
  cancelled: <OctagonX className="size-4 text-muted-foreground" />
};

export function TaskList({ tasks }: { tasks: TaskSummary[] }) {
  const cancel = useMutation({
    mutationFn: (taskId: string) => api(`/tasks/${taskId}/cancel`, { method: "POST" }),
    onError: (error) => toast.error(error.message)
  });

  if (!tasks.length) return <p className="text-sm text-muted-foreground">No tasks yet. Quick actions and AI work will appear here, live.</p>;

  return (
    <ul className="grid gap-1">
      {tasks.map((t) => (
        <li key={t.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/40">
          {ICONS[t.status]}
          <div className="min-w-0 flex-1">
            <p className="truncate">{taskLabel(t.toolName)}</p>
            {t.error && <p className="truncate text-xs text-destructive" title={t.error}>{t.error}</p>}
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">{t.status.replace("_", " ")} · {timeAgo(t.finishedAt ?? t.startedAt ?? t.createdAt)}</span>
          {(t.status === "queued" || t.status === "running" || t.status === "awaiting_approval") && (
            <Button size="sm" variant="ghost" onClick={() => cancel.mutate(t.id)} loading={cancel.isPending && cancel.variables === t.id}>
              Cancel
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
