import * as React from "react";
import { ArrowSquareOut, ArrowFatUp, ChatCircle, Star } from "@phosphor-icons/react";
import { Badge, Tooltip } from "@/components/ui";
import { ago, cn, fmtDate, fmtNum } from "@/lib/utils";

/** Relative time with the exact timestamp on hover. */
export function TimeAgo({ date, className, prefix }: { date?: string | Date | null; className?: string; prefix?: string }) {
  if (!date) return <span className={cn("text-faint", className)}>—</span>;
  return (
    <Tooltip content={fmtDate(date, "EEE, MMM d yyyy · HH:mm")}>
      <time dateTime={new Date(date).toISOString()} className={cn("tabular-nums cursor-default", className)}>
        {prefix}
        {ago(date)}
      </time>
    </Tooltip>
  );
}

/** External link that always opens in a new tab without leaking the opener. */
export function ExtLink({ href, children, className, icon = false }: { href?: string | null; children: React.ReactNode; className?: string; icon?: boolean }) {
  if (!href) return <span className={className}>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn("hover:underline underline-offset-2 decoration-line-strong", className)}>
      {children}
      {icon && <ArrowSquareOut size={11} weight="bold" className="inline ml-1 -mt-0.5 text-faint" />}
    </a>
  );
}

/** What the upstream score means for a given source (HN points, GitHub stars...). */
export function scoreLabel(source?: string | null) {
  const s = (source ?? "").toLowerCase();
  if (s.includes("hn") || s.includes("hacker")) return "points";
  if (s.includes("github")) return "stars";
  if (s.includes("producthunt") || s.includes("product hunt")) return "votes";
  return "score";
}

/** Real upstream engagement signals. Renders nothing when the source provides none. */
export function Signals({ score, comments, source, className }: { score?: number | null; comments?: number | null; source?: string | null; className?: string }) {
  if (score == null && comments == null) return null;
  const label = scoreLabel(source);
  return (
    <span className={cn("inline-flex items-center gap-2.5 text-[11.5px] text-muted tabular-nums", className)}>
      {score != null && (
        <span className="inline-flex items-center gap-1" title={`${fmtNum(score)} ${label} (upstream)`}>
          {label === "stars" ? <Star size={11} weight="fill" /> : <ArrowFatUp size={11} weight="fill" />}
          {fmtNum(score)} {label}
        </span>
      )}
      {comments != null && (
        <span className="inline-flex items-center gap-1" title={`${fmtNum(comments)} comments (upstream)`}>
          <ChatCircle size={11} weight="fill" />
          {fmtNum(comments)}
        </span>
      )}
    </span>
  );
}

export function MethodBadge({ method }: { method?: string | null }) {
  if (method === "ai") return <Badge tone="purple">AI</Badge>;
  if (method === "heuristic") return <Badge tone="yellow">Heuristic</Badge>;
  if (method === "ranked") return <Badge tone="yellow">Ranked</Badge>;
  if (method === "counts_only") return <Badge tone="gray">Counts only</Badge>;
  return null;
}

export function Dot() {
  return <span className="text-faint">·</span>;
}

// ───── Chart styling (warm minimal palette) ─────
export const CHART = {
  ink: "#111111",
  muted: "#787774",
  faint: "#A8A7A3",
  grid: "#EAEAEA",
  fillBlue: "#E1F3FE",
  fillGreen: "#EDF3EC",
  fillPurple: "#F1ECF9",
  fillYellow: "#FBF3DB",
  blue: "#1F6C9F",
  green: "#346538",
  purple: "#5B3F8C",
  yellow: "#956400",
};
export const SERIES_COLORS = [CHART.ink, CHART.blue, CHART.green, CHART.purple, CHART.yellow, CHART.muted];

export const axisProps = {
  tick: { fontSize: 11, fill: CHART.muted },
  tickLine: false,
  axisLine: { stroke: CHART.grid },
} as const;

export const tooltipProps = {
  contentStyle: { fontSize: 12, borderRadius: 8, border: `1px solid ${CHART.grid}`, boxShadow: "0 8px 24px rgba(17,17,17,0.06)", padding: "6px 10px" },
  labelStyle: { color: CHART.muted, fontSize: 11, marginBottom: 2 },
  itemStyle: { padding: 0 },
  cursor: { stroke: CHART.grid },
} as const;

export function shortDate(d: string) {
  const t = new Date(d.length === 10 ? `${d}T00:00:00` : d);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Small legend row for charts. */
export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11.5px] text-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="h-[2px] w-3 rounded-full" style={{ background: i.color, opacity: i.dashed ? 0.6 : 1 }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}
