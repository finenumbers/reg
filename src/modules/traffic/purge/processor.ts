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
import type { PurgeStageId, PurgeStagesMeta } from "@/modules/traffic/purge/progress";
import {
  CDR_PURGE_BATCH_SIZE,
  purgeAuditBatchSql,
  purgeAuditCountSql,
  purgeDeleteBatchSql,
  purgeJobsBatchSql,
  purgeJobsCountSql,
  utcMonthInterval,
} from "@/modules/traffic/purge/sql";
import { assertPurgeFkIndexes } from "@/modules/traffic/purge/resume";
import { setPurgeTargetMonth } from "@/modules/traffic/purge/target";

const BATCH_PAUSE_MS = 50;

export type CdrPurgeProcessorInput = {
  trigger: "schedule" | "manual" | "test";
  actorUserId?: string;
  month?: string;
  /** Jobs and audit only. Calls for this month are already gone. Not set by the HTTP route. */
  historyOnly?: boolean;
  deletedCalls?: number;
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

function rawCount(result: unknown): number {
  const batch = typeof result === "number" ? result : Number(result);
  return Number.isFinite(batch) ? batch : 0;
}

function sqlCount(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

async function publishPurgeProgress(
  jobRunId: string,
  month: string,
  phase: PurgeStageId,
  stages: PurgeStagesMeta,
): Promise<void> {
  await prisma.jobRun.update({
    where: { id: jobRunId },
    data: {
      phonesParsed: stages.calls.done,
      meta: {
        month,
        phase,
        targetCount: stages.calls.total,
        deletedCount: stages.calls.done,
        stages,
      },
    },
  });
}

async function countMonthHistory(
  year: number,
  month: number,
  keepJobId: string,
): Promise<{ jobs: number; audit: number }> {
  const { start, end } = utcMonthInterval(year, month);
  const [jobRows, auditRows] = await Promise.all([
    prisma.$queryRaw<{ n: unknown }[]>(purgeJobsCountSql(start, end, keepJobId)),
    prisma.$queryRaw<{ n: unknown }[]>(purgeAuditCountSql(start, end)),
  ]);
  return {
    jobs: sqlCount(jobRows[0]?.n),
    audit: sqlCount(auditRows[0]?.n),
  };
}

/** Jobs and audit whose timestamps fall in the CDR month. Never the purge job itself. */
async function deleteMonthHistory(
  year: number,
  month: number,
  keepJobId: string,
  hooks: {
    onPhase: (phase: "jobs" | "audit") => Promise<void>;
    onProgress: (phase: "jobs" | "audit", deleted: number) => Promise<void>;
  },
): Promise<{ jobs: number; audit: number }> {
  const { start, end } = utcMonthInterval(year, month);
  let jobs = 0;
  let audit = 0;
  await hooks.onPhase("jobs");
  while (true) {
    const batch = rawCount(
      await prisma.$executeRaw(
        purgeJobsBatchSql(start, end, keepJobId, CDR_PURGE_BATCH_SIZE),
      ),
    );
    if (batch <= 0) break;
    jobs += batch;
    await hooks.onProgress("jobs", jobs);
  }
  await hooks.onPhase("audit");
  while (true) {
    const batch = rawCount(
      await prisma.$executeRaw(purgeAuditBatchSql(start, end, CDR_PURGE_BATCH_SIZE)),
    );
    if (batch <= 0) break;
    audit += batch;
    await hooks.onProgress("audit", audit);
  }
  return { jobs, audit };
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
  const priorCalls =
    input.historyOnly &&
    typeof input.deletedCalls === "number" &&
    Number.isFinite(input.deletedCalls) &&
    input.deletedCalls > 0
      ? Math.trunc(input.deletedCalls)
      : 0;
  const jobRun = await prisma.jobRun.create({
    data: {
      actionCode: "cdr.purge.month",
      trigger: input.trigger,
      status: "running",
      startedAt,
      actorUserId: input.actorUserId ?? null,
      // Written before the first DELETE so a second restart still finds this month.
      phonesParsed: input.historyOnly ? priorCalls : undefined,
      meta: input.historyOnly
        ? {
            month: requested?.key ?? input.month ?? null,
            phase: "jobs",
            targetCount: priorCalls,
            deletedCount: priorCalls,
            historyOnly: true,
          }
        : { month: requested?.key ?? input.month ?? null, phase: "started" },
    },
  });

  let deleted = 0;
  let deletedJobs = 0;
  let deletedAudit = 0;
  let targetCount = 0;
  const target = requested;

  try {
    if (input.historyOnly) {
      if (!target) {
        const message = "Укажите месяц в формате YYYY-MM";
        await finish(jobRun.id, startedAt, input, {
          status: "failed",
          deleted: 0,
          deletedJobs: 0,
          deletedAudit: 0,
          targetCount: 0,
          month: null,
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
          deleted: priorCalls,
          deletedJobs: 0,
          deletedAudit: 0,
          targetCount: priorCalls,
          month: target.key,
          errorMessage: message,
        });
        return {
          status: "failed",
          jobRunId: jobRun.id,
          phonesParsed: priorCalls,
          errorMessage: message,
        };
      }

      setPurgeTargetMonth(target.key);
      await assertPurgeFkIndexes();
      const callsLeft = await prisma.cdrRecord.count({
        where: { cdrDate: { startsWith: `${target.key}-` } },
      });
      if (callsLeft > 0) {
        throw new Error("В месяце ещё есть звонки — доудаление истории остановлено");
      }

      deleted = priorCalls;
      targetCount = priorCalls;
      const historyTotals = await countMonthHistory(target.year, target.month, jobRun.id);
      const stages: PurgeStagesMeta = {
        calls: { done: priorCalls, total: priorCalls },
        jobs: { done: 0, total: historyTotals.jobs },
        audit: { done: 0, total: historyTotals.audit },
      };

      await auditService.append({
        actorUserId: input.actorUserId,
        action: AUDIT_ACTIONS.CDR_PURGE_START,
        entityType: "cdr_month",
        entityId: target.key,
        meta: {
          month: target.key,
          targetCount: priorCalls,
          jobRunId: jobRun.id,
          historyOnly: true,
        },
      });
      logger.info("cdr.purge.month.history_resume", {
        jobRunId: jobRun.id,
        month: target.key,
        deletedCalls: priorCalls,
        jobs: historyTotals.jobs,
        audit: historyTotals.audit,
      });
      await publishPurgeProgress(jobRun.id, target.key, "jobs", stages);

      const history = await deleteMonthHistory(target.year, target.month, jobRun.id, {
        onPhase: async (phase) => {
          await publishPurgeProgress(jobRun.id, target.key, phase, stages);
        },
        onProgress: async (phase, deletedCount) => {
          stages[phase].done = deletedCount;
          await publishPurgeProgress(jobRun.id, target.key, phase, stages);
        },
      });
      deletedJobs = history.jobs;
      deletedAudit = history.audit;

      invalidateCdrMonthCountCache();
      await finish(jobRun.id, startedAt, input, {
        status: "success",
        deleted: priorCalls,
        deletedJobs,
        deletedAudit,
        targetCount: priorCalls,
        month: target.key,
        errorMessage: null,
      });
      return {
        status: "success",
        jobRunId: jobRun.id,
        phonesParsed: priorCalls,
      };
    }

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
        deletedJobs: 0,
        deletedAudit: 0,
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
        deletedJobs: 0,
        deletedAudit: 0,
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
    await assertPurgeFkIndexes();
    const [callTotal, historyTotals] = await Promise.all([
      prisma.cdrRecord.count({
        where: { cdrDate: { startsWith: `${target.key}-` } },
      }),
      countMonthHistory(target.year, target.month, jobRun.id),
    ]);
    targetCount = callTotal;
    const stages: PurgeStagesMeta = {
      calls: { done: 0, total: targetCount },
      jobs: { done: 0, total: historyTotals.jobs },
      audit: { done: 0, total: historyTotals.audit },
    };

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
      jobs: historyTotals.jobs,
      audit: historyTotals.audit,
    });

    await publishPurgeProgress(jobRun.id, target.key, "calls", stages);

    while (true) {
      if (currentUtcMonth().key === target.key) {
        throw new Error("Текущий месяц удалить нельзя");
      }
      const batch = rawCount(
        await prisma.$executeRaw(
          purgeDeleteBatchSql(target.year, target.month, CDR_PURGE_BATCH_SIZE),
        ),
      );
      if (batch <= 0) break;
      deleted += batch;
      stages.calls.done = deleted;
      await publishPurgeProgress(jobRun.id, target.key, "calls", stages);
      await sleep(BATCH_PAUSE_MS);
    }

    const history = await deleteMonthHistory(target.year, target.month, jobRun.id, {
      onPhase: async (phase) => {
        await publishPurgeProgress(jobRun.id, target.key, phase, stages);
      },
      onProgress: async (phase, deletedCount) => {
        stages[phase].done = deletedCount;
        await publishPurgeProgress(jobRun.id, target.key, phase, stages);
      },
    });
    deletedJobs = history.jobs;
    deletedAudit = history.audit;

    invalidateCdrMonthCountCache();
    await finish(jobRun.id, startedAt, input, {
      status: "success",
      deleted,
      deletedJobs,
      deletedAudit,
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
      deletedJobs,
      deletedAudit,
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
    deletedJobs: number;
    deletedAudit: number;
    targetCount: number;
    month: string | null;
    errorMessage: string | null;
  },
): Promise<void> {
  const finishedAt = new Date();
  const label = result.month
    ? (() => {
        const parsed = parseMonthKey(result.month);
        return parsed ? formatMonthNominative(parsed.year, parsed.month) : result.month;
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
          ? `Удалено ${formatCount(result.deleted)} звонков${label ? ` · ${label}` : ""}. Задач: ${formatCount(result.deletedJobs)}. Аудит: ${formatCount(result.deletedAudit)}.`
          : null),
      meta: {
        month: result.month,
        targetCount: result.targetCount,
        deletedCount: result.deleted,
        deletedJobs: result.deletedJobs,
        deletedAudit: result.deletedAudit,
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
      deletedJobs: result.deletedJobs,
      deletedAudit: result.deletedAudit,
      targetCount: result.targetCount,
    },
  });
  logger.info("cdr.purge.month.finished", {
    jobRunId,
    status: result.status,
    month: result.month,
    deleted: result.deleted,
    deletedJobs: result.deletedJobs,
    deletedAudit: result.deletedAudit,
  });
}
