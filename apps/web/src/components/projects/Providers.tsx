import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowSquareOut, CheckCircle, Key, Trash, WarningCircle } from "@phosphor-icons/react";
import { api, p } from "@/lib/api";
import { ago, cn, toastError } from "@/lib/utils";
import { useMeta } from "@/components/common";
import { Badge, Button, ConfirmDialog, Field, Input, Select, Skeleton, StatusBadge, Tooltip } from "@/components/ui";
import { CustomProviders, type CustomProvider } from "./CustomProviders";

export type ProviderStatus = {
  provider: string;
  configured: boolean;
  source: "user" | "env" | null;
  hint: string | null;
  status: string | null;
  lastTestedAt: string | null;
  lastError: string | null;
  extra?: { accountId?: string; baseUrl?: string } | null;
};

type ExtraField = { key: "accountId" | "baseUrl"; label: string; envVar: string; optional?: boolean; placeholder?: string };

export function useProviders() {
  return useQuery({ queryKey: ["providers"], queryFn: () => api.get<{ providers: ProviderStatus[]; custom: CustomProvider[]; presets: unknown[] }>("/providers") });
}

/**
 * One row per API-key provider (AI or data): status, masked hint, add/replace, test and delete.
 * Secret values are only ever sent, never displayed.
 */
export function ProviderKeyRow({ id, name, description, docsUrl, keyUrl, envVar, status, capabilities, extraFields = [], allowDelete = true }: { id: string; name: string; description?: React.ReactNode; docsUrl?: string; keyUrl?: string; envVar?: string; status?: ProviderStatus; capabilities?: string[]; extraFields?: ExtraField[]; allowDelete?: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState(false);
  const [key, setKey] = React.useState("");
  const [extra, setExtra] = React.useState<Record<string, string>>({});
  const extraValue = (k: "accountId" | "baseUrl") => extra[k] ?? status?.extra?.[k] ?? "";
  const extraValid = extraFields.every((f) => f.optional || extraValue(f.key).trim().length > 0);
  const [testResult, setTestResult] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["providers"] });
    qc.invalidateQueries({ queryKey: ["project"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, string> = { apiKey: key.trim() };
      for (const f of extraFields) {
        const v = extraValue(f.key).trim();
        if (v) body[f.key] = v;
      }
      return api.put(`/providers/${id}`, body);
    },
    onSuccess: async () => {
      setKey("");
      setEditing(false);
      toast.success(`${name} key saved`);
      refresh();
      test.mutate();
    },
    onError: (e) => toastError(e),
  });
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string }>(`/providers/${id}/test`),
    onSuccess: (r) => {
      setTestResult(r);
      if (r.ok) toast.success(`${name}: ${r.message || "Connected"}`);
      else toast.error(`${name}: ${r.message}`);
      qc.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: (e) => toastError(e),
  });
  const del = useMutation({
    mutationFn: () => api.del(`/providers/${id}`),
    onSuccess: () => {
      setConfirmDelete(false);
      setTestResult(null);
      toast.success(`${name} key removed`);
      refresh();
    },
    onError: (e) => toastError(e),
  });
  const configured = !!status?.configured;
  const lastOk = testResult ? testResult.ok : status?.status === "ok";
  const lastErr = testResult && !testResult.ok ? testResult.message : status?.status === "error" ? status.lastError : null;
  return (
    <div className="px-4 py-3.5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-medium text-ink">{name}</span>
            {configured ? (
              status?.source === "env" ? (
                <Tooltip content={envVar ? `Read from the ${envVar} environment variable on the server.` : "Read from the server environment."}>
                  <span>
                    <Badge tone="blue">From env</Badge>
                  </span>
                </Tooltip>
              ) : (
                <Badge tone="green" dot>
                  Key saved
                </Badge>
              )
            ) : (
              <Badge tone="gray">Not configured</Badge>
            )}
            {configured && status?.status && status.status !== "ok" && <StatusBadge status={status.status} />}
            {status?.hint && <span className="font-mono text-[11.5px] text-muted">{status.hint}</span>}
            {status?.extra?.accountId && <span className="font-mono text-[11.5px] text-muted">account {status.extra.accountId.slice(0, 6)}…</span>}
          </div>
          {description && <p className="text-[12px] text-muted mt-0.5">{description}</p>}
          {capabilities && capabilities.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {capabilities.map((c) => (
                <span key={c} className="text-[11px] text-muted border border-line rounded-full px-1.5 py-[0.5px]">
                  {c.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          )}
          {configured && (lastOk || lastErr) && (
            <div className={cn("flex items-start gap-1.5 text-[12px] mt-1.5", lastErr ? "text-red-fg" : "text-green-fg")}>
              {lastErr ? <WarningCircle size={13} className="mt-0.5 shrink-0" /> : <CheckCircle size={13} className="mt-0.5 shrink-0" weight="fill" />}
              <span className="break-words">{lastErr ?? testResult?.message ?? `Verified ${ago(status?.lastTestedAt)}`}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {keyUrl && !configured && (
            <Button asChild size="sm" variant="ghost">
              <a href={keyUrl} target="_blank" rel="noreferrer">
                Get a key <ArrowSquareOut size={12} />
              </a>
            </Button>
          )}
          {docsUrl && (
            <Button asChild size="sm" variant="ghost">
              <a href={docsUrl} target="_blank" rel="noreferrer">
                Docs <ArrowSquareOut size={12} />
              </a>
            </Button>
          )}
          {configured && (
            <Button size="sm" onClick={() => test.mutate()} loading={test.isPending}>
              Test
            </Button>
          )}
          <Button size="sm" variant={configured ? "secondary" : "primary"} onClick={() => setEditing((v) => !v)}>
            <Key size={12} weight="bold" /> {configured ? (status?.source === "user" ? "Replace" : "Override") : "Add key"}
          </Button>
          {allowDelete && status?.source === "user" && (
            <Button size="icon-sm" variant="danger-ghost" onClick={() => setConfirmDelete(true)} aria-label={`Remove ${name} key`}>
              <Trash size={13} />
            </Button>
          )}
        </div>
      </div>
      {editing && (
        <form
          className="mt-3 flex flex-col sm:flex-row gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim().length >= 8 && extraValid) save.mutate();
          }}
        >
          {extraFields.map((f) => (
            <Input
              key={f.key}
              value={extraValue(f.key)}
              onChange={(e) => setExtra((x) => ({ ...x, [f.key]: e.target.value }))}
              placeholder={f.label + (f.optional ? " (optional)" : "")}
              title={f.placeholder}
              className="font-mono sm:max-w-[240px]"
            />
          ))}
          <Input type="password" autoComplete="off" autoFocus value={key} onChange={(e) => setKey(e.target.value)} placeholder={`Paste your ${name} API key`} className="font-mono" />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={save.isPending} disabled={key.trim().length < 8 || !extraValid}>
              Save & test
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Remove the ${name} key?`}
        description={envVar ? `Features using ${name} will stop working unless ${envVar} is set on the server.` : `Features using ${name} will stop working.`}
        confirmLabel="Remove key"
        danger
        loading={del.isPending}
        onConfirm={() => del.mutate()}
      />
    </div>
  );
}

/** AI providers list (keys) — used in the wizard and Settings. */
export function AiProviderKeys({ only }: { only?: string[] }) {
  const { data: meta } = useMeta();
  const { data, isLoading } = useProviders();
  if (!meta || isLoading)
    return (
      <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  const ids = (only ?? Object.keys(meta.aiProviders)).filter((id) => meta.aiProviders[id]);
  return (
    <div className="space-y-4">
    <div className="rounded-xl border border-line bg-surface divide-y divide-line">
      {ids.map((id) => {
        const c = meta.aiProviders[id];
        return <ProviderKeyRow key={id} id={id} name={c.name} docsUrl={c.docsUrl} keyUrl={c.keyUrl} envVar={c.envVar} capabilities={c.capabilities} extraFields={c.extraFields} status={data?.providers.find((x) => x.provider === id)} />;
      })}
    </div>
    {!only && <CustomProviders />}
    </div>
  );
}

type Kind = "text" | "reasoning" | "vision" | "fast" | "image" | "video";
const KIND_LABEL: Record<Kind, string> = { text: "Main AI (agents)", reasoning: "Thinking & planning", vision: "Vision (images & video)", fast: "Fast tasks", image: "Image generation", video: "Video generation" };
const KIND_HELP: Record<Kind, string> = {
  text: "Runs agents and tool calls.",
  reasoning: "Campaign plans, opportunities, audits, insights.",
  vision: "Looks at images and video frames.",
  fast: "Inbox triage and quick classification.",
  image: "Generates and edits images.",
  video: "Generates video clips.",
};
const ROLE_KINDS: Kind[] = ["text", "reasoning", "vision", "fast"];

export type AiConfigValue = Partial<Record<`${Kind}Provider` | `${Kind}Model` | "transcriptionProvider", string | null>>;

/** Project-level choice of provider + model per modality. Model ids are free text (suggestions from the catalog). */
export function AiConfigEditor({ projectId, initial, onSaved, saveLabel = "Save AI configuration", secondaryAction }: { projectId: string; initial: AiConfigValue | null | undefined; onSaved?: () => void; saveLabel?: string; secondaryAction?: React.ReactNode }) {
  const { data: meta } = useMeta();
  const { data: prov } = useProviders();
  const qc = useQueryClient();
  const [value, setValue] = React.useState<AiConfigValue>(() => ({ ...(initial ?? {}) }));
  const initialKey = JSON.stringify(initial ?? {});
  React.useEffect(() => setValue({ ...(initial ?? {}) }), [initialKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => {
      const clean: AiConfigValue = {};
      for (const [k, v] of Object.entries(value)) (clean as any)[k] = v ? String(v).trim() || null : null;
      return api.put(p(projectId, "/ai-config"), clean);
    },
    onSuccess: () => {
      toast.success("AI configuration saved");
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      onSaved?.();
    },
    onError: (e) => toastError(e),
  });
  const nvidiaModels = useQuery({ queryKey: ["providers", "nvidia-models"], queryFn: () => api.get<{ models: string[] }>("/providers/nvidia/models"), staleTime: 3600_000 });
  if (!meta) return <Skeleton className="h-40" />;
  const customs = prov?.custom ?? [];
  const catalog: Record<string, any> = {
    ...meta.aiProviders,
    ...Object.fromEntries(
      customs.map((c) => [
        c.id,
        { id: c.id, name: `${c.name} (custom)`, capabilities: c.capabilities, defaultModels: c.defaultModels, models: c.models.map((m) => ({ id: m.id, kind: m.kind, label: m.id, roles: m.roles })) },
      ]),
    ),
  };
  const configured = (id: string) => customs.some((c) => c.id === id) || !!prov?.providers.find((x) => x.provider === id)?.configured;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface divide-y divide-line">
        {(["text", "reasoning", "vision", "fast", "image", "video"] as Kind[]).map((kind) => {
          const isRole = ROLE_KINDS.includes(kind);
          const capability = kind === "vision" ? "vision" : isRole ? "text" : kind;
          const providers = Object.values(catalog).filter((c: any) => c.capabilities.includes(capability) && (kind !== "text" || c.capabilities.includes("tools")));
          const pk = `${kind}Provider` as const;
          const mk = `${kind}Model` as const;
          const current = value[pk] ?? "";
          const cat = current ? catalog[current] : null;
          const defaultFor = (c: any): string | null => (c?.defaultModels?.[kind] ?? (isRole ? c?.defaultModels?.text : undefined)) ?? null;
          const catalogModels: { id: string; label: string }[] = cat ? cat.models.filter((m: any) => (isRole ? m.kind === "text" && (!m.roles || m.roles.includes(kind)) : m.kind === kind)) : [];
          const models =
            current === "nvidia" && isRole
              ? [...catalogModels, ...(nvidiaModels.data?.models ?? []).filter((id) => !catalogModels.some((m) => m.id === id)).map((id) => ({ id, label: id }))]
              : catalogModels;
          const listId = `models-${kind}`;
          return (
            <div key={kind} className="grid gap-3 sm:grid-cols-[160px_1fr_1fr] items-start px-4 py-3.5">
              <div>
                <div className="text-[13px] font-medium text-ink">{KIND_LABEL[kind]}</div>
                <div className="text-[11.5px] text-muted">{KIND_HELP[kind]}</div>
                {current && !configured(current) && <div className="text-[11.5px] text-yellow-fg mt-0.5">No key for this provider yet</div>}
              </div>
              <Field label="Provider">
                <Select
                  value={current}
                  onChange={(e) => {
                    const np = e.target.value;
                    setValue((s) => ({ ...s, [pk]: np || null, [mk]: np ? defaultFor(catalog[np]) : null }));
                  }}
                >
                  <option value="">{isRole && kind !== "text" ? "Same as main AI" : "Automatic (first configured)"}</option>
                  {providers.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {configured(c.id) ? "" : " — no key"}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Model" hint={cat ? `Default: ${defaultFor(cat) ?? "—"}` : "Pick a provider to choose a model."}>
                <Input list={listId} value={value[mk] ?? ""} disabled={!current} placeholder={defaultFor(cat) ?? "model id"} onChange={(e) => setValue((s) => ({ ...s, [mk]: e.target.value }))} className="font-mono text-[12.5px]" />
                <datalist id={listId}>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </datalist>
              </Field>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-end gap-2">
        {secondaryAction}
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
