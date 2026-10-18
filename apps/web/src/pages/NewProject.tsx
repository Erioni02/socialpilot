import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Globe } from "@phosphor-icons/react";
import { api, p } from "@/lib/api";
import { toastError } from "@/lib/utils";
import { PageContainer } from "@/components/layout/AppShell";
import { Button, Card, Field, Input } from "@/components/ui";
import { WizardProgress } from "@/components/projects/fields";

function normalizeUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const withProto = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withProto);
    if (!u.hostname.includes(".")) return null;
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function nameFromUrl(raw: string): string {
  const n = normalizeUrl(raw);
  if (!n) return "";
  const host = new URL(n).hostname.replace(/^www\./, "");
  const label = host.split(".")[0] ?? "";
  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function NewProject() {
  const [params] = useSearchParams();
  const initialUrl = params.get("url") ?? "";
  const [step, setStep] = React.useState<1 | 2>(1);
  const [name, setName] = React.useState(() => nameFromUrl(initialUrl));
  const [url, setUrl] = React.useState(initialUrl);
  const [nameTouched, setNameTouched] = React.useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const normalized = normalizeUrl(url);
  const urlInvalid = !!url.trim() && !normalized;
  const suggestion = normalized ? nameFromUrl(url) : "";

  const create = useMutation({
    mutationFn: async (withWebsite: boolean) => {
      const r = await api.post<{ project: { id: string } }>("/projects", { name: name.trim(), websiteUrl: withWebsite ? normalized : null });
      await api.patch(p(r.project.id), { setupStep: 3 }).catch(() => undefined);
      return r.project.id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${id}/setup?step=3`);
    },
    onError: (e) => toastError(e),
  });

  return (
    <PageContainer className="max-w-3xl">
      <div className="mb-6">
        <Link to="/" className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink">
          <ArrowLeft size={12} /> All projects
        </Link>
      </div>
      <div className="mb-8">
        <div className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium mb-1">New project</div>
        <h1 className="serif-title text-[34px] text-ink">{step === 1 ? "What should we call it?" : "Where does it live online?"}</h1>
        <p className="text-[13.5px] text-muted mt-1.5">
          {step === 1 ? "Usually the name of the business or product. You can change it later." : "We’ll read your public website to propose a profile and brand voice. This step is optional."}
        </p>
      </div>
      <div className="mb-6">
        <WizardProgress step={step} />
      </div>

      <Card className="p-6">
        {step === 1 ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) setStep(2);
            }}
            className="space-y-5"
          >
            <Field label="Project name">
              <Input
                autoFocus
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameTouched(true);
                }}
                placeholder="e.g. VibeJudge"
                className="h-10 text-[15px]"
                maxLength={120}
              />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" disabled={!name.trim()}>
                Continue <ArrowRight size={13} weight="bold" />
              </Button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (normalized) create.mutate(true);
            }}
            className="space-y-5"
          >
            <Field label="Website URL" error={urlInvalid ? "Enter a valid domain, e.g. example.com" : undefined} hint="Public pages only — nothing behind a login is read.">
              <div className="relative">
                <Globe size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <Input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" className="pl-9 h-10 text-[15px]" />
              </div>
            </Field>
            {suggestion && !nameTouched && suggestion !== name && (
              <div className="text-[12.5px] text-muted">
                Name suggestion from the domain:{" "}
                <button type="button" className="text-ink underline underline-offset-2" onClick={() => setName(suggestion)}>
                  {suggestion}
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => setStep(1)}>
                <ArrowLeft size={13} /> Back
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => create.mutate(false)} loading={create.isPending && create.variables === false} disabled={create.isPending}>
                  Skip — no website
                </Button>
                <Button type="submit" variant="primary" disabled={!normalized || create.isPending} loading={create.isPending && create.variables === true}>
                  Create project <ArrowRight size={13} weight="bold" />
                </Button>
              </div>
            </div>
          </form>
        )}
      </Card>
    </PageContainer>
  );
}
