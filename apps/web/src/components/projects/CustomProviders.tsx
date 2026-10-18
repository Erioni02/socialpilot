import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowSquareOut, CheckCircle, MagnifyingGlass, PencilSimple, Plus, Trash, WarningCircle } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { ago, cn, toastError } from "@/lib/utils";
import { Badge, Button, Checkbox, ConfirmDialog, Dialog, DialogContent, Field, Input, Select, Textarea } from "@/components/ui";
import { useProviders } from "./Providers";
import { ProviderModelSettings } from "./ProviderModelSettings";
import { SlidersHorizontal } from "@phosphor-icons/react";

export type CustomProvider = {
  id: string;
  name: string;
  baseUrl: string;
  capabilities: ("text" | "vision" | "tools" | "image")[];
  models: { id: string; kind: "text" | "image"; roles?: string[] }[];
  defaultModels: Partial<Record<"text" | "reasoning" | "vision" | "fast" | "image", string>>;
  pricing: { inputPer1M?: number; outputPer1M?: number; perImage?: number };
  tokenParam: "max_tokens" | "max_completion_tokens";
  hasKey: boolean;
  hint: string | null;
  status: string | null;
  lastTestedAt: string | null;
  lastError: string | null;
};
type Preset = { label: string; name: string; baseUrl: string; capabilities: CustomProvider["capabilities"]; keyUrl?: string };

const CAPS: { id: CustomProvider["capabilities"][number]; label: string; hint: string }[] = [
  { id: "text", label: "Text", hint: "Chat completions" },
  { id: "tools", label: "Tool calling", hint: "Needed to run agents" },
  { id: "vision", label: "Vision", hint: "Accepts images" },
  { id: "image", label: "Image generation", hint: "/images/generations" },
];
const ROLE_FIELDS = [
  ["text", "Main AI model"],
  ["reasoning", "Thinking model"],
  ["vision", "Vision model"],
  ["fast", "Fast model"],
  ["image", "Image model"],
] as const;

type Form = {
  name: string;
  baseUrl: string;
  apiKey: string;
  capabilities: CustomProvider["capabilities"];
  modelsText: string;
  defaults: Record<string, string>;
  inputPer1M: string;
  outputPer1M: string;
  perImage: string;
  tokenParam: CustomProvider["tokenParam"];
};
const emptyForm: Form = { name: "", baseUrl: "", apiKey: "", capabilities: ["text", "tools"], modelsText: "", defaults: {}, inputPer1M: "", outputPer1M: "", perImage: "", tokenParam: "max_tokens" };

function toForm(c: CustomProvider): Form {
  return {
    name: c.name,
    baseUrl: c.baseUrl,
    apiKey: "",
    capabilities: c.capabilities,
    modelsText: c.models.map((m) => (m.kind === "image" ? `${m.id} [image]` : m.id)).join("\n"),
    defaults: { ...c.defaultModels } as Record<string, string>,
    inputPer1M: c.pricing.inputPer1M?.toString() ?? "",
    outputPer1M: c.pricing.outputPer1M?.toString() ?? "",
    perImage: c.pricing.perImage?.toString() ?? "",
    tokenParam: c.tokenParam,
  };
}

function toPayload(f: Form) {
  const models = f.modelsText
    .split(/\n|,/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => ({ id: l.replace(/\s*\[image\]\s*$/i, "").trim(), kind: /\[image\]\s*$/i.test(l) ? "image" : "text" }));
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
  return {
    name: f.name,
    baseUrl: f.baseUrl,
    ...(f.apiKey.trim() ? { apiKey: f.apiKey.trim() } : {}),
    capabilities: f.capabilities,
    models,
    defaultModels: Object.fromEntries(Object.entries(f.defaults).filter(([, v]) => v?.trim())),
    pricing: { inputPer1M: num(f.inputPer1M), outputPer1M: num(f.outputPer1M), perImage: num(f.perImage) },
    tokenParam: f.tokenParam,
  };
}

function ProviderDialog({ open, onOpenChange, editing, presets }: { open: boolean; onOpenChange: (v: boolean) => void; editing: CustomProvider | null; presets: Preset[] }) {
  const qc = useQueryClient();
  const [f, setF] = React.useState<Form>(emptyForm);
  const [discovered, setDiscovered] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (open) {
      setF(editing ? toForm(editing) : emptyForm);
      setDiscovered([]);
    }
  }, [open, editing]);
  const save = useMutation({
    mutationFn: () => (editing ? api.put<{ id: string }>(`/providers/custom/${encodeURIComponent(editing.id)}`, toPayload(f)) : api.post<{ id: string }>("/providers/custom", toPayload(f))),
    onSuccess: async (r) => {
      toast.success(`${f.name} saved`);
      qc.invalidateQueries({ queryKey: ["providers"] });
      qc.invalidateQueries({ queryKey: ["project"] });
      onOpenChange(false);
      const t = await api.post<{ ok: boolean; message: string }>(`/providers/${encodeURIComponent(r.id)}/test`).catch(() => null);
      if (t) toast[t.ok ? "success" : "warning"](`${f.name}: ${t.message}`);
      qc.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: (e) => toastError(e),
  });
  const discover = useMutation({
    mutationFn: async () => {
      const id = editing?.id;
      if (!id) throw new Error("Save the provider first, then fetch its model list.");
      return api.get<{ models: string[] }>(`/providers/custom/${encodeURIComponent(id)}/models`);
    },
    onSuccess: (r) => {
      setDiscovered(r.models);
      toast.success(`${r.models.length} models found`);
    },
    onError: (e) => toastError(e),
  });
  const models = f.modelsText
    .split(/\n|,/)
    .map((l) => l.replace(/\s*\[image\]\s*$/i, "").trim())
    .filter(Boolean);
  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }));
  const valid = f.name.trim().length >= 2 && /^https?:\/\//.test(f.baseUrl.trim()) && f.capabilities.length > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl"
        title={editing ? `Edit ${editing.name}` : "Add a custom AI provider"}
        description="Any OpenAI-compatible API works: OpenRouter, Groq, Together, DeepSeek, Mistral, xAI, Fireworks, a self-hosted vLLM, Ollama or LM Studio."
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
              Save & test
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {!editing && (
            <Field label="Start from a preset (optional)">
              <Select
                defaultValue=""
                onChange={(e) => {
                  const p = presets.find((x) => x.label === e.target.value);
                  if (p) set({ name: p.name, baseUrl: p.baseUrl, capabilities: p.capabilities });
                }}
              >
                <option value="">Custom / other</option>
                {presets.map((p) => (
                  <option key={p.label} value={p.label}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Name">
              <Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="OpenRouter" />
            </Field>
            <Field label="Base URL" hint="The part before /chat/completions">
              <Input value={f.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://openrouter.ai/api/v1" className="font-mono text-[12.5px]" />
            </Field>
          </div>
          <Field label="API key" hint={editing ? (editing.hasKey ? `Stored (${editing.hint}). Leave blank to keep it.` : "No key stored.") : "Leave empty for local servers that don't need one (Ollama, LM Studio)."}>
            <Input type="password" autoComplete="off" value={f.apiKey} onChange={(e) => set({ apiKey: e.target.value })} className="font-mono" placeholder={editing?.hasKey ? "••••••••" : "sk-…"} />
          </Field>
          <Field label="What it can do">
            <div className="grid grid-cols-2 gap-2">
              {CAPS.map((c) => (
                <Checkbox
                  key={c.id}
                  checked={f.capabilities.includes(c.id)}
                  onCheckedChange={(v) => set({ capabilities: v ? [...new Set([...f.capabilities, c.id])] : f.capabilities.filter((x) => x !== c.id) })}
                  label={
                    <span>
                      {c.label} <span className="text-muted text-[11.5px]">— {c.hint}</span>
                    </span>
                  }
                />
              ))}
            </div>
          </Field>
          <Field
            label="Models"
            hint="One model id per line, exactly as the provider names it. Add [image] after image models."
          >
            <Textarea value={f.modelsText} onChange={(e) => set({ modelsText: e.target.value })} placeholder={"meta-llama/llama-3.3-70b-instruct\nqwen/qwen3-235b-a22b\nblack-forest-labs/flux-schnell [image]"} className="font-mono text-[12.5px] min-h-[96px]" />
          </Field>
          {editing && (
            <div className="space-y-2">
              <Button size="sm" onClick={() => discover.mutate()} loading={discover.isPending}>
                <MagnifyingGlass size={13} /> Fetch model list from provider
              </Button>
              {discovered.length > 0 && (
                <div className="max-h-40 overflow-y-auto scrollbar-thin rounded-md border border-line p-2 flex flex-wrap gap-1">
                  {discovered.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => !models.includes(m) && set({ modelsText: (f.modelsText.trim() ? f.modelsText.trim() + "\n" : "") + m })}
                      className={cn("text-[11.5px] font-mono border border-line rounded px-1.5 py-0.5", models.includes(m) ? "bg-green-bg text-green-fg" : "hover:bg-canvas")}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            {ROLE_FIELDS.filter(([k]) => (k === "image" ? f.capabilities.includes("image") : k === "vision" ? f.capabilities.includes("vision") : f.capabilities.includes("text"))).map(([k, label]) => (
              <Field key={k} label={label} hint={k === "text" ? "Used when this provider is the main AI" : "Optional — defaults to the main model"}>
                <Input list={`custom-models-${k}`} value={f.defaults[k] ?? ""} onChange={(e) => set({ defaults: { ...f.defaults, [k]: e.target.value } })} className="font-mono text-[12.5px]" />
                <datalist id={`custom-models-${k}`}>
                  {models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </Field>
            ))}
          </div>
          <details className="text-[12.5px]">
            <summary className="cursor-pointer text-muted">Pricing & advanced</summary>
            <div className="grid sm:grid-cols-3 gap-3 mt-3">
              <Field label="Input $ / 1M tokens">
                <Input type="number" min={0} step="0.01" value={f.inputPer1M} onChange={(e) => set({ inputPer1M: e.target.value })} />
              </Field>
              <Field label="Output $ / 1M tokens">
                <Input type="number" min={0} step="0.01" value={f.outputPer1M} onChange={(e) => set({ outputPer1M: e.target.value })} />
              </Field>
              <Field label="$ per image">
                <Input type="number" min={0} step="0.001" value={f.perImage} onChange={(e) => set({ perImage: e.target.value })} />
              </Field>
            </div>
            <p className="text-[11.5px] text-muted mt-1">Used for budget limits. Leave blank if unknown — usage is then counted as $0, so set your provider's own spending limit too.</p>
            <Field label="Max-tokens parameter" className="mt-3">
              <Select value={f.tokenParam} onChange={(e) => set({ tokenParam: e.target.value as Form["tokenParam"] })}>
                <option value="max_tokens">max_tokens (most providers)</option>
                <option value="max_completion_tokens">max_completion_tokens (newer OpenAI models)</option>
              </Select>
            </Field>
          </details>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** List + management of user-added providers. Shown under the built-in providers. */
export function CustomProviders() {
  const qc = useQueryClient();
  const { data } = useProviders();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CustomProvider | null>(null);
  const [deleting, setDeleting] = React.useState<CustomProvider | null>(null);
  const [modelsFor, setModelsFor] = React.useState<string | null>(null);
  const custom = ((data as any)?.custom ?? []) as CustomProvider[];
  const presets = ((data as any)?.presets ?? []) as Preset[];
  const test = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; message: string }>(`/providers/${encodeURIComponent(id)}/test`),
    onSuccess: (r) => {
      toast[r.ok ? "success" : "error"](r.message);
      qc.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: (e) => toastError(e),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/providers/${encodeURIComponent(id)}`),
    onSuccess: () => {
      setDeleting(null);
      toast.success("Provider removed");
      qc.invalidateQueries({ queryKey: ["providers"] });
      qc.invalidateQueries({ queryKey: ["project"] });
    },
    onError: (e) => toastError(e),
  });
  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line">
        <div>
          <div className="text-[13.5px] font-medium text-ink">Custom providers</div>
          <div className="text-[12px] text-muted">Add any OpenAI-compatible API. It becomes selectable for every model role and for image generation.</div>
        </div>
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus size={13} weight="bold" /> Add provider
        </Button>
      </div>
      {custom.length === 0 ? (
        <div className="px-4 py-5 text-[12.5px] text-muted">No custom providers yet. Presets are included for OpenRouter, Groq, Together, DeepSeek, Mistral, xAI, Fireworks, Ollama and LM Studio.</div>
      ) : (
        <div className="divide-y divide-line">
          {custom.map((c) => {
            const preset = presets.find((p) => p.baseUrl === c.baseUrl);
            return (
              <div key={c.id} className="px-4 py-3.5 flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] font-medium text-ink">{c.name}</span>
                    <Badge tone="purple">Custom</Badge>
                    {c.hint && <span className="font-mono text-[11.5px] text-muted">{c.hint}</span>}
                  </div>
                  <div className="font-mono text-[11.5px] text-muted mt-0.5 truncate">{c.baseUrl}</div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {c.capabilities.map((cap) => (
                      <span key={cap} className="text-[11px] text-muted border border-line rounded-full px-1.5 py-[0.5px]">
                        {cap}
                      </span>
                    ))}
                    <span className="text-[11px] text-muted">· {c.models.length} model(s){c.defaultModels.text ? ` · main: ${c.defaultModels.text}` : ""}</span>
                  </div>
                  {(c.status === "ok" || c.lastError) && (
                    <div className={cn("flex items-start gap-1.5 text-[12px] mt-1.5", c.lastError ? "text-red-fg" : "text-green-fg")}>
                      {c.lastError ? <WarningCircle size={13} className="mt-0.5 shrink-0" /> : <CheckCircle size={13} weight="fill" className="mt-0.5 shrink-0" />}
                      <span className="break-words">{c.lastError ?? `Verified ${ago(c.lastTestedAt)}`}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {preset?.keyUrl && (
                    <Button asChild size="sm" variant="ghost">
                      <a href={preset.keyUrl} target="_blank" rel="noreferrer">
                        Keys <ArrowSquareOut size={12} />
                      </a>
                    </Button>
                  )}
                  <Button size="sm" variant={modelsFor === c.id ? "primary" : "secondary"} onClick={() => setModelsFor(modelsFor === c.id ? null : c.id)}>
                    <SlidersHorizontal size={12} weight="bold" /> Model & reasoning
                  </Button>
                  <Button size="sm" onClick={() => test.mutate(c.id)} loading={test.isPending && test.variables === c.id}>
                    Test
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditing(c);
                      setOpen(true);
                    }}
                  >
                    <PencilSimple size={12} /> Edit
                  </Button>
                  <Button size="icon-sm" variant="danger-ghost" onClick={() => setDeleting(c)} aria-label={`Remove ${c.name}`}>
                    <Trash size={13} />
                  </Button>
                </div>
                {modelsFor === c.id && (
                  <div className="basis-full">
                    <ProviderModelSettings
                      providerId={c.id}
                      capabilities={[...c.capabilities, ...(c.capabilities.includes("vision") && !c.capabilities.includes("text") ? ["text"] : [])]}
                      models={c.models}
                      defaults={c.defaultModels as Record<string, string>}
                      settings={(data as any)?.settings?.[c.id]}
                      onDone={() => setModelsFor(null)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <ProviderDialog open={open} onOpenChange={setOpen} editing={editing} presets={presets} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Remove ${deleting?.name}?`}
        description="Projects using it fall back to the next configured provider."
        confirmLabel="Remove"
        danger
        loading={del.isPending}
        onConfirm={() => {
          if (deleting) del.mutate(deleting.id);
        }}
      />
    </div>
  );
}
