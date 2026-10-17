import { useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@/components/ui/primitives";
import { api } from "@/lib/api";

const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/");

export function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api("/auth/login", { method: "POST", body: { email, password } });
      queryClient.clear();
      navigate(safeNext(params.get("next")), { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <span className="mb-2 grid size-10 place-items-center rounded-lg bg-primary/15 text-primary">
            <Sparkles className="size-5" />
          </span>
          <CardTitle className="text-lg">Sign in to SocialPilot</CardTitle>
          <CardDescription>Your AI business and marketing manager.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <Alert variant="destructive">{error}</Alert>}
            <Button type="submit" loading={pending}>
              Sign in
            </Button>
            <p className="text-center text-xs text-muted-foreground">The owner account comes from OWNER_EMAIL / OWNER_PASSWORD in .env (npm run db:seed).</p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
