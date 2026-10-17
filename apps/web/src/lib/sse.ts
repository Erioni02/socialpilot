import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { keys } from "./queries";
import type { ProjectEvent, TaskDetail } from "./types";

/**
 * Live project events (SSE). Keeps the task cache current and refreshes affected data;
 * `onEvent` lets a page react too. EventSource reconnects automatically (server sends `retry: 3000`).
 */
export function useProjectEvents(projectId: string | undefined, onEvent?: (event: ProjectEvent) => void) {
  const queryClient = useQueryClient();
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!projectId) return;
    const source = new EventSource(`/api/projects/${projectId}/events`, { withCredentials: true });
    source.onmessage = (message) => {
      let event: ProjectEvent;
      try {
        event = JSON.parse(message.data) as ProjectEvent;
      } catch {
        return;
      }
      if (event.type === "task.event") {
        queryClient.setQueryData<TaskDetail>(keys.task(event.taskId), (prev) =>
          prev && !prev.events.some((e) => e.id === event.event.id) ? { ...prev, events: [...prev.events, event.event] } : prev
        );
      }
      if (event.type === "task.updated") {
        queryClient.setQueryData<TaskDetail>(keys.task(event.task.id), (prev) => (prev ? { ...prev, task: event.task } : prev));
        void queryClient.invalidateQueries({ queryKey: keys.tasks(projectId) });
        if (event.task.status === "succeeded" || event.task.status === "failed") {
          void queryClient.invalidateQueries({ queryKey: keys.task(event.task.id) });
          for (const key of [keys.website(projectId), keys.profile(projectId), keys.audit(projectId), keys.spend(projectId), keys.projects]) void queryClient.invalidateQueries({ queryKey: key });
        }
      }
      if (event.type === "approval.created") void queryClient.invalidateQueries({ queryKey: keys.approvals(projectId) });
      handler.current?.(event);
    };
    return () => source.close();
  }, [projectId, queryClient]);
}
