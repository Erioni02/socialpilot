import { useMutation, useQueryClient } from "@tanstack/react-query";
import { OctagonX } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { keys } from "@/lib/queries";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

/** Workspace-wide kill switch. Turning it on blocks every non-read action in executeTool and in the worker. */
export function EmergencyStop({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: (next: boolean) => api("/workspace/emergency-stop", { method: "PUT", body: { enabled: next } }),
    onSuccess: (_data, next) => {
      void queryClient.invalidateQueries({ queryKey: keys.me });
      toast.success(next ? "Emergency stop is on" : "Emergency stop is off");
      setOpen(false);
    },
    onError: (error) => toast.error(error.message)
  });

  return (
    <>
      <Button variant={enabled ? "destructive" : "outline"} size="sm" aria-label="Emergency stop" title="Emergency stop" onClick={() => setOpen(true)}>
        <OctagonX /> <span className="hidden sm:inline">{enabled ? "Stopped" : "Emergency stop"}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{enabled ? "Resume actions?" : "Stop everything?"}</DialogTitle>
            <DialogDescription>
              {enabled
                ? "AI tools, queued jobs and automations will be allowed to run again, within each project's permissions."
                : "Every AI tool, queued job and automation that would change anything will be refused across all projects. Read-only analysis keeps working."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant={enabled ? "default" : "destructive"} loading={toggle.isPending} onClick={() => toggle.mutate(!enabled)}>
              {enabled ? "Turn off emergency stop" : "Turn on emergency stop"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
