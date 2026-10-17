import { CheckCircle2, CircleAlert, CircleDashed } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, CardContent, Skeleton } from "@/components/ui/primitives";
import { useProviderFallback, useProviders } from "@/lib/queries";
import type { AiProvider } from "@/lib/types";
import { timeAgo } from "@/lib/utils";
import type { StepProps } from "./Wizard";

export function ProviderStatus({ provider }: { provider: AiProvider }) {
  if (!provider.enabled) return <Badge variant="outline">Disabled</Badge>;
  if (!provider.lastTestResult)
    return (
      <Badge variant="outline">
        <CircleDashed className="size-3" /> Not tested
      </Badge>
    );
  return provider.lastTestResult.ok ? (
    <Badge variant="success">
      <CheckCircle2 className="size-3" /> Working · {provider.lastTestResult.ms} ms
    </Badge>
  ) : (
    <Badge variant="destructive" title={provider.lastTestResult.error}>
      <CircleAlert className="size-3" /> Failing
    </Badge>
  );
}

/** Step 6. AI providers are shared by the workspace; they're managed on their own settings page. */
export function StepProviders({ next, back }: StepProps) {
  const providers = useProviders();
  const fallback = useProviderFallback();
  const envNames = fallback.data?.providers.map((p) => p.provider).join(", ");
  return (
    <Card>
      <CardContent className="grid gap-4 p-6">
        <p className="text-sm text-muted-foreground">
          The AI uses these providers in order, failing over between providers, models and keys. Image and video generation providers are added with the AI Workspace in Cycle 2.
        </p>
        {providers.isPending && <Skeleton className="h-20" />}
        {providers.data?.length === 0 && (
          <Alert variant={envNames ? "info" : "warning"}>
            {envNames ? (
              <>No providers are saved here yet; the AI is using keys from <code>.env</code> ({envNames}). Add providers to manage and test them in the app.</>
            ) : (
              <>No AI provider is configured. AI drafting and summaries won't run until you add one (or set keys in <code>.env</code>).</>
            )}
          </Alert>
        )}
        <ul className="grid gap-2">
          {providers.data?.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
              <span className="font-medium capitalize">{p.provider}</span>
              <span className="truncate text-xs text-muted-foreground">{p.models.join(", ")}</span>
              <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                {p.lastTestAt && `tested ${timeAgo(p.lastTestAt)}`}
                <ProviderStatus provider={p} />
              </span>
            </li>
          ))}
        </ul>
        <div>
          <Button variant="outline" asChild>
            <Link to="/settings/ai-providers">Manage AI providers</Link>
          </Button>
        </div>
        <div className="flex justify-between border-t pt-4">
          <Button variant="ghost" onClick={back}>
            Back
          </Button>
          <Button onClick={next}>Continue</Button>
        </div>
      </CardContent>
    </Card>
  );
}
