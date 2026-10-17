import { IntegrationCards } from "@/components/IntegrationCards";
import { Button } from "@/components/ui/button";
import { Alert, Skeleton } from "@/components/ui/primitives";
import { useIntegrations } from "@/lib/queries";
import type { StepProps } from "./Wizard";

/** Step 5. Honest overview: nothing here can be connected in Cycle 1, and the cards say what each needs. */
export function StepIntegrations({ project, next, back }: StepProps) {
  const integrations = useIntegrations(project.id);
  return (
    <div className="grid gap-4">
      <Alert variant="info">
        Social accounts, analytics, GitHub and deployment connect through each platform's official authorization in later cycles. Your project is fully usable without them; features that need one will tell you.
      </Alert>
      {integrations.data ? <IntegrationCards integrations={integrations.data} /> : <Skeleton className="h-64" />}
      <div className="flex justify-between">
        <Button variant="ghost" onClick={back}>
          Back
        </Button>
        <Button onClick={next}>Continue</Button>
      </div>
    </div>
  );
}
