import { AutonomyControl } from "@/components/AutonomyControl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, Skeleton } from "@/components/ui/primitives";
import { usePolicy } from "@/lib/queries";
import type { StepProps } from "./Wizard";

/** Step 7. Autonomy level; detailed permissions and budgets live in project Settings. */
export function StepPermissions({ project, next, back }: StepProps) {
  const policy = usePolicy(project.id);
  return (
    <Card>
      <CardContent className="grid gap-4 p-6">
        <p className="text-sm text-muted-foreground">Start low; you can raise it any time in Settings, where you can also set per-action permissions and AI budgets.</p>
        {policy.data ? <AutonomyControl projectId={project.id} projectName={project.name} policy={policy.data} /> : <Skeleton className="h-64" />}
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
