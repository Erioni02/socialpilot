export type TaskStatusName = "queued" | "running" | "awaiting_approval" | "succeeded" | "failed" | "cancelled";

export type TaskSummary = {
  id: string;
  projectId: string;
  toolName: string;
  status: TaskStatusName;
  error: string | null;
  output: unknown;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type TaskEventDTO = { id: string; at: string; level: "info" | "warn" | "error"; message: string; data: unknown };

export type ProjectEvent =
  | { type: "task.updated"; task: TaskSummary }
  | { type: "task.event"; taskId: string; event: TaskEventDTO }
  | { type: "approval.created"; approvalId: string; taskId: string };
