import { RetryableError, runTask, type RunOptions } from "@sp/tools";

export type ToolJob = { id: string; data: { taskId: string }; retryCount: number };
type Runner = (taskId: string, opts: RunOptions) => Promise<unknown>;

/**
 * pg-boss handler for one tool job. runTask records every outcome on the Task row, so:
 * - non-retryable failures are swallowed (the job completes; the task is already `failed`),
 * - retryable ones rethrow a plain ASCII error so pg-boss schedules a retry without storing user content.
 * The worker process must never crash because of one job.
 */
export async function handleToolJob(job: ToolJob, run: Runner = runTask): Promise<void> {
  const { taskId } = job.data;
  try {
    await run(taskId, { attempt: job.retryCount + 1 });
  } catch (error) {
    if (error instanceof RetryableError || (error as Error)?.name === "RetryableError") throw new Error(`Retryable failure for task ${taskId}`);
    console.error(`[worker] task ${taskId} failed: ${String((error as Error)?.message ?? error).slice(0, 300)}`);
  }
}
