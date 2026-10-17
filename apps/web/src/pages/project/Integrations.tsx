import { useParams } from "react-router";
import { IntegrationCards } from "@/components/IntegrationCards";
import { Alert, Skeleton } from "@/components/ui/primitives";
import { useIntegrations } from "@/lib/queries";

export function IntegrationsPage() {
  const { id = "" } = useParams();
  const integrations = useIntegrations(id);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Integrations</h1>
        <p className="mt-1 text-sm text-muted-foreground">Official OAuth and API connections only. SocialPilot never asks for your social passwords or cookies.</p>
      </div>
      <Alert variant="info">
        Connecting accounts arrives with the cycle shown on each card. Until then this project works with website analysis and its brand profile, and every dashboard panel that would need an integration says so instead of showing made-up numbers.
      </Alert>
      {integrations.data ? <IntegrationCards integrations={integrations.data} /> : <Skeleton className="h-64" />}
    </div>
  );
}
