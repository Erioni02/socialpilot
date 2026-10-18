import * as React from "react";
import { Plus, X } from "@phosphor-icons/react";
import { Button, Input, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";

/** Chip-style editor for short string lists (keywords, tone, hashtags…). Enter or comma adds; Backspace removes the last chip. */
export function TagInput({
  value,
  onChange,
  placeholder = "Type and press Enter",
  max,
  transform,
  className,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  max?: number;
  transform?: (s: string) => string;
  className?: string;
}) {
  const [draft, setDraft] = React.useState("");
  const add = (raw: string) => {
    const parts = raw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (transform ? transform(s) : s));
    if (!parts.length) return;
    const next = [...value];
    for (const s of parts) if (!next.some((x) => x.toLowerCase() === s.toLowerCase())) next.push(s);
    onChange(max ? next.slice(0, max) : next);
    setDraft("");
  };
  return (
    <div className={cn("min-h-8.5 w-full rounded-md border border-line bg-surface px-1.5 py-1 flex flex-wrap items-center gap-1 focus-within:border-ink/40 focus-within:ring-2 focus-within:ring-ink/5", className)}>
      {value.map((t, i) => (
        <span key={`${t}-${i}`} className="inline-flex items-center gap-1 rounded-[5px] bg-canvas border border-line px-1.5 py-[1px] text-[12px] text-ink-2">
          {t}
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-faint hover:text-ink" aria-label={`Remove ${t}`}>
            <X size={10} weight="bold" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          if (v.includes(",")) add(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft.trim() && add(draft)}
        onPaste={(e) => {
          const t = e.clipboardData.getData("text");
          if (/[,\n]/.test(t)) {
            e.preventDefault();
            add(t);
          }
        }}
        placeholder={value.length ? "" : placeholder}
        className="flex-1 min-w-[120px] bg-transparent px-1 h-6 text-[13px] text-ink placeholder:text-faint focus:outline-none"
      />
    </div>
  );
}

/** One-item-per-row editor for longer strings (objectives, competitors…). */
export function LinesEditor({ value, onChange, placeholder, addLabel = "Add", max = 20 }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; addLabel?: string; max?: number }) {
  return (
    <div className="space-y-1.5">
      {value.map((line, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="text-[11px] text-faint w-4 text-right tabular-nums">{i + 1}</span>
          <Input value={line} placeholder={placeholder} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} />
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove">
            <X size={12} />
          </Button>
        </div>
      ))}
      {value.length < max && (
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange([...value, ""])} className="text-muted">
          <Plus size={12} weight="bold" /> {addLabel}
        </Button>
      )}
    </div>
  );
}

export type Product = { name: string; description: string };

export function ProductsEditor({ value, onChange }: { value: Product[]; onChange: (v: Product[]) => void }) {
  const set = (i: number, patch: Partial<Product>) => onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-2">
      {value.map((pr, i) => (
        <div key={i} className="rounded-lg border border-line bg-subtle p-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Input value={pr.name} placeholder="Product or service name" onChange={(e) => set(i, { name: e.target.value })} className="font-medium" />
            <Button type="button" size="icon-sm" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove product">
              <X size={12} />
            </Button>
          </div>
          <Textarea value={pr.description} placeholder="What it is and who it is for" onChange={(e) => set(i, { description: e.target.value })} className="min-h-[52px]" />
        </div>
      ))}
      {value.length < 50 && (
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange([...value, { name: "", description: "" }])} className="text-muted">
          <Plus size={12} weight="bold" /> Add product
        </Button>
      )}
    </div>
  );
}

/** Small step indicator used by the onboarding wizard. */
export const WIZARD_STEPS = ["Name", "Website", "Analyze", "Profile", "Integrations", "AI providers", "Permissions", "Launch"] as const;

export function WizardProgress({ step, onStepClick, maxReachable }: { step: number; onStepClick?: (n: number) => void; maxReachable?: number }) {
  return (
    <ol className="flex items-center gap-1 overflow-x-auto scrollbar-thin pb-1 -mx-1 px-1">
      {WIZARD_STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const active = n === step;
        const clickable = !!onStepClick && n >= 3 && n <= (maxReachable ?? 8) && !active;
        return (
          <li key={label} className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onStepClick?.(n)}
              className={cn(
                "flex items-center gap-1.5 rounded-full pl-1 pr-2.5 py-1 text-[12px] transition-colors",
                active ? "bg-ink text-white" : done ? "text-ink-2" : "text-faint",
                clickable && "hover:bg-black/[0.04] cursor-pointer",
              )}
            >
              <span
                className={cn(
                  "h-5 w-5 rounded-full flex items-center justify-center text-[10.5px] font-semibold tabular-nums",
                  active ? "bg-white text-ink" : done ? "bg-ink text-white" : "border border-line-strong text-faint",
                )}
              >
                {n}
              </span>
              {label}
            </button>
            {n < WIZARD_STEPS.length && <span className={cn("h-px w-3 sm:w-5", done ? "bg-ink" : "bg-line-strong")} />}
          </li>
        );
      })}
    </ol>
  );
}
