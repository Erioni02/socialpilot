import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowSquareOut, CaretRight, Copy } from "@phosphor-icons/react";
import { ApiError } from "@/lib/api";
import { cn, copy } from "@/lib/utils";
import { Skeleton } from "@/components/ui";

/** Reads/writes a single search param while preserving the others. */
export function useParam(name: string): [string | null, (v: string | null, opts?: { replace?: boolean }) => void] {
  const [sp, setSp] = useSearchParams();
  const value = sp.get(name);
  const set = React.useCallback(
    (v: string | null, opts?: { replace?: boolean }) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (v == null || v === "") next.delete(name);
          else next.set(name, v);
          return next;
        },
        { replace: opts?.replace ?? false },
      );
    },
    [name, setSp],
  );
  return [value, set];
}

export function isSetupError(e: unknown): e is ApiError {
  return e instanceof ApiError && e.code === "setup_required";
}

/** Compact segmented filter. */
export function Pills<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; count?: number }[]; className?: string }) {
  return (
    <div className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 px-2.5 rounded-full text-[12px] font-medium border transition-colors",
            value === o.value ? "bg-ink text-white border-ink" : "bg-surface text-ink-2 border-line hover:border-line-strong",
          )}
        >
          {o.label}
          {o.count != null && <span className={cn("ml-1.5 tabular-nums", value === o.value ? "text-white/70" : "text-faint")}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Collapsible JSON viewer for tool inputs/outputs and payloads. */
export function JsonView({ value, label = "JSON", defaultOpen = false, className }: { value: unknown; label?: React.ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = React.useState(defaultOpen);
  if (value === undefined || value === null) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <div className={cn("text-[12px]", className)}>
      <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-muted hover:text-ink">
        <CaretRight size={11} weight="bold" className={cn("transition-transform", open && "rotate-90")} />
        {label}
      </button>
      {open && (
        <pre className="mt-1.5 font-mono text-[11.5px] leading-[1.5] bg-subtle border border-line rounded-md p-2.5 overflow-auto scrollbar-thin max-h-[320px] whitespace-pre-wrap break-words">{text}</pre>
      )}
    </div>
  );
}

export function CopyField({ value, className }: { value: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 rounded-md border border-line bg-subtle pl-3 pr-1 py-1", className)}>
      <code className="flex-1 min-w-0 font-mono text-[12px] text-ink truncate">{value}</code>
      <button onClick={() => copy(value)} className="h-7 px-2 rounded-sm text-[12px] text-ink-2 hover:bg-black/[0.05] inline-flex items-center gap-1" aria-label="Copy">
        <Copy size={13} /> Copy
      </button>
    </div>
  );
}

export function ExtLink({ href, children, className }: { href: string; children?: React.ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={cn("inline-flex items-center gap-1 text-ink-2 hover:text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink min-w-0", className)}>
      <span className="truncate">{children ?? href.replace(/^https?:\/\//, "")}</span>
      <ArrowSquareOut size={12} className="shrink-0" />
    </a>
  );
}

export function KV({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[11px] text-muted font-medium">{label}</div>
      <div className="text-[12.5px] text-ink-2 mt-0.5 truncate">{children}</div>
    </div>
  );
}

export function ListSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

/** Formats who requested something: "agent:website_code", "automation:abc", "user". */
export function actorText(by?: string | null, agents?: Record<string, { name: string }>) {
  if (!by) return "—";
  if (by === "user") return "You";
  const [kind, rest] = by.split(":");
  if (kind === "agent") return `${agents?.[rest ?? ""]?.name ?? rest} agent`;
  if (kind === "automation") return "Automation";
  if (kind === "approval") return "Approval";
  return by;
}

export function durationText(start?: string | null, end?: string | null) {
  if (!start) return "—";
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
