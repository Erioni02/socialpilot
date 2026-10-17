import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label, Textarea } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { keys } from "@/lib/queries";
import type { BrandProfileDTO } from "@/lib/types";

type Fields = Pick<BrandProfileDTO, "description" | "targetAudience" | "industry" | "productsServices" | "objectives" | "voiceTone" | "keyMessages" | "colors" | "competitors" | "notes">;

const EMPTY: Fields = { description: "", targetAudience: "", industry: "", productsServices: [], objectives: [], voiceTone: "", keyMessages: [], colors: [], competitors: [], notes: "" };

const pick = (p: BrandProfileDTO | null): Fields =>
  p
    ? { description: p.description, targetAudience: p.targetAudience, industry: p.industry, productsServices: p.productsServices, objectives: p.objectives, voiceTone: p.voiceTone, keyMessages: p.keyMessages, colors: p.colors, competitors: p.competitors, notes: p.notes }
    : EMPTY;

function ListField({ id, label, hint, values, onChange, max }: { id: string; label: string; hint?: string; values: string[]; onChange: (v: string[]) => void; max: number }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (value && !values.includes(value) && values.length < max) onChange([...values, value]);
    setDraft("");
  };
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {hint && <p className="-mt-1 text-xs text-muted-foreground">{hint}</p>}
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <li key={v} className="flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pl-2 pr-1 text-sm">
              {v}
              <button type="button" aria-label={`Remove ${v}`} className="rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => onChange(values.filter((x) => x !== v))}>
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          placeholder="Add and press Enter"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" size="icon" aria-label={`Add to ${label}`} onClick={add} disabled={!draft.trim()}>
          <Plus />
        </Button>
      </div>
    </div>
  );
}

/** Editable brand profile. Every save creates a new version; "Confirm" marks it as the approved profile. */
export function ProfileForm({ projectId, profile, onConfirmed, confirmLabel = "Confirm profile" }: { projectId: string; profile: BrandProfileDTO | null; onConfirmed?: () => void; confirmLabel?: string }) {
  const queryClient = useQueryClient();
  const [fields, setFields] = useState<Fields>(pick(profile));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) setFields(pick(profile));
  }, [profile, dirty]);

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => {
    setFields((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: (confirm: boolean) => api<BrandProfileDTO>(`/projects/${projectId}/brand-profile`, { method: "PUT", body: { ...fields, confirm } }),
    onSuccess: (saved, confirm) => {
      queryClient.setQueryData(keys.profile(projectId), saved);
      setDirty(false);
      toast.success(confirm ? `Profile v${saved.version} confirmed` : `Saved as v${saved.version}`);
      if (confirm) onConfirmed?.();
    },
    onError: (error) => toast.error(error.message)
  });

  return (
    <form className="grid gap-5" onSubmit={(e) => e.preventDefault()}>
      <div className="flex flex-wrap items-center gap-2">
        {profile ? (
          <Badge variant={profile.source === "ai_draft" ? "default" : "secondary"}>
            {profile.source === "ai_draft" ? "AI draft" : "Your edit"} v{profile.version}
          </Badge>
        ) : (
          <Badge variant="outline">No profile yet — fill it in</Badge>
        )}
        {profile?.confirmedAt && (
          <Badge variant="success">
            <CheckCircle2 className="size-3" /> Confirmed
          </Badge>
        )}
        {profile?.source === "ai_draft" && <span className="text-xs text-muted-foreground">Drafted from your public website. Check it — the AI can be wrong.</span>}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="description">What the business does</Label>
        <Textarea id="description" rows={3} maxLength={2000} value={fields.description} onChange={(e) => set("description", e.target.value)} />
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="audience">Target audience</Label>
          <Textarea id="audience" rows={3} maxLength={1000} value={fields.targetAudience} onChange={(e) => set("targetAudience", e.target.value)} />
        </div>
        <div className="grid content-start gap-5">
          <div className="grid gap-2">
            <Label htmlFor="industry">Industry</Label>
            <Input id="industry" maxLength={200} value={fields.industry} onChange={(e) => set("industry", e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="voice">Voice and tone</Label>
            <Input id="voice" maxLength={500} value={fields.voiceTone} onChange={(e) => set("voiceTone", e.target.value)} />
          </div>
        </div>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <ListField id="products" label="Products and services" values={fields.productsServices} onChange={(v) => set("productsServices", v)} max={30} />
        <ListField id="objectives" label="Marketing objectives" values={fields.objectives} onChange={(v) => set("objectives", v)} max={20} />
        <ListField id="messages" label="Key messages" values={fields.keyMessages} onChange={(v) => set("keyMessages", v)} max={20} />
        <ListField id="competitors" label="Competitors" values={fields.competitors} onChange={(v) => set("competitors", v)} max={20} />
        <ListField id="colors" label="Brand colors" hint="Hex codes or names, e.g. #38bdf8" values={fields.colors} onChange={(v) => set("colors", v)} max={12} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="notes">Business notes</Label>
        <Textarea id="notes" rows={3} maxLength={4000} value={fields.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => save.mutate(false)} loading={save.isPending && save.variables === false} disabled={!dirty}>
          Save draft
        </Button>
        <Button type="button" onClick={() => save.mutate(true)} loading={save.isPending && save.variables === true}>
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
}
