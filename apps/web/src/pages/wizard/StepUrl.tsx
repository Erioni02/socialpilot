import { normalizeSiteUrl } from "@sp/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardContent, Input, Label } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { keys } from "@/lib/queries";
import type { Project } from "@/lib/types";
import type { StepProps } from "./Wizard";

/** Step 2. Same validation as the server (public http/https sites only). */
export function StepUrl({ project, next, back }: StepProps) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState(project.websiteUrl ?? "");
  const [clientError, setClientError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (websiteUrl: string) => api<Project>(`/projects/${project.id}`, { method: "PATCH", body: { websiteUrl } }),
    onSuccess: (p) => {
      queryClient.setQueryData(keys.project(p.id), p);
      next();
    }
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    try {
      const { startUrl } = normalizeSiteUrl(url);
      setClientError(null);
      save.mutate(startUrl);
    } catch (error) {
      setClientError((error as Error).message);
    }
  };

  return (
    <Card>
      <CardContent className="p-6">
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor="website">Website URL</Label>
            <Input id="website" autoFocus placeholder="vibejudge.app" value={url} onChange={(e) => setUrl(e.target.value)} />
            <p className="text-xs text-muted-foreground">SocialPilot reads the publicly accessible pages (it respects robots.txt). It can't edit the live site — that needs a repository connection in Cycle 4.</p>
          </div>
          {(clientError || save.isError) && <Alert variant="destructive">{clientError ?? save.error?.message}</Alert>}
          <div className="flex justify-between">
            <Button type="button" variant="ghost" onClick={back}>
              Back
            </Button>
            <Button type="submit" disabled={!url.trim()} loading={save.isPending}>
              Continue
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
