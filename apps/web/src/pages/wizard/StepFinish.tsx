import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard } from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardContent } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { keys, usePolicy, useProfile, useWebsite } from "@/lib/queries";
import type { Project } from "@/lib/types";
import type { StepProps } from "./Wizard";

/** Step 8. Summary, then activate the project and open its dashboard. */
export function StepFinish({ project, back }: StepProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const profile = useProfile(project.id);
  const website = useWebsite(project.id);
  const policy = usePolicy(project.id);

  const finish = useMutation({
    mutationFn: () => api<Project>(`/projects/${project.id}`, { method: "PATCH", body: { status: "active", wizardStep: 8 } }),
    onSuccess: (p) => {
      queryClient.setQueryData(keys.project(p.id), p);
      void queryClient.invalidateQueries({ queryKey: keys.projects });
      navigate(`/projects/${p.id}`);
    }
  });

  const rows: [string, string][] = [
    ["Website", website.data ? `${website.data.pages.length} pages analyzed, ${website.data.issues.length} basic issues` : "Not analyzed yet"],
    ["Brand profile", profile.data ? `v${profile.data.version}${profile.data.confirmedAt ? ", confirmed" : ", not confirmed yet"}` : "Not filled in yet"],
    ["Autonomy", policy.data ? `Level ${policy.data.autonomyLevel}` : "…"],
    ["Integrations", "None connected yet (available from Cycle 2)"]
  ];

  return (
    <Card>
      <CardContent className="grid gap-5 p-6">
        <dl className="grid gap-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b pb-2 last:border-0">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right">{value}</dd>
            </div>
          ))}
        </dl>
        {finish.isError && <Alert variant="destructive">{finish.error.message}</Alert>}
        <div className="flex justify-between">
          <Button variant="ghost" onClick={back}>
            Back
          </Button>
          <Button onClick={() => finish.mutate()} loading={finish.isPending}>
            <LayoutDashboard /> Create dashboard
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
