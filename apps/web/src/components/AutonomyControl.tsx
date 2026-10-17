import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { keys } from "@/lib/queries";
import type { Policy } from "@/lib/types";
import { cn } from "@/lib/utils";

export const LEVELS: { level: 1 | 2 | 3 | 4; name: string; description: string }[] = [
  { level: 1, name: "Assistant", description: "The AI analyzes and recommends. It doesn't create or change anything." },
  { level: 2, name: "Creator", description: "The AI can also create and edit content, images, videos and drafts." },
  { level: 3, name: "Marketing operator", description: "The AI can also schedule content and perform specifically authorized social actions." },
  { level: 4, name: "Controlled autopilot", description: "The AI can research, create, schedule, publish and reply within your limits. Approval rules still apply." }
];

/** Autonomy picker. Raising the level asks you to type the project name (the API enforces the same rule). */
export function AutonomyControl({ projectId, projectName, policy }: { projectId: string; projectName: string; policy: Policy }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<1 | 2 | 3 | 4 | null>(null);
  const [typed, setTyped] = useState("");

  const update = useMutation({
    mutationFn: (body: { autonomyLevel: number; confirmName?: string }) => api<Policy>(`/projects/${projectId}/policy`, { method: "PUT", body }),
    onSuccess: (next) => {
      queryClient.setQueryData(keys.policy(projectId), next);
      toast.success(`Autonomy set to level ${next.autonomyLevel}`);
      setPending(null);
      setTyped("");
    },
    onError: (error) => toast.error(error.message)
  });

  const choose = (level: 1 | 2 | 3 | 4) => {
    if (level === policy.autonomyLevel) return;
    if (level > policy.autonomyLevel) setPending(level);
    else update.mutate({ autonomyLevel: level });
  };

  return (
    <div className="grid gap-2">
      {LEVELS.map((l) => (
        <button
          key={l.level}
          type="button"
          onClick={() => choose(l.level)}
          className={cn(
            "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary/50",
            policy.autonomyLevel === l.level && "border-primary bg-primary/5"
          )}
          aria-pressed={policy.autonomyLevel === l.level}
        >
          <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold", policy.autonomyLevel === l.level && "border-primary bg-primary text-primary-foreground")}>{l.level}</span>
          <span>
            <span className="block text-sm font-medium">{l.name}</span>
            <span className="block text-xs text-muted-foreground">{l.description}</span>
          </span>
        </button>
      ))}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" /> Publishing, replies, merges, production deploys and media spend need your approval by default at every level.
      </p>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Raise autonomy to level {pending}?</DialogTitle>
            <DialogDescription>{LEVELS.find((l) => l.level === pending)?.description} Type the project name to confirm.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="confirm-name">Project name</Label>
            <Input id="confirm-name" autoFocus placeholder={projectName} value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button disabled={typed.trim() !== projectName} loading={update.isPending} onClick={() => pending && update.mutate({ autonomyLevel: pending, confirmName: typed })}>
              Raise to level {pending}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
