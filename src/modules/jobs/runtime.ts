/**
 * In-process job orchestration (p-queue).
 *
 * Anti-overlap per action code. concurrency=2 so regs.poll and phones.sync
 * can proceed independently when not overlapping themselves.
 * Interval scheduling is Settings-gated (see scheduler.ts).
 */

import PQueue from "p-queue";
import type { AllowedActionCode } from "@/modules/actions/registry";
import { logger } from "@/lib/logger";
import { processRegsPoll } from "@/modules/jobs/regs-poll-processor";
import { processPhonesSync } from "@/modules/phones/phones-sync-processor";
import {
  evaluateSchedulerBootstrap as evaluateSchedulerBootstrapImpl,
  isAutoSchedulerRunning,
  rescheduleAfterSettingsChange,
} from "@/modules/jobs/scheduler";

export type JobEnqueueInput = {
  actionCode: AllowedActionCode;
  trigger: "schedule" | "manual" | "test";
  actorUserId?: string;
};

export type JobEnqueueResult = {
  accepted: boolean;
  reason?: string;
  jobRunId?: string;
};

export interface JobRuntime {
  enqueue(input: JobEnqueueInput): Promise<JobEnqueueResult>;
  isInFlight(actionCode: AllowedActionCode): boolean;
}

export class PQueueJobRuntime implements JobRuntime {
  private readonly inFlight = new Set<AllowedActionCode>();
  private readonly queue = new PQueue({ concurrency: 2 });

  isInFlight(actionCode: AllowedActionCode): boolean {
    return this.inFlight.has(actionCode);
  }

  async enqueue(input: JobEnqueueInput): Promise<JobEnqueueResult> {
    if (input.actionCode !== "regs.poll" && input.actionCode !== "phones.sync") {
      return {
        accepted: false,
        reason: `Unsupported action code for job runtime: ${input.actionCode}`,
      };
    }

    if (this.isInFlight(input.actionCode)) {
      return { accepted: false, reason: "anti-overlap: job already in flight" };
    }

    this.inFlight.add(input.actionCode);

    const runPromise = this.queue.add(async () => {
      try {
        if (input.actionCode === "phones.sync") {
          return await processPhonesSync({
            trigger: input.trigger,
            actorUserId: input.actorUserId,
          });
        }
        return await processRegsPoll({
          trigger: input.trigger,
          actorUserId: input.actorUserId,
        });
      } finally {
        this.inFlight.delete(input.actionCode);
      }
    });

    void runPromise.then(
      (result) => {
        logger.info("jobs.enqueue.completed", {
          actionCode: input.actionCode,
          trigger: input.trigger,
          status: result?.status,
          jobRunId: result?.jobRunId,
        });
      },
      (error) => {
        this.inFlight.delete(input.actionCode);
        logger.error("jobs.enqueue.failed", {
          actionCode: input.actionCode,
          trigger: input.trigger,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );

    return { accepted: true };
  }
}

const JOB_RUNTIME_GLOBAL_KEY = "__reg_job_runtime__";

function getSharedJobRuntime(): JobRuntime {
  const g = globalThis as typeof globalThis & {
    [JOB_RUNTIME_GLOBAL_KEY]?: JobRuntime;
  };
  if (!g[JOB_RUNTIME_GLOBAL_KEY]) {
    g[JOB_RUNTIME_GLOBAL_KEY] = new PQueueJobRuntime();
  }
  return g[JOB_RUNTIME_GLOBAL_KEY];
}

/** Process-wide singleton (survives Next.js multi-bundle module copies). */
export const jobRuntime: JobRuntime = getSharedJobRuntime();

export function evaluateSchedulerBootstrap(): {
  started: boolean;
  detail: string;
} {
  return evaluateSchedulerBootstrapImpl(jobRuntime);
}

export { isAutoSchedulerRunning, rescheduleAfterSettingsChange };
