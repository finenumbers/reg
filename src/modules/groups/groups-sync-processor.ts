/**
 * groups.sync — read the RTU page «Входящие группы» and replace routing_groups.
 * Does not call SSH and does not touch phone_endpoints / phone_gateways.
 */

import type { JobTrigger } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { applyGroupsSnapshot } from "@/modules/groups/apply";
import type { ParsedGroupsPayload } from "@/modules/groups/parse";
import { acceptIncomingGroups } from "@/modules/groups/rtu-catalog";
import {
  readStoredIncomingGroups,
  type IncomingGroupsRead,
} from "@/modules/groups/rtu-read";
import { failJobRunIfStillRunning } from "@/modules/jobs/finalize";

export type GroupsSyncProcessorInput = {
  trigger: JobTrigger;
  actorUserId?: string | null;
};

export type GroupsSyncProcessorResult = {
  jobRunId: string;
  status: "success" | "failed";
  errorMessage: string | null;
  groupCount: number;
  exitCode: number | null;
};

export type GroupsSyncProcessorDeps = {
  read: () => Promise<IncomingGroupsRead>;
  apply: (
    payload: ParsedGroupsPayload,
    jobRunId: string,
    syncedAt?: Date,
  ) => Promise<{ groupCount: number }>;
};

const DEFAULT_DEPS: GroupsSyncProcessorDeps = {
  read: () => readStoredIncomingGroups(),
  apply: applyGroupsSnapshot,
};

export async function processGroupsSync(
  input: GroupsSyncProcessorInput,
  deps: GroupsSyncProcessorDeps = DEFAULT_DEPS,
): Promise<GroupsSyncProcessorResult> {
  const startedAt = new Date();

  const jobRun = await prisma.jobRun.create({
    data: {
      actionCode: "groups.sync",
      trigger: input.trigger,
      status: "running",
      startedAt,
      actorUserId: input.actorUserId ?? null,
    },
  });

  try {
    await auditService.append({
      actorUserId: input.actorUserId,
      action:
        input.trigger === "manual"
          ? AUDIT_ACTIONS.GROUPS_SYNC_MANUAL
          : AUDIT_ACTIONS.GROUPS_SYNC_START,
      entityType: "job_run",
      entityId: jobRun.id,
      meta: {
        trigger: input.trigger,
        actionCode: "groups.sync",
        phase: "started",
      },
    });

    logger.info("groups.sync.started", {
      jobRunId: jobRun.id,
      trigger: input.trigger,
    });

    const fail = async (errorMessage: string): Promise<GroupsSyncProcessorResult> => {
      const finishedAt = new Date();
      await prisma.jobRun.update({
        where: { id: jobRun.id },
        data: {
          status: "failed",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          errorMessage,
          exitCode: null,
          phonesParsed: 0,
          linesBad: 0,
          changesCount: 0,
        },
      });

      await auditService.append({
        actorUserId: input.actorUserId,
        action: AUDIT_ACTIONS.GROUPS_SYNC_FINISH,
        entityType: "job_run",
        entityId: jobRun.id,
        meta: {
          trigger: input.trigger,
          status: "failed",
          errorMessage,
        },
      });

      logger.warn("groups.sync.failed", {
        jobRunId: jobRun.id,
        errorMessage,
      });

      return {
        jobRunId: jobRun.id,
        status: "failed",
        errorMessage,
        groupCount: 0,
        exitCode: null,
      };
    };

    const read = await deps.read();
    if (!read.ok) return fail(read.detail);
    const accepted = acceptIncomingGroups(read.groups);
    if (!accepted.ok) return fail(accepted.detail);

    let applyResult;
    try {
      applyResult = await deps.apply(
        { version: 0, groups: accepted.groups },
        jobRun.id,
        new Date(),
      );
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : "Failed to apply groups snapshot",
      );
    }

    const finishedAt = new Date();
    try {
      await prisma.jobRun.update({
        where: { id: jobRun.id },
        data: {
          status: "success",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          errorMessage: null,
          exitCode: null,
          phonesParsed: applyResult.groupCount,
          linesBad: 0,
          changesCount: applyResult.groupCount,
          meta: {
            groupCount: applyResult.groupCount,
            source: "rtu",
          },
        },
      });

      await auditService.append({
        actorUserId: input.actorUserId,
        action: AUDIT_ACTIONS.GROUPS_SYNC_FINISH,
        entityType: "job_run",
        entityId: jobRun.id,
        meta: {
          trigger: input.trigger,
          status: "success",
          groupCount: applyResult.groupCount,
        },
      });
    } catch (error) {
      logger.warn("groups.sync.post_apply_finalize_failed", {
        jobRunId: jobRun.id,
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        await prisma.jobRun.update({
          where: { id: jobRun.id },
          data: {
            status: "success",
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            errorMessage: null,
            exitCode: null,
            phonesParsed: applyResult.groupCount,
            linesBad: 0,
            changesCount: applyResult.groupCount,
          },
        });
      } catch (markError) {
        logger.error("groups.sync.success_mark_failed", {
          jobRunId: jobRun.id,
          error: markError instanceof Error ? markError.message : String(markError),
        });
      }
    }

    logger.info("groups.sync.finished", {
      jobRunId: jobRun.id,
      groupCount: applyResult.groupCount,
    });

    return {
      jobRunId: jobRun.id,
      status: "success",
      errorMessage: null,
      groupCount: applyResult.groupCount,
      exitCode: null,
    };
  } finally {
    await failJobRunIfStillRunning(
      jobRun.id,
      startedAt,
      "Job ended without a terminal status",
    );
  }
}
