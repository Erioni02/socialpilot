import { useParams } from "react-router";
import { ProfileForm } from "@/components/ProfileForm";
import { Card, CardContent, Skeleton } from "@/components/ui/primitives";
import { useProfile } from "@/lib/queries";

export function BrandProfilePage() {
  const { id = "" } = useParams();
  const profile = useProfile(id);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Brand profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">The context every AI action in this project uses. Each save is kept as a version.</p>
      </div>
      <Card>
        <CardContent className="p-6">{profile.isPending ? <Skeleton className="h-96" /> : <ProfileForm projectId={id} profile={profile.data ?? null} />}</CardContent>
      </Card>
    </div>
  );
}
