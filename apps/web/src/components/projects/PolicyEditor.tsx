import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LockSimple, ShieldCheck } from "@phosphor-icons/react";
import { LEVEL_CEILING, PERMISSIONS, APPROVAL_CATEGORIES, type AutonomyLevel, type Permission, type ApprovalCategory } from "@socialpilot/shared";
import { api, ApiError, p } from "@/lib/api";
import { cn, toastError } from "@/lib/utils";
import { useMeta, SectionTitle } from "@/components/common";
import { Badge, Button, ConfirmDialog, Field, Input, Select, Skeleton, Switch } from "@/components/ui";
import { TagInput } from "./fields";

export type PolicyValue = {
  autonomyLevel: AutonomyLevel;
  permissions: Record<Permission, boolean>;
  approvals: Record<ApprovalCategory, boolean>;
  limits: {
    dailyPosts: number;
    dailyReplies: number;
    dailyAiSpendUsd: number;
    monthlyAiSpendUsd: number;
    taskBudgetUsd: number;
    publishHours: { start: number; end: number };
    allowedTopics: string[];
    blockedTopics: string[];
  };
  autoReplyCategories: string[];
};

const APPROVAL_LABEL: Record<ApprovalCategory, { label: string; description: string }> = {
  publish: { label: "Publishing", description: "Every post waits for your approval before it goes out." },
  reply: { label: "Replies", description: "Replies to comments and mentions wait for approval." },
  merge: { label: "Code merges", description: "Pull requests are merged only after approval." },
  deploy: { label: "Deployments", description: "Production promotions wait for approval." },
  spendOverBudget: { label: "Spend over budget", description: "Paid calls that would exceed a task budget need approval." },
};

export function normalizePolicyValue(raw: any): PolicyValue {
  const r = raw ?? {};
  const l = r.limits ?? {};
  return {
    autonomyLevel: ([1, 2, 3, 4].includes(r.autonomyLevel) ? r.autonomyLevel : 2) as AutonomyLevel,
    permissions: Object.fromEntries(PERMISSIONS.map((k) => [k, !!r.permissions?.[k]])) as Record<Permission, boolean>,
    approvals: Object.fromEntries(APPROVAL_CATEGORIES.map((k) => [k, r.approvals?.[k] !== false])) as Record<ApprovalCategory, boolean>,
    limits: {
      dailyPosts: l.dailyPosts ?? 5,
      dailyReplies: l.dailyReplies ?? 20,
      dailyAiSpendUsd: l.dailyAiSpendUsd ?? 5,
      monthlyAiSpendUsd: l.monthlyAiSpendUsd ?? 50,
      taskBudgetUsd: l.taskBudgetUsd ?? 2,
      publishHours: { start: l.publishHours?.start ?? 8, end: l.publishHours?.end ?? 21 },
      allowedTopics: l.allowedTopics ?? [],
      blockedTopics: l.blockedTopics ?? [],
    },
    autoReplyCategories: r.autoReplyCategories ?? [],
  };
}

function minLevelFor(perm: Permission): AutonomyLevel {
  return ([1, 2, 3, 4] as AutonomyLevel[]).find((l) => LEVEL_CEILING[l].includes(perm)) ?? 4;
}

function NumberField({ label, value, onChange, step = 1, min = 0, max, prefix, hint }: { label: string; value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number; prefix?: string; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-muted">{prefix}</span>}
        <Input type="number" value={Number.isFinite(value) ? value : 0} step={step} min={min} max={max} onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} className={cn("tabular-nums", prefix && "pl-6")} />
      </div>
    </Field>
  );
}

const hours = Array.from({ length: 25 }, (_, i) => i);

/**
 * Shared autonomy / permission / approval / limits editor (wizard step 7 and Project settings).
 * Saves via PUT /projects/:id/policy; when the API asks for a typed confirmation (428) it opens a ConfirmDialog and resends.
 */
export function PolicyEditor({ projectId, initial, onSaved, saveLabel = "Save permissions", secondaryAction }: { projectId: string; initial: any; onSaved?: () => void; saveLabel?: string; secondaryAction?: React.ReactNode }) {
  const { data: meta } = useMeta();
  const qc = useQueryClient();
  const [value, setValue] = React.useState<PolicyValue>(() => normalizePolicyValue(initial));
  const [confirm, setConfirm] = React.useState<{ phrase: string; message: string } | null>(null);
  const initialKey = JSON.stringify(initial ?? {});
  React.useEffect(() => setValue(normalizePolicyValue(initial)), [initialKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (confirmation?: string) => api.put(p(projectId, "/policy"), { ...value, ...(confirmation ? { confirmation } : {}) }),
    onSuccess: () => {
      setConfirm(null);
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["dashboard", projectId] });
      toast.success("Permissions saved");
      onSaved?.();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 428 && e.details?.phrase) setConfirm({ phrase: e.details.phrase, message: e.message });
      else toastError(e);
    },
  });

  const setLimit = <K extends keyof PolicyValue["limits"]>(k: K, v: PolicyValue["limits"][K]) => setValue((s) => ({ ...s, limits: { ...s.limits, [k]: v } }));
  const level = value.autonomyLevel;

  if (!meta)
    return (
      <div className="space-y-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-48" />
      </div>
    );

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle>Autonomy level</SectionTitle>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {([1, 2, 3, 4] as AutonomyLevel[]).map((l) => {
            const a = meta.autonomy[String(l)];
            const active = level === l;
            return (
              <button
                type="button"
                key={l}
                onClick={() => setValue((s) => ({ ...s, autonomyLevel: l }))}
                className={cn("text-left rounded-xl border p-3.5 transition-colors", active ? "border-ink bg-surface ring-2 ring-ink/5" : "border-line bg-surface hover:border-line-strong")}
                aria-pressed={active}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">Level {l}</span>
                  <span className={cn("h-3.5 w-3.5 rounded-full border", active ? "border-ink bg-ink shadow-[inset_0_0_0_2.5px_white]" : "border-line-strong")} />
                </div>
                <div className="text-[13.5px] font-semibold text-ink mt-1">{a?.name}</div>
                <p className="text-[12px] text-muted mt-1 leading-snug">{a?.description}</p>
                {l === 2 && <Badge tone="gray" className="mt-2">Recommended start</Badge>}
              </button>
            );
          })}
        </div>
        {level >= 3 && <p className="text-[12px] text-muted mt-2">Raising autonomy above the saved level requires typing a confirmation phrase when you save.</p>}
      </section>

      <section>
        <SectionTitle>Permissions</SectionTitle>
        <div className="rounded-xl border border-line bg-surface divide-y divide-line">
          {PERMISSIONS.map((perm) => {
            const info = meta.permissions[perm];
            const need = minLevelFor(perm);
            const blocked = !LEVEL_CEILING[level].includes(perm);
            return (
              <div key={perm} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-ink flex items-center gap-2">
                    {info?.label ?? perm}
                    {blocked && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted font-normal">
                        <LockSimple size={11} /> Needs level {need}
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-muted">{info?.description}</p>
                </div>
                <Switch checked={value.permissions[perm]} onCheckedChange={(v) => setValue((s) => ({ ...s, permissions: { ...s.permissions, [perm]: v } }))} />
              </div>
            );
          })}
        </div>
        <p className="text-[12px] text-muted mt-2">A permission is effective only when the autonomy level allows it and its toggle is on.</p>
      </section>

      <section>
        <SectionTitle>Approvals</SectionTitle>
        {level < 4 && (
          <div className="flex items-start gap-2 rounded-lg bg-subtle border border-line px-3 py-2 mb-2.5 text-[12.5px] text-ink-2">
            <ShieldCheck size={15} className="mt-0.5 text-green-fg shrink-0" weight="fill" />
            Below Controlled autopilot every outbound action (publish, reply, merge, deploy) always requires your approval, regardless of these toggles.
          </div>
        )}
        <div className="rounded-xl border border-line bg-surface divide-y divide-line">
          {APPROVAL_CATEGORIES.map((k) => {
            const forced = level < 4 && k !== "spendOverBudget";
            return (
              <div key={k} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-ink">Require approval: {APPROVAL_LABEL[k].label}</div>
                  <p className="text-[12px] text-muted">{APPROVAL_LABEL[k].description}</p>
                </div>
                <Switch checked={forced ? true : value.approvals[k]} disabled={forced} onCheckedChange={(v) => setValue((s) => ({ ...s, approvals: { ...s.approvals, [k]: v } }))} />
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <SectionTitle>Limits</SectionTitle>
        <div className="rounded-xl border border-line bg-surface p-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField label="Posts per day" value={value.limits.dailyPosts} onChange={(n) => setLimit("dailyPosts", Math.round(n))} max={200} />
          <NumberField label="Replies per day" value={value.limits.dailyReplies} onChange={(n) => setLimit("dailyReplies", Math.round(n))} max={500} />
          <NumberField label="Max cost per task" prefix="$" step={0.5} value={value.limits.taskBudgetUsd} onChange={(n) => setLimit("taskBudgetUsd", n)} max={1000} />
          <NumberField label="Daily AI spend" prefix="$" step={1} value={value.limits.dailyAiSpendUsd} onChange={(n) => setLimit("dailyAiSpendUsd", n)} max={10000} />
          <NumberField label="Monthly AI spend" prefix="$" step={5} value={value.limits.monthlyAiSpendUsd} onChange={(n) => setLimit("monthlyAiSpendUsd", n)} max={100000} />
          <Field label="Publishing hours" hint="In the project timezone.">
            <div className="flex items-center gap-1.5">
              <Select value={value.limits.publishHours.start} onChange={(e) => setLimit("publishHours", { ...value.limits.publishHours, start: Number(e.target.value) })}>
                {hours.slice(0, 24).map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </Select>
              <span className="text-muted text-[12px]">to</span>
              <Select value={value.limits.publishHours.end} onChange={(e) => setLimit("publishHours", { ...value.limits.publishHours, end: Number(e.target.value) })}>
                {hours.slice(1).map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </Select>
            </div>
          </Field>
          <Field label="Allowed topics" hint="Empty means any on-brand topic." className="sm:col-span-2 lg:col-span-3">
            <TagInput value={value.limits.allowedTopics} onChange={(v) => setLimit("allowedTopics", v)} max={50} />
          </Field>
          <Field label="Blocked topics" hint="Agents will never create content about these." className="sm:col-span-2 lg:col-span-3">
            <TagInput value={value.limits.blockedTopics} onChange={(v) => setLimit("blockedTopics", v)} max={50} placeholder="politics, pricing promises…" />
          </Field>
        </div>
      </section>

      <div className="flex items-center justify-end gap-2">
        {secondaryAction}
        <Button variant="primary" loading={save.isPending && !confirm} onClick={() => save.mutate(undefined)}>
          {saveLabel}
        </Button>
      </div>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Confirm the change"
        description={confirm?.message}
        phrase={confirm?.phrase}
        confirmLabel="Confirm and save"
        danger
        loading={save.isPending}
        onConfirm={() => {
          if (confirm) save.mutate(confirm.phrase);
        }}
      >
        <p className="text-[12.5px] text-ink-2">
          Higher autonomy lets agents act on connected accounts with fewer checkpoints. Limits, blocked topics and the emergency stop still apply.
        </p>
      </ConfirmDialog>
    </div>
  );
}
