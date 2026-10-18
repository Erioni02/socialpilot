import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { REASONING_HELP, REASONING_LABELS, reasoningOptions, type ProviderSettings } from "@socialpilot/shared/src/provider-settings";
import { api } from "@/lib/api";
import { toastError } from "@/lib/utils";
import { Button, Field, Input, Select } from "@/components/ui";

type Role = "text" | "reasoning" | "vision" | "fast" | "image" | "video";
const ROLE_INFO: Record<Role, { label: string; hint: string }> = {
  text: { label: "Main AI", hint: "Agents and general writing" },
  reasoning: { label: "Thinking & planning", hint: "Campaign plans, opportunities, audits" },
  vision: { label: "Vision", hint: "Images and video frames" },
  fast: { label: "Fast tasks", hint: "Inbox triage, quick classification" },
  image: { label: "Image generation", hint: "" },
  video: { label: "Video generation", hint: "" },
};

/**
 * Per-provider model + reasoning preferences. Applies to every project that uses this provider for a role,
 * unless a project explicitly picks a different model in Project settings → AI & budget.
 */
export function ProviderModelSettings({
  providerId,
  capabilities,
  models,
  defaults,
  settings,
  onDone,
}: {
  providerId: string;
  capabilities: string[];
  models: { id: string; kind: string; label?: string; roles?: string[] }[];
  defaults: Partial<Record<Role, string>>;
  settings?: ProviderSettings;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const roles: Role[] = [
    ...(capabilities.includes("text") ? (["text", "reasoning", "fast"] as Role[]) : []),
    ...(capabilities.includes("vision") ? (["vision"] as Role[]) : []),
    ...(capabilities.includes("image") ? (["image"] as Role[]) : []),
    ...(capabilities.includes("video") ? (["video"] as Role[]) : []),
  ];
  const levels = reasoningOptions(providerId);
  const [models_, setModels] = React.useState<Record<string, string>>({ ...(settings?.models ?? {}) });
  const [reasoning, setReasoning] = React.useState<Record<string, string>>({ ...(settings?.reasoning ?? {}) });
  const live = useQuery({
    queryKey: ["providers", "models", providerId],
    queryFn: () =>
      api.get<{ models: string[] }>(providerId === "nvidia" || providerId === "ollama" ? `/providers/${providerId}/models` : `/providers/custom/${encodeURIComponent(providerId)}/models`),
    enabled: providerId === "nvidia" || providerId === "ollama" || providerId.startsWith("custom:"),
    staleTime: 3600_000,
    retry: false,
  });
  const save = useMutation({
    mutationFn: () => api.put(`/providers/${encodeURIComponent(providerId)}/settings`, { models: models_, reasoning }),
    onSuccess: () => {
      toast.success("Model & reasoning saved");
      qc.invalidateQueries({ queryKey: ["providers"] });
      onDone?.();
    },
    onError: (e) => toastError(e),
  });
  const suggestions = (role: Role) => {
    const kind = role === "image" ? "image" : role === "video" ? "video" : "text";
    const fromCatalog = models.filter((m) => m.kind === kind && (!m.roles || role === "image" || role === "video" || m.roles.includes(role)));
    const extra = kind === "text" ? (live.data?.models ?? []).filter((id) => !fromCatalog.some((m) => m.id === id)).map((id) => ({ id, label: id })) : [];
    return [...fromCatalog, ...extra];
  };
  const helpKey = providerId.startsWith("custom:") ? "custom" : providerId;
  return (
    <div className="mt-3 rounded-lg border border-line bg-subtle p-3 space-y-3">
      <div className="text-[12px] text-muted">
        Pick the model for each job and how much it should reason. Leave a model empty to use the default. A project can still override a model in Project settings → AI & budget.
        {levels.length > 1 && REASONING_HELP[helpKey] && <div className="mt-1">{REASONING_HELP[helpKey]}</div>}
      </div>
      {roles.map((role) => {
        const listId = `pm-${providerId}-${role}`;
        const isText = role === "text" || role === "reasoning" || role === "vision" || role === "fast";
        return (
          <div key={role} className="grid gap-2 sm:grid-cols-[150px_1fr_190px] items-end">
            <div className="pb-1.5">
              <div className="text-[12.5px] font-medium text-ink">{ROLE_INFO[role].label}</div>
              {ROLE_INFO[role].hint && <div className="text-[11px] text-muted">{ROLE_INFO[role].hint}</div>}
            </div>
            <Field label="Model">
              <Input
                list={listId}
                value={models_[role] ?? ""}
                placeholder={defaults[role] ?? (isText ? defaults.text : undefined) ?? "model id"}
                onChange={(e) => setModels((m) => ({ ...m, [role]: e.target.value }))}
                className="font-mono text-[12px] h-8"
              />
              <datalist id={listId}>
                {suggestions(role).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label ?? m.id}
                  </option>
                ))}
              </datalist>
            </Field>
            {isText && levels.length > 1 ? (
              <Field label="Reasoning">
                <Select value={reasoning[role] ?? "default"} onChange={(e) => setReasoning((r) => ({ ...r, [role]: e.target.value }))} className="h-8 text-[12.5px]">
                  {levels.map((l) => (
                    <option key={l} value={l}>
                      {REASONING_LABELS[l]}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <div />
            )}
          </div>
        );
      })}
      <div className="flex justify-end gap-2">
        {onDone && (
          <Button size="sm" variant="ghost" onClick={onDone}>
            Close
          </Button>
        )}
        <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      </div>
    </div>
  );
}
