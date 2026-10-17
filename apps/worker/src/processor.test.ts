import { RetryableError } from "@sp/tools";
import { describe, expect, it } from "vitest";
import { handleToolJob } from "./processor";

const job = (retryCount = 0) => ({ id: "j1", data: { taskId: "t1" }, retryCount });

describe("handleToolJob", () => {
  it("runs the task with the attempt number", async () => {
    const calls: unknown[] = [];
    await handleToolJob(job(1), async (id, opts) => void calls.push([id, opts]));
    expect(calls).toEqual([["t1", { attempt: 2 }]]);
  });

  it("completes the job when runTask records a failure itself (it returns instead of throwing)", async () => {
    await expect(handleToolJob(job(), async () => undefined)).resolves.toBeUndefined();
  });

  it("rethrows any error runTask throws as a plain ASCII error so pg-boss retries the job", async () => {
    const error = await handleToolJob(job(), async () => Promise.reject(new Error("db write failed → retry"))).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Retryable failure for task t1");
  });

  it("rethrows retryable failures as a plain ASCII error so the queue retries safely", async () => {
    const error = await handleToolJob(job(), async () => Promise.reject(new RetryableError("503 → upstream"))).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Retryable failure for task t1");
  });
});
