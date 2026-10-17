import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardContent, Input, Label } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { keys } from "@/lib/queries";
import type { Project } from "@/lib/types";

/** Step 1. Creates the project (or renames it when resuming). */
export function StepName({ project, onCreated }: { project?: Project; onCreated: (p: Project) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(project?.name ?? "");
  const save = useMutation({
    mutationFn: async () => {
      if (project) return api<Project>(`/projects/${project.id}`, { method: "PATCH", body: { name } });
      const created = await api<Project>("/projects", { method: "POST", body: { name } });
      // Cache the project as it is after moving to step 2, so the wizard opens on the right step.
      return api<Project>(`/projects/${created.id}`, { method: "PATCH", body: { wizardStep: 2 } });
    },
    onSuccess: (p) => {
      queryClient.setQueryData(keys.project(p.id), p);
      void queryClient.invalidateQueries({ queryKey: keys.projects });
      onCreated(p);
    }
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) save.mutate();
  };

  return (
    <Card>
      <CardContent className="p-6">
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor="project-name">Project name</Label>
            <Input id="project-name" autoFocus maxLength={80} placeholder="e.g. VibeJudge" value={name} onChange={(e) => setName(e.target.value)} />
            <p className="text-xs text-muted-foreground">Usually the business or product name. Each project keeps its own data, accounts and AI context.</p>
          </div>
          {save.isError && <Alert variant="destructive">{save.error.message}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" disabled={!name.trim()} loading={save.isPending}>
              Continue
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
