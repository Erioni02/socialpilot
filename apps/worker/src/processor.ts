import { runTask, type RunOptions } from "@sp/tools";

export type ToolJob = { id: string; data: { taskId: string }; retryCount: number };
type Runner = (taskId: string, opts: RunOptions) => Promise<unknown>;

/**
 * pg-boss handler for one tool job. runTask records every final outcome on the Task row and only throws when the
 * job should run again (a transient failure, or an unexpected infrastructure error), so anything thrown is passed
 * on as a plain ASCII error: pg-boss retries it without storing user content. The worker never crashes on a job.
 */
export async function handleToolJob(job: ToolJob, run: Runner = runTask): Promise<void> {
  const { taskId } = job.data;
  try {
    await run(taskId, { attempt: job.retryCount + 1 });
  } catch (error) {
    console.warn(`[worker] task ${taskId} will be retried: ${String((error as Error)?.message ?? error).slice(0, 300)}`);
    throw new Error(`Retryable failure for task ${taskId}`);
  }
}
