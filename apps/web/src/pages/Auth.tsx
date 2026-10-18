import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toastError } from "@/lib/utils";
import { Button, Field, Input } from "@/components/ui";

function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="min-h-full flex items-center justify-center px-4 py-16 relative overflow-hidden">
      <div className="pointer-events-none fixed inset-0" style={{ background: "radial-gradient(600px circle at 20% 10%, rgba(225,243,254,0.6), transparent 60%), radial-gradient(500px circle at 85% 90%, rgba(251,243,219,0.5), transparent 60%)" }} />
      <div className="relative w-full max-w-[400px] animate-enter">
        <div className="flex items-center gap-2 mb-8">
          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="7" fill="#111" />
            <path d="M9 21.5 16 8l7 13.5-7-3.6z" fill="#F7F6F3" />
          </svg>
          <span className="text-[15px] font-semibold text-ink">SocialPilot</span>
        </div>
        <h1 className="serif-title text-[40px] text-ink">{title}</h1>
        <p className="text-muted mt-2 mb-8">{subtitle}</p>
        <div className="bg-surface border border-line rounded-xl p-6">{children}</div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: cfg } = useQuery({ queryKey: ["auth-config"], queryFn: () => api.get<{ registrationOpen: boolean; firstUser: boolean }>("/auth/config") });
  React.useEffect(() => {
    if (cfg?.firstUser) navigate("/register");
  }, [cfg, navigate]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/login", { email, password });
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate("/");
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthFrame title="Welcome back" subtitle="Your projects, agents and approvals are waiting.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Button variant="primary" className="w-full" size="lg" loading={loading} type="submit">
          Sign in
        </Button>
      </form>
      {cfg?.registrationOpen && (
        <p className="text-[12.5px] text-muted mt-4 text-center">
          No account? <Link to="/register" className="text-ink underline underline-offset-4">Create one</Link>
        </p>
      )}
    </AuthFrame>
  );
}

export function RegisterPage() {
  const [form, setForm] = React.useState({ name: "", email: "", password: "" });
  const [loading, setLoading] = React.useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: cfg } = useQuery({ queryKey: ["auth-config"], queryFn: () => api.get<{ registrationOpen: boolean; firstUser: boolean }>("/auth/config") });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/register", form);
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate("/projects/new");
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  };
  if (cfg && !cfg.registrationOpen)
    return (
      <AuthFrame title="Registration closed" subtitle="Ask the administrator of this SocialPilot server for an account.">
        <Link to="/login" className="text-ink underline">Back to sign in</Link>
      </AuthFrame>
    );
  return (
    <AuthFrame title={cfg?.firstUser ? "Set up SocialPilot" : "Create your account"} subtitle={cfg?.firstUser ? "Create the owner account for this server." : "Manage every business from one place."}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
        </Field>
        <Field label="Email">
          <Input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </Field>
        <Field label="Password" hint="At least 10 characters.">
          <Input type="password" autoComplete="new-password" minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        </Field>
        <Button variant="primary" className="w-full" size="lg" loading={loading} type="submit">
          Create account
        </Button>
      </form>
      {!cfg?.firstUser && (
        <p className="text-[12.5px] text-muted mt-4 text-center">
          Already registered? <Link to="/login" className="text-ink underline underline-offset-4">Sign in</Link>
        </p>
      )}
    </AuthFrame>
  );
}
