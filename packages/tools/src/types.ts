import type { AutonomyLevel, Capability } from "@sp/shared";
import type { ZodType } from "zod";

export type ActorType = "user" | "agent" | "system" | "schedule";
export type Actor = { type: ActorType; id: string };

export type ToolContext = {
  workspaceId: string;
  projectId: string;
  actor: Actor;
  taskId: string;
  signal: AbortSignal;
  emit(message: string, data?: unknown, level?: "info" | "warn" | "error"): Promise<void>;
  recordSpend(category: "ai" | "media" | "api", amountUsd: number): Promise<void>;
};

export type ToolDef<I, O> = {
  name: string;
  description: string;
  input: ZodType<I, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  output: ZodType<O, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  capability: Capability;
  minAutonomy: AutonomyLevel;
  approval: "never" | "always" | "policy";
  runMode: "inline" | "queued";
  /** Only the user may call it (e.g. testing a provider key). */
  userOnly?: boolean;
  estimateCostUsd?(input: I): number;
  run(ctx: ToolContext, input: I): Promise<O>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = ToolDef<any, any>;

/** Throw from a tool for transient failures (network, 5xx, 429): the job queue retries it. */
export class RetryableError extends Error {
  override name = "RetryableError";
}
