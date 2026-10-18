import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Subscribes to server-sent events and invalidates the matching React Query caches,
 * so UI state follows background work (jobs, agents, publishing) without polling.
 */
const MAP: Record<string, string[]> = {
  "task.updated": ["tasks", "task", "dashboard"],
  "task.step": ["task"],
  "post.updated": ["posts", "post", "calendar", "dashboard", "campaign"],
  "asset.updated": ["assets", "asset"],
  "audit.updated": ["audits", "audit", "analysis", "dashboard"],
  "audit.progress": ["analysis-progress"],
  "integration.updated": ["integrations", "dashboard", "project"],
  "metrics.updated": ["analytics", "dashboard"],
  "inbox.updated": ["inbox", "dashboard"],
  "approval.updated": ["approvals", "dashboard", "task", "posts"],
  "notification": ["notifications"],
  "campaign.updated": ["campaigns", "campaign"],
  "opportunities.updated": ["opportunities", "dashboard"],
  "discover.updated": ["discover"],
  "code.updated": ["code-changes", "code-change"],
  "deploy.updated": ["deployments"],
  "automation.updated": ["automations", "automation-runs"],
  "project.updated": ["project", "projects", "dashboard"],
  "job.completed": ["jobs", "assets", "campaign", "posts"],
  "job.failed": ["jobs", "assets", "dashboard"],
  "system.emergency_stop": ["me"],
};

type Listener = (e: any) => void;
const listeners = new Set<Listener>();
export function onServerEvent(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useEvents(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource("/api/events", { withCredentials: true });
    es.onmessage = (msg) => {
      try {
        const e = JSON.parse(msg.data);
        for (const key of MAP[e.type] ?? []) qc.invalidateQueries({ queryKey: [key] });
        listeners.forEach((l) => l(e));
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, [enabled, qc]);
}
