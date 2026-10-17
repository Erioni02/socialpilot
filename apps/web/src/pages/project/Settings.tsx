import { CAPABILITIES, type Capability } from "@sp/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { AutonomyControl } from "@/components/AutonomyControl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Skeleton, Switch, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { keys, usePolicy, useProject } from "@/lib/queries";
import type { Policy } from "@/lib/types";

const CAPABILITY_LABELS: Record<Capability, string> = {
  "website.read": "Read website and account data",
  "brand.write": "Edit the brand profile",
  "content.write": "Create content and drafts",
  "asset.edit": "Edit images and videos",
  "social.read": "Read social accounts",
  "social.schedule": "Schedule posts",
  "social.publish": "Publish posts",
  "social.reply": "Reply to comments",
  "code.read": "Read website code",
  "code.write": "Edit website code (on a branch)",
  "code.merge": "Merge code changes",
  "deploy.preview": "Create preview deployments",
  "deploy.production": "Deploy to production",
  "spend.ai": "Spend on AI text models",
  "spend.media": "Spend on image/video generation"
};

const MODES = [
  { value: "allow", label: "Allow" },
  { value: "approve", label: "Needs approval" },
  { value: "deny", label: "Deny" }
];

export function Settings() {
  const { id = "" } = useParams();
  const project = useProject(id);
  const policy = usePolicy(id);
  const queryClient = useQueryClient();
  const [budget, setBudget] = useState<Policy["budget"] | null>(null);
  const [archiving, setArchiving] = useState(false);
  const navigate = useNavigate();
  const archive = useMutation({
    mutationFn: () => api(`/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Project archived");
      void queryClient.invalidateQueries({ queryKey: keys.projects });
      navigate("/");
    },
    onError: (error) => toast.error(error.message)
  });

  useEffect(() => {
    if (policy.data) setBudget(policy.data.budget);
  }, [policy.data]);

  const update = useMutation({
    mutationFn: (body: Partial<Policy>) => api<Policy>(`/projects/${id}/policy`, { method: "PUT", body }),
    onSuccess: (next) => {
      queryClient.setQueryData(keys.policy(id), next);
      void queryClient.invalidateQueries({ queryKey: keys.spend(id) });
      toast.success("Policy saved");
    },
    onError: (error) => toast.error(error.message)
  });

  if (!policy.data || !project.data || !budget) return <Skeleton className="h-96" />;
  const p = policy.data;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">What the AI may do in {project.data.name}. Only you can change these; no AI tool can.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Autonomy level</CardTitle>
        </CardHeader>
        <CardContent>
          <AutonomyControl projectId={id} projectName={project.data.name} policy={p} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Permissions</CardTitle>
          <CardDescription>"Deny" blocks an action for everyone, including you. "Needs approval" makes AI and automations wait in Approvals.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <thead>
              <Tr>
                <Th>Action</Th>
                <Th className="w-48">Rule</Th>
              </Tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((c) => (
                <Tr key={c}>
                  <Td>
                    {CAPABILITY_LABELS[c]} <span className="ml-1 font-mono text-xs text-muted-foreground">{c}</span>
                  </Td>
                  <Td>
                    <Select ariaLabel={`Rule for ${c}`} value={p.permissions[c] ?? "deny"} options={MODES} onValueChange={(mode) => update.mutate({ permissions: { ...p.permissions, [c]: mode as "allow" } })} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Budgets</CardTitle>
          <CardDescription>Tool calls whose estimated cost would exceed these limits are refused (days are UTC).</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              update.mutate({ budget });
            }}
          >
            {(
              [
                ["dailyAiUsd", "Daily AI budget (USD)"],
                ["monthlyAiUsd", "Monthly AI budget (USD)"],
                ["dailyMediaUsd", "Daily media budget (USD)"]
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="grid gap-2">
                <Label htmlFor={key}>{label}</Label>
                <Input id={key} type="number" min={0} step="0.01" value={budget[key]} onChange={(e) => setBudget({ ...budget, [key]: Math.max(0, Number(e.target.value)) })} />
              </div>
            ))}
            <div className="sm:col-span-3">
              <Button type="submit" loading={update.isPending}>
                Save budgets
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Project emergency stop</CardTitle>
          <CardDescription>Blocks every non-read action in this project only. The top-bar button stops all projects.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Switch id="project-stop" checked={p.emergencyStop} onCheckedChange={(checked) => update.mutate({ emergencyStop: checked })} />
          <Label htmlFor="project-stop">{p.emergencyStop ? "Stopped" : "Running"}</Label>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Archive project</CardTitle>
          <CardDescription>Hides the project from your list. Its data, history and audit log are kept.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setArchiving(true)}>
            Archive {project.data.name}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={archiving} onOpenChange={setArchiving}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive {project.data.name}?</DialogTitle>
            <DialogDescription>It disappears from your projects list. Nothing is deleted.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setArchiving(false)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={archive.isPending} onClick={() => archive.mutate()}>
              Archive project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
