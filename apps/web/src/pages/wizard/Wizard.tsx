import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check } from "lucide-react";
import { Navigate, useNavigate, useParams } from "react-router";
import { Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { keys, useProject } from "@/lib/queries";
import { useProjectEvents } from "@/lib/sse";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { StepAnalyze } from "./StepAnalyze";
import { StepFinish } from "./StepFinish";
import { StepIntegrations } from "./StepIntegrations";
import { StepName } from "./StepName";
import { StepPermissions } from "./StepPermissions";
import { StepProfile } from "./StepProfile";
import { StepProviders } from "./StepProviders";
import { StepUrl } from "./StepUrl";

export const STEPS = ["Name", "Website", "Analyze", "Profile", "Integrations", "AI providers", "Permissions", "Dashboard"];

export type StepProps = { project: Project; next: () => void; back: () => void };

function Stepper({ current, reached, onSelect }: { current: number; reached: number; onSelect: (step: number) => void }) {
  return (
    <ol className="mb-8 flex flex-wrap gap-x-1 gap-y-2">
      {STEPS.map((label, i) => {
        const step = i + 1;
        const done = step < reached;
        return (
          <li key={label}>
            <button
              type="button"
              disabled={step > reached}
              onClick={() => onSelect(step)}
              className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1 text-xs transition-colors disabled:cursor-default disabled:opacity-50",
                step === current ? "bg-primary text-primary-foreground" : done ? "text-foreground hover:bg-accent" : "text-muted-foreground"
              )}
            >
              <span className={cn("grid size-4 place-items-center rounded-full border text-[10px]", step === current && "border-primary-foreground")}>{done ? <Check className="size-3" /> : step}</span>
              {label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Project creation wizard. Progress is saved per step on the project, so it can be resumed later. */
export function Wizard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const project = useProject(id ?? "");
  useProjectEvents(id);

  // `wizardStep` (saved) is the furthest step reached; `view` is the step on screen, so going back never loses progress.
  const [view, setView] = useState<number | null>(null);
  const advance = useMutation({
    mutationFn: (step: number) => api<Project>(`/projects/${id}`, { method: "PATCH", body: { wizardStep: step } }),
    onSuccess: (p) => queryClient.setQueryData(keys.project(p.id), p)
  });

  if (!id) {
    return (
      <Shell current={1} reached={1}>
        <StepName onCreated={(created) => navigate(`/projects/${created.id}/setup`, { replace: true })} />
      </Shell>
    );
  }
  if (project.isError) return <Navigate to="/" replace />;
  if (!project.data) return <Shell current={1} reached={1}><Skeleton className="h-64" /></Shell>;

  const p = project.data;
  const reached = Math.min(Math.max(p.wizardStep, 1), 8);
  const step = Math.min(view ?? reached, reached);
  const props: StepProps = {
    project: p,
    next: () => {
      const target = Math.min(step + 1, 8);
      setView(target);
      if (target > p.wizardStep) advance.mutate(target);
    },
    back: () => setView(Math.max(step - 1, 1))
  };

  return (
    <Shell current={step} reached={reached} onSelect={setView}>
      {step === 1 && <StepName project={p} onCreated={() => props.next()} />}
      {step === 2 && <StepUrl {...props} />}
      {step === 3 && <StepAnalyze {...props} />}
      {step === 4 && <StepProfile {...props} />}
      {step === 5 && <StepIntegrations {...props} />}
      {step === 6 && <StepProviders {...props} />}
      {step === 7 && <StepPermissions {...props} />}
      {step === 8 && <StepFinish {...props} />}
    </Shell>
  );
}

function Shell({ current, reached, onSelect, children }: { current: number; reached: number; onSelect?: (s: number) => void; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">New project</h1>
      <p className="mb-6 text-sm text-muted-foreground">Step {current} of {STEPS.length}: {STEPS[current - 1]}</p>
      <Stepper current={current} reached={reached} onSelect={onSelect ?? (() => {})} />
      {children}
    </div>
  );
}
