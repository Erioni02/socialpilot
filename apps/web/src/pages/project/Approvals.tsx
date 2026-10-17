import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckSquare } from "lucide-react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { taskLabel } from "@/components/TaskList";
import { Button } from "@/components/ui/button";
import { Card, CardContent, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { keys, useApprovals } from "@/lib/queries";
import { timeAgo } from "@/lib/utils";

/** Actions an agent or automation asked to perform that need the owner's decision. */
export function Approvals() {
  const { id = "" } = useParams();
  const approvals = useApprovals(id);
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: ({ approvalId, decision }: { approvalId: string; decision: "approve" | "reject" }) => api(`/approvals/${approvalId}/${decision}`, { method: "POST" }),
    onSuccess: (_d, { decision }) => {
      toast.success(decision === "approve" ? "Approved — the task is queued" : "Rejected");
      void queryClient.invalidateQueries({ queryKey: keys.approvals(id) });
      void queryClient.invalidateQueries({ queryKey: keys.tasks(id) });
    },
    onError: (error) => toast.error(error.message)
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Approvals</h1>
        <p className="mt-1 text-sm text-muted-foreground">Publishing, replies, merges, deploys and spending wait here when an agent or automation requests them.</p>
      </div>
      {approvals.isPending && <Skeleton className="h-32" />}
      {approvals.data?.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <CheckSquare className="size-6" />
            Nothing waiting for approval.
          </CardContent>
        </Card>
      )}
      <div className="grid gap-3">
        {approvals.data?.map((a) => (
          <Card key={a.id}>
            <CardContent className="grid gap-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{taskLabel(a.toolName)}</span>
                <span className="text-xs text-muted-foreground">{a.reason} · requested {timeAgo(a.createdAt)}</span>
              </div>
              <pre className="max-h-64 overflow-auto rounded-md bg-muted/40 p-3 text-xs">{JSON.stringify(a.payload, null, 2)}</pre>
              <p className="text-xs text-muted-foreground">Secrets in the payload are redacted.</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => decide.mutate({ approvalId: a.id, decision: "reject" })} loading={decide.isPending && decide.variables?.approvalId === a.id && decide.variables.decision === "reject"}>
                  Reject
                </Button>
                <Button onClick={() => decide.mutate({ approvalId: a.id, decision: "approve" })} loading={decide.isPending && decide.variables?.approvalId === a.id && decide.variables.decision === "approve"}>
                  Approve
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
