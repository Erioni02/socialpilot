import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImageUp } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { ProfileForm } from "@/components/ProfileForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { keys, useProfile } from "@/lib/queries";
import type { StepProps } from "./Wizard";

export function LogoUpload({ projectId, hasLogo, version }: { projectId: string; hasLogo: boolean; version: string }) {
  const input = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api(`/projects/${projectId}/logo`, { method: "POST", formData: form });
    },
    onSuccess: () => {
      toast.success("Logo saved");
      void queryClient.invalidateQueries({ queryKey: keys.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: keys.projects });
    },
    onError: (error) => toast.error(error.message)
  });
  return (
    <div className="flex items-center gap-3">
      {hasLogo ? (
        <img src={`/api/projects/${projectId}/logo?v=${encodeURIComponent(version)}`} alt="Project logo" className="size-12 rounded-md bg-muted object-contain" />
      ) : (
        <span className="grid size-12 place-items-center rounded-md border border-dashed text-muted-foreground">
          <ImageUp className="size-5" />
        </span>
      )}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = "";
        }}
      />
      <Button type="button" variant="outline" size="sm" loading={upload.isPending} onClick={() => input.current?.click()}>
        {hasLogo ? "Replace logo" : "Upload logo"}
      </Button>
      <span className="text-xs text-muted-foreground">PNG, JPEG, WebP or GIF up to 5 MB</span>
    </div>
  );
}

/** Step 4. Review and confirm the (AI-drafted or empty) brand profile. */
export function StepProfile({ project, next, back }: StepProps) {
  const profile = useProfile(project.id);
  return (
    <Card>
      <CardContent className="grid gap-6 p-6">
        <LogoUpload projectId={project.id} hasLogo={project.hasLogo} version={project.updatedAt} />
        {profile.isPending ? <Skeleton className="h-96" /> : <ProfileForm projectId={project.id} profile={profile.data ?? null} onConfirmed={next} confirmLabel="Confirm and continue" />}
        <div className="flex justify-between border-t pt-4">
          <Button variant="ghost" onClick={back}>
            Back
          </Button>
          <Button variant="ghost" onClick={next}>
            Skip for now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
