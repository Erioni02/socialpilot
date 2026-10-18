import * as React from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChartLineUp, CurrencyDollar } from "@phosphor-icons/react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ago, fmtNum, fmtUsd, toastError } from "@/lib/utils";
import { onServerEvent } from "@/hooks/useEvents";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, Empty, Field, Input, SetupCallout, Skeleton, StatusBadge, Table, Td, Th } from "@/components/ui";

type Report = {
  id: string;
  domain: string;
  status: string;
  maxBudget: number;
  costUsd: number | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  data: { overview: any | null } | null;
};

/**
 * Third-party website traffic estimate (Apify actor). Paid per run, so it never runs automatically:
 * every run needs a confirmation and carries a hard budget cap.
 */
export function TrafficPanel({ projectId, defaultDomain }: { projectId?: string; defaultDomain?: string | null }) {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["intel", "config"], queryFn: () => api.get<{ apifyConfigured: boolean; trafficCostPerDomainUsd: number }>("/intel/config") });
  const reports = useQuery({
    queryKey: ["analytics", "traffic", projectId ?? "all"],
    queryFn: () => api.get<{ reports: Report[] }>(`/intel/traffic${projectId ? `?projectId=${projectId}` : ""}`),
    refetchInterval: (q) => (q.state.data?.reports.some((r) => r.status === "queued" || r.status === "running") ? 4000 : false),
  });
  React.useEffect(
    () =>
      onServerEvent((e) => {
        if (e.type === "traffic.updated") qc.invalidateQueries({ queryKey: ["analytics", "traffic"] });
      }),
    [qc],
  );
  const [domain, setDomain] = React.useState(() => (defaultDomain ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
  const [cap, setCap] = React.useState("0.25");
  const [confirm, setConfirm] = React.useState(false);
  const run = useMutation({
    mutationFn: () => api.post("/intel/traffic", { domain, projectId: projectId ?? null, maxBudgetUsd: Number(cap), confirm: true }),
    onSuccess: () => {
      setConfirm(false);
      toast.success("Traffic report started — usually takes under a minute");
      qc.invalidateQueries({ queryKey: ["analytics", "traffic"] });
    },
    onError: (e) => toastError(e),
  });
  const latest = reports.data?.reports.find((r) => r.status === "completed" && r.data?.overview);
  const o = latest?.data?.overview;
  const est = cfg.data?.trafficCostPerDomainUsd ?? 0.16;
  return (
    <Card>
      <CardHeader
        icon={<ChartLineUp size={15} weight="bold" />}
        title="Website traffic estimate"
        description="Third-party SEO estimate of monthly organic search traffic (Apify · website-traffic-intel). Not measured visits — use GA4 or Plausible for real traffic."
        action={<Badge tone="yellow">Estimated</Badge>}
      />
      <CardBody className="space-y-4">
        {cfg.data && !cfg.data.apifyConfigured ? (
          <SetupCallout title="Apify token not configured" action={<Button asChild size="sm"><Link to="/settings?tab=data">Add token</Link></Button>}>
            Add your Apify API token under Settings → Data sources.
          </SetupCallout>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Domain" className="flex-1 min-w-[200px]">
              <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="vibejudge.app" />
            </Field>
            <Field label="Spend cap (USD)" className="w-[130px]">
              <Input type="number" min={0.17} max={2} step={0.01} value={cap} onChange={(e) => setCap(e.target.value)} />
            </Field>
            <Button variant="primary" disabled={!domain.trim() || Number(cap) < 0.17} onClick={() => setConfirm(true)}>
              <CurrencyDollar size={14} weight="bold" /> Run report (~{fmtUsd(est)})
            </Button>
          </div>
        )}
        {reports.isLoading ? (
          <Skeleton className="h-24" />
        ) : o ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <div className="text-[11.5px] text-muted">Est. monthly organic visits</div>
                <div className="text-[22px] font-semibold text-ink tabular-nums">~{fmtNum(o.estimatedMonthlyOrganicTraffic)}</div>
              </div>
              <div>
                <div className="text-[11.5px] text-muted">Ranking keywords</div>
                <div className="text-[22px] font-semibold text-ink tabular-nums">{fmtNum(o.organicKeywordCount)}</div>
              </div>
              <div>
                <div className="text-[11.5px] text-muted">Est. paid traffic</div>
                <div className="text-[22px] font-semibold text-ink tabular-nums">{o.paidTraffic != null ? `~${fmtNum(o.paidTraffic)}` : "—"}</div>
              </div>
              <div>
                <div className="text-[11.5px] text-muted">Report</div>
                <div className="text-[13px] text-ink mt-1">{latest!.domain}</div>
                <div className="text-[11.5px] text-muted">{ago(latest!.finishedAt)} · cost {latest!.costUsd != null ? fmtUsd(latest!.costUsd) : "see Apify"}</div>
              </div>
            </div>
            {o.dataStatus !== "ok" && <SetupCallout tone="blue" title={`Data status: ${o.dataStatus}`}>The provider has little or no search data for this domain yet (common for new sites).</SetupCallout>}
            {o.topKeywords?.length > 0 && (
              <div>
                <div className="text-[12px] font-medium text-ink mb-1.5">Top organic keywords</div>
                <Table>
                  <thead>
                    <tr>
                      <Th>Keyword</Th>
                      <Th>Position</Th>
                      <Th>Search volume</Th>
                      <Th>Est. traffic</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.topKeywords.slice(0, 10).map((k: any) => (
                      <tr key={k.keyword}>
                        <Td>{k.keyword}</Td>
                        <Td>{k.position ?? "—"}</Td>
                        <Td>{fmtNum(k.searchVolume)}</Td>
                        <Td>{k.trafficEstimate != null ? `~${fmtNum(k.trafficEstimate)}` : "—"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
            {o.topCompetitors?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[12px] text-muted mr-1">Search competitors:</span>
                {o.topCompetitors.slice(0, 8).map((c: any) => (
                  <Badge key={c.domain} tone="gray" className="normal-case tracking-normal">
                    {c.domain}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ) : (
          <Empty title="No traffic report yet" description="Reports run only when you click Run and confirm the cost." />
        )}
        {!!reports.data?.reports.length && (
          <div className="text-[12px] text-muted space-y-1">
            {reports.data.reports.slice(0, 5).map((r) => (
              <div key={r.id} className="flex items-center gap-2">
                <StatusBadge status={r.status} />
                <span>{r.domain}</span>
                <span>· cap {fmtUsd(r.maxBudget)}</span>
                <span>· {ago(r.createdAt)}</span>
                {r.error && <span className="text-red-fg truncate">· {r.error}</span>}
              </div>
            ))}
          </div>
        )}
      </CardBody>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Run a paid traffic report?"
        description={`This runs the Apify actor “website-traffic-intel” for ${domain}. Expected cost ≈ ${fmtUsd(est)} (charged to your Apify account). The run is hard-capped at ${fmtUsd(Number(cap))}.`}
        confirmLabel="Run report"
        loading={run.isPending}
        onConfirm={() => run.mutate()}
      />
    </Card>
  );
}
