/**
 * Local cdr.purge.month — batched DELETE of the oldest complete UTC month.
 */

import { prisma } from "@/lib/db";
import { formatCount } from "@/lib/format-count";
import { logger } from "@/lib/logger";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { failJobRunIfStillRunning } from "@/modules/jobs/finalize";
import { requestCdrImportDrain } from "@/modules/traffic/enqueue";
import {
  invalidateCdrMonthCountCache,
  queryMonthCallCounts,
} from "@/modules/traffic/cdr-month-stats";
import {
  currentUtcMonth,
  deletableMonthKey,
  parseMonthKey,
} from "@/modules/traffic/cdr-month";
import { formatMonthNominative } from "@/modules/traffic/month-labels";
import { clearPurgeHolds } from "@/modules/traffic/poison";
import { CDR_PURGE_BATCH_SIZE, purgeDeleteBatchSql } from "@/modules/traffic/purge/sql";
import { setPurgeTargetMonth } from "@/modules/traffic/purge/target";

const BATCH_PAUSE_MS = 50;

export type CdrPurgeProcessorInput = {
  trigger: "schedule" | "manual" | "test";
  actorUserId?: string;
  month?: string;
};

export type CdrPurgeProcessorResult = {
  status: "success" | "failed";
  jobRunId: string;
  phonesParsed: number;
  errorMessage?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resolveDeletableMonthKey(): Promise<string | null> {
  const months = await queryMonthCallCounts();
  return deletableMonthKey(months, currentUtcMonth().key);
}

export async function processCdrPurgeMonth(
  input: CdrPurgeProcessorInput,
): Promise<CdrPurgeProcessorResult> {
  const startedAt = new Date();
  const requested = parseMonthKey(input.month);
  const jobRun = await prisma.jobRun.create({
    data: {
      actionCode: "cdr.purge.month",
      trigger: input.trigger,
      status: "running",
      startedAt,
      actorUserId: input.actorUserId ?? null,
      meta: { month: requested?.key ?? input.month ?? null, phase: "started" },
    },
  });

  let deleted = 0;
  let targetCount = 0;
  const target = requested;

  try {
    const deletable = await resolveDeletableMonthKey();
    if (!target || !deletable || target.key !== deletable) {
      const message = !target
        ? "Укажите месяц в формате YYYY-MM"
        : !deletable
          ? "Нет полного месяца для удаления"
          : `Удалить можно только самый старый полный месяц (${deletable})`;
      await finish(jobRun.id, startedAt, input, {
        status: "failed",
        deleted: 0,
        targetCount: 0,
        month: target?.key ?? null,
        errorMessage: message,
      });
      return {
        status: "failed",
        jobRunId: jobRun.id,
        phonesParsed: 0,
        errorMessage: message,
      };
    }

    if (target.key === currentUtcMonth().key) {
      const message = "Текущий месяц удалить нельзя";
      await finish(jobRun.id, startedAt, input, {
        status: "failed",
        deleted: 0,
        targetCount: 0,
        month: target.key,
        errorMessage: message,
      });
      return {
        status: "failed",
        jobRunId: jobRun.id,
        phonesParsed: 0,
        errorMessage: message,
      };
    }

    setPurgeTargetMonth(target.key);
    targetCount = await prisma.cdrRecord.count({
      where: { cdrDate: { startsWith: `${target.key}-` } },
    });

    await auditService.append({
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.CDR_PURGE_START,
      entityType: "cdr_month",
      entityId: target.key,
      meta: { month: target.key, targetCount, jobRunId: jobRun.id },
    });

    logger.info("cdr.purge.month.started", {
      jobRunId: jobRun.id,
      month: target.key,
      targetCount,
    });

    while (true) {
      if (currentUtcMonth().key === target.key) {
        throw new Error("Текущий месяц удалить нельзя");
      }
      const result = await prisma.$executeRaw(
        purgeDeleteBatchSql(target.year, target.month, CDR_PURGE_BATCH_SIZE),
      );
      const batch = typeof result === "number" ? result : Number(result);
      if (!Number.isFinite(batch) || batch <= 0) break;
      deleted += batch;
      await prisma.jobRun.update({
        where: { id: jobRun.id },
        data: {
          phonesParsed: deleted,
          meta: {
            month: target.key,
            targetCount,
            deletedCount: deleted,
          },
        },
      });
      await sleep(BATCH_PAUSE_MS);
    }

    invalidateCdrMonthCountCache();
    await finish(jobRun.id, startedAt, input, {
      status: "success",
      deleted,
      targetCount,
      month: target.key,
      errorMessage: null,
    });
    return {
      status: "success",
      jobRunId: jobRun.id,
      phonesParsed: deleted,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn("cdr.purge.month.failed", {
      jobRunId: jobRun.id,
      error: errorMessage,
    });
    invalidateCdrMonthCountCache();
    await finish(jobRun.id, startedAt, input, {
      status: "failed",
      deleted,
      targetCount,
      month: target?.key ?? null,
      errorMessage,
    });
    return {
      status: "failed",
      jobRunId: jobRun.id,
      phonesParsed: deleted,
      errorMessage,
    };
  } finally {
    const month = target?.key ?? null;
    setPurgeTargetMonth(null);
    if (month) {
      clearPurgeHolds(month);
      requestCdrImportDrain("schedule");
    }
    await failJobRunIfStillRunning(
      jobRun.id,
      startedAt,
      "interrupted: process restarted",
    );
  }
}

async function finish(
  jobRunId: string,
  startedAt: Date,
  input: CdrPurgeProcessorInput,
  result: {
    status: "success" | "failed";
    deleted: number;
    targetCount: number;
    month: string | null;
    errorMessage: string | null;
  },
): Promise<void> {
  const finishedAt = new Date();
  const label = result.month
    ? (() => {
        const parsed = parseMonthKey(result.month);
        return parsed
          ? formatMonthNominative(parsed.year, parsed.month)
          : result.month;
      })()
    : "";
  await prisma.jobRun.update({
    where: { id: jobRunId },
    data: {
      status: result.status,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      phonesParsed: result.deleted,
      errorMessage:
        result.errorMessage ??
        (result.status === "success"
          ? `Удалено ${formatCount(result.deleted)} записей${label ? ` · ${label}` : ""}`
          : null),
      meta: {
        month: result.month,
        targetCount: result.targetCount,
        deletedCount: result.deleted,
      },
    },
  });
  await auditService.append({
    actorUserId: input.actorUserId,
    action: AUDIT_ACTIONS.CDR_PURGE_FINISH,
    entityType: "cdr_month",
    entityId: result.month ?? undefined,
    meta: {
      status: result.status,
      month: result.month,
      deleted: result.deleted,
      targetCount: result.targetCount,
    },
  });
  logger.info("cdr.purge.month.finished", {
    jobRunId,
    status: result.status,
    month: result.month,
    deleted: result.deleted,
  });
}
