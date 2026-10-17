import { Badge, Card, CardContent } from "@/components/ui/primitives";
import type { Integration } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

const STATUS: Record<Integration["status"], { label: string; variant: "outline" | "success" | "warning" | "destructive" }> = {
  not_connected: { label: "Not connected", variant: "outline" },
  needs_setup: { label: "Needs setup", variant: "warning" },
  connected: { label: "Connected", variant: "success" },
  error: { label: "Error", variant: "destructive" },
  revoked: { label: "Revoked", variant: "destructive" }
};

/**
 * Integration status cards. In Cycle 1 no integration can be connected yet, so cards show what each one needs
 * and when it arrives — and no Connect button that would do nothing.
 */
export function IntegrationCards({ integrations }: { integrations: Integration[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {integrations.map((i) => (
        <Card key={i.key}>
          <CardContent className="grid gap-3 p-4">
            <div className="flex items-center gap-2">
              <h3 className="font-medium">{i.label}</h3>
              <Badge variant={STATUS[i.status].variant}>{STATUS[i.status].label}</Badge>
              <Badge variant="secondary" className="ml-auto">
                Cycle {i.cycle}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{i.summary}</p>
            {i.status === "connected" ? (
              <p className="text-xs text-muted-foreground">
                {i.accountLabel} · last sync {timeAgo(i.lastSyncAt)}
              </p>
            ) : (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">You'll need</p>
                <ul className="grid gap-1 text-xs text-muted-foreground">
                  {i.needs.map((n) => (
                    <li key={n}>• {n}</li>
                  ))}
                </ul>
              </div>
            )}
            {i.lastError && <p className="text-xs text-destructive">{i.lastError}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
