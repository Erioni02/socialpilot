import * as React from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowCounterClockwise, ArrowsClockwise, Info, RocketLaunch, Terminal } from "@phosphor-icons/react";
import { Badge, Button, Card, ConfirmDialog, Dialog, DialogContent, Empty, SetupCallout, Skeleton, StatusBadge, Table, Td, Th } from "@/components/ui";
import { SectionTitle, useProject } from "@/components/common";
import { api, p } from "@/lib/api";
import { ago, fmtDate, toastError } from "@/lib/utils";
import { ExtLink, isSetupError } from "./shared";

type Deployment = { id: string; url: string | null; state: string; target: string; createdAt: string; branch: string | null; commitSha: string | null; commitMessage: string | null; inspectorUrl: string | null };

export function DeploymentsTab({ projectId, vercel }: { projectId: string; vercel: { connected: boolean; projectName?: string } | null }) {
  const qc = useQueryClient();
  const { data: proj } = useProject(projectId);
  const [logsFor, setLogsFor] = React.useState<Deployment | null>(null);
  const [action, setAction] = React.useState<{ dep: Deployment; mode: "promote" | "rollback" } | null>(null);
  const [result, setResult] = React.useState<{ kind: "pending" | "done"; text?: string } | null>(null);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["deployments", projectId],
    queryFn: () => api.get<{ deployments: Deployment[] }>(p(projectId, "/deployments")),
    enabled: !!vercel?.connected,
    refetchInterval: (q) => ((q.state.data as { deployments: Deployment[] } | undefined)?.deployments.some((d) => ["BUILDING", "QUEUED", "INITIALIZING"].includes(d.state)) ? 10_000 : false),
  });
  const promote = useMutation({
    mutationFn: (a: { dep: Deployment; mode: "promote" | "rollback" }) => api.post<{ pendingApproval?: string; ok?: boolean; rollback?: string | null }>(p(projectId, `/deployments/${a.dep.id}/promote`), { mode: a.mode, confirm: true }),
    onSuccess: (r, a) => {
      setAction(null);
      if (r.pendingApproval) {
        toast.success("Sent to the approval queue");
        setResult({ kind: "pending" });
      } else {
        toast.success(a.mode === "rollback" ? "Production rolled back" : "Promoted to production");
        setResult({ kind: "done", text: r.rollback ?? undefined });
      }
      qc.invalidateQueries({ queryKey: ["deployments", projectId] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
    },
    onError: (e) => toastError(e),
  });

  if (!vercel) return <Skeleton className="h-64 rounded-xl" />;
  if (!vercel.connected)
    return (
      <SetupCallout
        title="Connect Vercel to manage deployments"
        action={
          <Button size="sm" asChild>
            <Link to={`/projects/${projectId}/integrations`}>Connect Vercel</Link>
          </Button>
        }
      >
        With a Vercel token, SocialPilot lists preview and production deployments, shows build logs and promotes or rolls back through your approval rules.
      </SetupCallout>
    );

  const deps = data?.deployments ?? [];
  const currentProd = deps.find((d) => d.target === "production" && d.state === "READY");
  const deployEff = proj?.effective?.deploy;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-line bg-surface px-4 py-3 flex gap-3 text-[12.5px] text-ink-2">
        <Info size={16} className="text-muted mt-0.5 shrink-0" />
        <div>
          <span className="font-medium text-ink">Rollback is always possible.</span> Promoting a deployment never deletes previous production deployments — Vercel keeps them, so you can roll back to any earlier READY production build from this list. Merged pull requests are rolled back separately by reverting the merge commit.
        </div>
      </div>

      {result?.kind === "pending" && (
        <SetupCallout
          tone="blue"
          title="Waiting for approval"
          action={
            <Button size="sm" asChild>
              <Link to={`/projects/${projectId}/approvals`}>Open approvals</Link>
            </Button>
          }
        >
          The production change runs once the request is approved.
        </SetupCallout>
      )}
      {result?.kind === "done" && result.text && <SetupCallout tone="blue" title="Done">{result.text}</SetupCallout>}

      <section>
        <SectionTitle
          action={
            <Button size="sm" variant="ghost" onClick={() => refetch()} loading={isFetching && !isLoading}>
              <ArrowsClockwise size={13} /> Refresh
            </Button>
          }
        >
          Deployments{vercel.projectName ? ` · ${vercel.projectName}` : ""}
        </SectionTitle>
        {isLoading ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : error ? (
          <SetupCallout tone={isSetupError(error) ? "yellow" : "red"} title="Could not load deployments">
            {(error as Error).message}
          </SetupCallout>
        ) : !deps.length ? (
          <Card>
            <Empty icon={<RocketLaunch size={18} />} title="No deployments found" description="Connect the GitHub repository to the Vercel project so pushes and pull requests create deployments." />
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <Table>
              <thead>
                <tr>
                  <Th>State</Th>
                  <Th>Target</Th>
                  <Th>Branch / commit</Th>
                  <Th>URL</Th>
                  <Th>Created</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {deps.map((d) => {
                  const isCurrent = d.id === currentProd?.id;
                  return (
                    <tr key={d.id}>
                      <Td>
                        <StatusBadge status={d.state} />
                      </Td>
                      <Td>
                        <div className="flex items-center gap-1.5">
                          <Badge tone={d.target === "production" ? "purple" : "gray"}>{d.target}</Badge>
                          {isCurrent && <Badge tone="green">current</Badge>}
                        </div>
                      </Td>
                      <Td className="max-w-[280px]">
                        <div className="text-[12.5px] font-mono text-ink-2 truncate">
                          {d.branch ?? "—"}
                          {d.commitSha && <span className="text-muted"> @ {d.commitSha.slice(0, 7)}</span>}
                        </div>
                        {d.commitMessage && <div className="text-[12px] text-muted truncate">{d.commitMessage}</div>}
                      </Td>
                      <Td className="max-w-[220px]">{d.url ? <ExtLink href={d.url} className="text-[12px]" /> : <span className="text-muted">—</span>}</Td>
                      <Td className="text-[12px] text-muted whitespace-nowrap" title={fmtDate(d.createdAt)}>
                        {ago(d.createdAt)}
                      </Td>
                      <Td className="text-right whitespace-nowrap">
                        <div className="inline-flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setLogsFor(d)}>
                            <Terminal size={13} /> Logs
                          </Button>
                          {d.state === "READY" && d.target !== "production" && (
                            <Button size="sm" onClick={() => setAction({ dep: d, mode: "promote" })}>
                              <RocketLaunch size={13} /> Promote
                            </Button>
                          )}
                          {d.state === "READY" && d.target === "production" && !isCurrent && (
                            <Button size="sm" onClick={() => setAction({ dep: d, mode: "rollback" })}>
                              <ArrowCounterClockwise size={13} /> Roll back
                            </Button>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        )}
      </section>

      {logsFor && <LogsDialog projectId={projectId} dep={logsFor} onClose={() => setLogsFor(null)} />}

      <ConfirmDialog
        open={!!action}
        onOpenChange={(o) => !o && setAction(null)}
        title={action?.mode === "rollback" ? "Roll back production?" : "Promote to production?"}
        description={action?.dep.url ?? undefined}
        confirmLabel={action?.mode === "rollback" ? "Roll back" : "Promote"}
        danger
        phrase="DEPLOY"
        loading={promote.isPending}
        onConfirm={() => {
          if (action) promote.mutate(action);
        }}
      >
        <ul className="text-[12.5px] text-ink-2 space-y-1.5 list-disc pl-4">
          <li>
            {action?.mode === "rollback" ? "Production will serve this earlier build" : "Production will serve this build"}
            {action?.dep.branch ? ` from ${action.dep.branch}` : ""}
            {action?.dep.commitSha ? ` @ ${action.dep.commitSha.slice(0, 7)}` : ""}.
          </li>
          <li>
            {!deployEff
              ? "The project's approval policy decides whether this happens now or waits in the approval queue."
              : !deployEff.allowed
                ? `Deploying is not currently permitted by the project policy: ${deployEff.reason ?? "permission disabled"}.`
                : deployEff.requiresApproval
                  ? "Project policy requires approval for deploys — this creates an approval request."
                  : "Project policy allows deploys without approval — this takes effect immediately."}
          </li>
          <li>{currentProd ? `The current production deployment (${currentProd.url?.replace(/^https?:\/\//, "")}) is preserved for rollback.` : "Previous production deployments are preserved for rollback."}</li>
        </ul>
      </ConfirmDialog>
    </div>
  );
}

function LogsDialog({ projectId, dep, onClose }: { projectId: string; dep: Deployment; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["deployments", projectId, dep.id, "logs"], queryFn: () => api.get<{ lines: string[] }>(p(projectId, `/deployments/${dep.id}/logs`)) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl" title="Build logs" description={`${dep.url?.replace(/^https?:\/\//, "") ?? dep.id} · last 200 lines`}>
        {isLoading ? (
          <Skeleton className="h-64" />
        ) : error ? (
          <p className="text-[12.5px] text-red-fg">{(error as Error).message}</p>
        ) : !data?.lines.length ? (
          <p className="text-[12.5px] text-muted">No build log lines returned.</p>
        ) : (
          <pre className="font-mono text-[11.5px] leading-[1.5] bg-ink text-[#e8e8e6] rounded-lg p-3 overflow-auto scrollbar-thin max-h-[60vh] whitespace-pre-wrap break-words">{data.lines.join("\n")}</pre>
        )}
        {dep.inspectorUrl && <ExtLink href={dep.inspectorUrl} className="text-[12px] mt-3">Open in Vercel</ExtLink>}
      </DialogContent>
    </Dialog>
  );
}
