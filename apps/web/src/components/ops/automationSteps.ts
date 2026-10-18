/** Friendly metadata for automation step types (mirrors AUTOMATION_STEP_TYPES and the engine's step semantics). */
export type StepField =
  | { key: string; label: string; kind: "number"; min: number; max: number; default: number; hint?: string }
  | { key: string; label: string; kind: "platforms"; default: string[]; hint?: string }
  | { key: string; label: string; kind: "textarea"; default: string; hint?: string; placeholder?: string }
  | { key: string; label: string; kind: "agent"; default: string; hint?: string };

export type StepMeta = { type: string; label: string; description: string; group: "Research" | "Content" | "Publishing" | "Community" | "Website" | "Agents" | "Other"; fields: StepField[]; outbound?: boolean };

export const STEP_TYPES: StepMeta[] = [
  { type: "gather_sources", label: "Gather sources", group: "Research", description: "Refresh the Discover feeds (news, launches, repositories, discussions) so later steps work from fresh, sourced items.", fields: [] },
  {
    type: "find_opportunities",
    label: "Find opportunities",
    group: "Research",
    description: "Rank fresh items against the project's audience and keywords and save the best as content opportunities.",
    fields: [{ key: "count", label: "Opportunities", kind: "number", min: 1, max: 15, default: 5 }],
  },
  { type: "analyze_metrics", label: "Analyze metrics", group: "Research", description: "Sync measured metrics from connected social and analytics integrations.", fields: [] },
  {
    type: "create_drafts",
    label: "Create drafts",
    group: "Content",
    description: "Write original, on-brand draft posts from the opportunities found earlier (or the newest saved ones).",
    fields: [
      { key: "count", label: "Drafts", kind: "number", min: 1, max: 10, default: 3 },
      { key: "platforms", label: "Platforms", kind: "platforms", default: ["x"] },
    ],
  },
  {
    type: "generate_media",
    label: "Generate media",
    group: "Content",
    description: "Generate images for drafts that target Instagram or TikTok and have no media yet. Uses the image AI provider and counts toward spend limits.",
    fields: [{ key: "maxImages", label: "Max images", kind: "number", min: 0, max: 10, default: 2 }],
  },
  { type: "brand_safety_check", label: "Brand safety check", group: "Content", description: "Run quality and brand checks on the new drafts. Drafts that fail are moved to review and not scheduled.", fields: [] },
  {
    type: "schedule_drafts",
    label: "Schedule drafts",
    group: "Publishing",
    description: "Place passing drafts on the calendar. Without automatic publishing, each one is sent to the approval queue.",
    fields: [
      { key: "startInHours", label: "Start in (hours)", kind: "number", min: 0, max: 168, default: 3 },
      { key: "spacingHours", label: "Spacing (hours)", kind: "number", min: 0, max: 72, default: 4 },
    ],
    outbound: true,
  },
  { type: "publish_approved", label: "Dispatch due posts", group: "Publishing", description: "Dispatch scheduled publications that are due and already approved. Never bypasses approvals.", fields: [], outbound: true },
  { type: "sync_inbox", label: "Sync inbox", group: "Community", description: "Fetch new comments and mentions from connected social accounts that support it.", fields: [] },
  { type: "classify_inbox", label: "Classify inbox", group: "Community", description: "Classify unclassified inbox items by intent, sentiment and priority.", fields: [] },
  { type: "website_audit", label: "Website audit", group: "Website", description: "Crawl the project website and record a new evidence-based audit.", fields: [] },
  {
    type: "agent_task",
    label: "Agent task",
    group: "Agents",
    description: "Start an agent task with your instruction. It runs with the same permissions and approval rules as tasks you start yourself.",
    fields: [
      { key: "instruction", label: "Instruction", kind: "textarea", default: "", placeholder: "e.g. Review yesterday's comments and draft replies for the important ones" },
      { key: "agentType", label: "Agent", kind: "agent", default: "general" },
    ],
  },
  { type: "notify", label: "Notify me", group: "Other", description: "Send a notification summarising the run, linking to approvals when any are waiting.", fields: [] },
];

export const STEP_META: Record<string, StepMeta> = Object.fromEntries(STEP_TYPES.map((s) => [s.type, s]));

export function defaultConfig(type: string): Record<string, unknown> {
  const m = STEP_META[type];
  return Object.fromEntries((m?.fields ?? []).map((f) => [f.key, Array.isArray(f.default) ? [...f.default] : f.default]));
}

export const CRON_PRESETS = [
  { cron: "0 8 * * *", label: "Every morning at 08:00" },
  { cron: "0 9 * * 1-5", label: "Weekdays at 09:00" },
  { cron: "0 */6 * * *", label: "Every 6 hours" },
  { cron: "0 9 * * 1", label: "Mondays at 09:00" },
];

export function describeTrigger(t?: { type: string; cron?: string; timezone?: string } | null) {
  if (!t || t.type === "manual") return "Manual only";
  const preset = CRON_PRESETS.find((p) => p.cron === t.cron);
  return `${preset ? preset.label : `Cron ${t.cron}`}${t.timezone ? ` (${t.timezone})` : ""}`;
}
