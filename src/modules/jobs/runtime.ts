/**
 * In-process job orchestration (p-queue).
 *
 * Anti-overlap per action code. concurrency=3 so regs.poll, phones.sync,
 * groups.sync, and cdr.import can proceed independently when not overlapping themselves.
 * Interval scheduling is Settings-gated (see scheduler.ts).
 */

import PQueue from "p-queue";
import type { AllowedActionCode } from "@/modules/actions/registry";
import { logger } from "@/lib/logger";
import { processRegsPoll } from "@/modules/jobs/regs-poll-processor";
import { processGroupsSync } from "@/modules/groups/groups-sync-processor";
import { processPhonesSync } from "@/modules/phones/phones-sync-processor";
import { processCdrImport } from "@/modules/traffic/cdr-import-processor";
import {
  canEnqueueVoipmonitorMatch,
  shouldChainVoipmonitorMatch,
} from "@/modules/voipmonitor/continue";
import { requestVoipmonitorMatch } from "@/modules/voipmonitor/enqueue";
import { processVoipmonitorMatch } from "@/modules/voipmonitor/processor";
import { processCdrSidesRefresh } from "@/modules/traffic/sides-refresh/processor";
import { requestCdrSidesRefresh } from "@/modules/traffic/sides-refresh/enqueue";
import {
  evaluateSchedulerBootstrap as evaluateSchedulerBootstrapImpl,
} from "@/modules/jobs/scheduler";

const SUPPORTED_JOB_ACTIONS = new Set<AllowedActionCode>([
  "regs.poll",
  "phones.sync",
  "groups.sync",
  "cdr.import",
  "voipmonitor.match",
  "cdr.sides.refresh",
]);

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
  private readonly queue = new PQueue({ concurrency: 3 });

  isInFlight(actionCode: AllowedActionCode): boolean {
    return this.inFlight.has(actionCode);
  }

  async enqueue(input: JobEnqueueInput): Promise<JobEnqueueResult> {
    if (!SUPPORTED_JOB_ACTIONS.has(input.actionCode)) {
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
        if (input.actionCode === "groups.sync") {
          return await processGroupsSync({
            trigger: input.trigger,
            actorUserId: input.actorUserId,
          });
        }
        if (input.actionCode === "cdr.import") {
          return await processCdrImport({
            trigger: input.trigger,
            actorUserId: input.actorUserId,
          });
        }
        if (input.actionCode === "voipmonitor.match") {
          return await processVoipmonitorMatch({
            trigger: input.trigger,
            actorUserId: input.actorUserId,
          });
        }
        if (input.actionCode === "cdr.sides.refresh") {
          return await processCdrSidesRefresh({
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
        if (
          input.actionCode === "voipmonitor.match" &&
          shouldChainVoipmonitorMatch(result)
        ) {
          void canEnqueueVoipmonitorMatch(() =>
            this.isInFlight("voipmonitor.match"),
          ).then((allowed) => {
            if (allowed) requestVoipmonitorMatch("schedule");
          });
        }
        if (
          (input.actionCode === "phones.sync" ||
            input.actionCode === "cdr.import") &&
          result?.status === "success"
        ) {
          requestCdrSidesRefresh("schedule");
        }
        if (input.actionCode === "cdr.sides.refresh" && result?.replay) {
          requestCdrSidesRefresh("schedule");
        }
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
