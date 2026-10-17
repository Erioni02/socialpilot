import { BarChart3, Bot, CalendarDays, CheckSquare, Compass, Images, Inbox, LayoutDashboard, Megaphone, Plug, Settings, UserRound, type LucideIcon } from "lucide-react";

export type Section = { key: string; label: string; icon: LucideIcon; cycle: number | null; description: string; needs: string[] };

/** Project navigation. Sections with a `cycle` aren't built yet and show an honest roadmap panel with no controls. */
export const SECTIONS: Section[] = [
  { key: "", label: "Dashboard", icon: LayoutDashboard, cycle: null, description: "", needs: [] },
  { key: "profile", label: "Brand profile", icon: UserRound, cycle: null, description: "", needs: [] },
  {
    key: "workspace",
    label: "AI Workspace",
    icon: Images,
    cycle: 2,
    description: "Create and edit images, videos and post drafts with the AI. Every edit is saved as a real, versioned asset you can compare, restore and export.",
    needs: ["An image and/or video generation provider key", "FFmpeg (already installed on this machine) for video processing"]
  },
  {
    key: "campaigns",
    label: "Campaigns",
    icon: Megaphone,
    cycle: 3,
    description: "Plan campaigns with objectives, audiences, platforms and content pillars; the AI turns the plan into real drafts and assets.",
    needs: ["Cycle 2 workspace for assets", "At least one connected social account to schedule"]
  },
  {
    key: "calendar",
    label: "Calendar",
    icon: CalendarDays,
    cycle: 3,
    description: "Timezone-aware scheduling, approvals, publishing status and retries for every connected platform, with manual hand-off where an API can't publish.",
    needs: ["A connected Instagram, TikTok or X account with publishing permission"]
  },
  {
    key: "inbox",
    label: "Inbox",
    icon: Inbox,
    cycle: 3,
    description: "Comments, replies and mentions in one place. The AI classifies them and drafts replies; nothing is sent without your approval unless you allow a narrow category.",
    needs: ["A connected social account with comment/mention read permission"]
  },
  {
    key: "analytics",
    label: "Analytics",
    icon: BarChart3,
    cycle: 4,
    description: "Social metrics and website analytics side by side, with campaign attribution via UTM parameters. Measured results are kept separate from AI hypotheses.",
    needs: ["Google Analytics 4 or Plausible for website traffic", "Connected social accounts for social metrics"]
  },
  {
    key: "discover",
    label: "Discover",
    icon: Compass,
    cycle: 5,
    description: "A daily briefing of real developments relevant to this brand, every item with source link and publish time, plus ready-to-use content angles.",
    needs: ["RSS / Hacker News / GitHub sources work without keys", "Optional news API key for broader coverage"]
  },
  {
    key: "agents",
    label: "Agents & autopilot",
    icon: Bot,
    cycle: 6,
    description: "Project-scoped agents and scheduled automations that plan and execute multi-step work through the same permission-checked tools, within your budgets.",
    needs: ["Autonomy level 2+ in Settings for the actions you want to delegate"]
  },
  { key: "integrations", label: "Integrations", icon: Plug, cycle: null, description: "", needs: [] },
  { key: "approvals", label: "Approvals", icon: CheckSquare, cycle: null, description: "", needs: [] },
  { key: "settings", label: "Settings", icon: Settings, cycle: null, description: "", needs: [] }
];
