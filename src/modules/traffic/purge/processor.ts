/**
 * Local cdr.purge.month — batched DELETE of the oldest complete UTC month.
 */

import { prisma } from "@/lib/db";
import { formatCount } from "@/lib/format-count";
import { logger } from "@/lib/logger";
import {
  queryAntifraudMonthStats,
  resetAntifraudMonthStatsCache,
} from "@/modules/antifraud/month-stats";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { failJobRunIfStillRunning } from "@/modules/jobs/finalize";
import { requestCdrImportDrain } from "@/modules/traffic/enqueue";
import { requestSmgImportDrain } from "@/modules/smg/enqueue";
import { querySmgMonthCallCounts } from "@/modules/smg/month-stats";
import { clearSmgPurgeHolds } from "@/modules/smg/poison";
import {
  deletableStorageMonthKey,
  mergeStorageMonths,
  type MonthTrafficStats,
} from "@/modules/storage/months";
import {
  invalidateCdrMonthCountCache,
  queryMonthCallCounts,
} from "@/modules/traffic/cdr-month-stats";
import {
  currentUtcMonth,
  parseMonthKey,
  type CdrMonth,
} from "@/modules/traffic/cdr-month";
import { formatMonthNominative } from "@/modules/traffic/month-labels";
import { clearPurgeHolds } from "@/modules/traffic/poison";
import { syslogRoot } from "@/modules/smg-syslog/paths";
import { deleteSyslogMonth } from "@/modules/smg-syslog/purge";
import { listSyslogMonthInventory } from "@/modules/smg-syslog/month-inventory";
import {
  collectMonthTraceKeys,
  countTraceCards,
  countTraceDelays,
  deleteTraceCards,
} from "@/modules/smg-trace/purge-cards";
import type { PurgeStageId, PurgeStagesMeta } from "@/modules/traffic/purge/progress";
import {
  CDR_PURGE_BATCH_SIZE,
  purgeAuditBatchSql,
  purgeAuditCountSql,
  purgeDeleteBatchSql,
  purgeJobsBatchSql,
  purgeJobsCountSql,
  purgeJournalBatchSql,
  purgeJournalCountSql,
  purgeSmgBatchSql,
  purgeSmgCountSql,
  utcMonthInterval,
} from "@/modules/traffic/purge/sql";
import {
  assertPurgeFkIndexes,
  clearPurgeContinuationFlags,
} from "@/modules/traffic/purge/resume";
import {
  notePurgeBatchCommitted,
  purgeDeleteCommitted,
  setPurgeTargetMonth,
} from "@/modules/traffic/purge/target";

const BATCH_PAUSE_MS = 50;

export type CdrPurgeProcessorInput = {
  trigger: "schedule" | "manual" | "test";
  actorUserId?: string;
  month?: string;
  /** Jobs and audit only. Calls for this month are already gone. Not set by the HTTP route. */
  historyOnly?: boolean;
  /**
   * Continue call deletion for a purge this process just interrupted.
   * Skips the oldest-month gate. Not set by the HTTP route.
   */
  resumeCalls?: boolean;
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
        deletedSmg: stages.smg.done,
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
    notePurgeBatchCommitted(batch);
    jobs += batch;
    await hooks.onProgress("jobs", jobs);
  }
  await hooks.onPhase("audit");
  while (true) {
    const batch = rawCount(
      await prisma.$executeRaw(purgeAuditBatchSql(start, end, CDR_PURGE_BATCH_SIZE)),
    );
    if (batch <= 0) break;
    notePurgeBatchCommitted(batch);
    audit += batch;
    await hooks.onProgress("audit", audit);
  }
  return { jobs, audit };
}

function sideFromCounts(row: CdrMonth): MonthTrafficStats {
  return {
    year: row.year,
    month: row.month,
    key: row.key,
    calls: row.count ?? 0,
    seconds: 0,
    minutes: 0,
  };
}

export async function resolveDeletableMonthKey(): Promise<string | null> {
  const current = currentUtcMonth();
  const [cdr, smg, syslog, antifraud] = await Promise.all([
    queryMonthCallCounts(),
    querySmgMonthCallCounts(),
    listSyslogMonthInventory(syslogRoot()),
    queryAntifraudMonthStats(),
  ]);
  return deletableStorageMonthKey(
    mergeStorageMonths(
      cdr.map(sideFromCounts),
      smg.map(sideFromCounts),
      syslog,
      current,
      antifraud,
    ),
    current.key,
  );
}

async function countJournalMonth(year: number, month: number): Promise<number> {
  const { start, end } = utcMonthInterval(year, month);
  const rows = await prisma.$queryRaw<{ n: unknown }[]>(purgeJournalCountSql(start, end));
  return sqlCount(rows[0]?.n);
}

async function deleteJournalMonth(
  year: number,
  month: number,
  monthKeyValue: string,
  total: number,
  onProgress: (deleted: number) => Promise<void>,
): Promise<number> {
  if (total <= 0) return 0;
  const { start, end } = utcMonthInterval(year, month);
  let deleted = 0;
  while (true) {
    if (currentUtcMonth().key === monthKeyValue) {
      throw new Error("Текущий месяц удалить нельзя");
    }
    const batch = rawCount(
      await prisma.$executeRaw(purgeJournalBatchSql(start, end, CDR_PURGE_BATCH_SIZE)),
    );
    if (batch <= 0) break;
    notePurgeBatchCommitted(batch);
    deleted += batch;
    await onProgress(deleted);
    await sleep(BATCH_PAUSE_MS);
  }
  return deleted;
}

async function countSmgMonth(year: number, month: number): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: unknown }[]>(purgeSmgCountSql(year, month));
  return sqlCount(rows[0]?.n);
}

async function deleteSmgMonth(
  year: number,
  month: number,
  monthKeyValue: string,
  onProgress: (deleted: number) => Promise<void>,
): Promise<number> {
  let deleted = 0;
  while (true) {
    if (currentUtcMonth().key === monthKeyValue) {
      throw new Error("Текущий месяц удалить нельзя");
    }
    const batch = rawCount(
      await prisma.$executeRaw(purgeSmgBatchSql(year, month, CDR_PURGE_BATCH_SIZE)),
    );
    if (batch <= 0) break;
    notePurgeBatchCommitted(batch);
    deleted += batch;
    await onProgress(deleted);
    await sleep(BATCH_PAUSE_MS);
  }
  return deleted;
}

async function countSyslogFiles(year: number, month: number): Promise<number> {
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const rows = await listSyslogMonthInventory(syslogRoot());
  return rows.find((row) => row.key === key)?.files ?? 0;
}

/**
 * Journal, then cards and their delay arrays, then SMG rows, syslog, jobs, and audit.
 * Card tags are read before the SMG rows disappear. Delays are the same rows as cards.
 */
async function deleteMonthRemainder(
  jobRunId: string,
  target: CdrMonth,
  stages: PurgeStagesMeta,
  cardKeys: string[] | null,
): Promise<{ cards: number; smg: number; syslog: number; jobs: number; audit: number }> {
  stages.journal = { done: 0, total: await countJournalMonth(target.year, target.month) };
  await publishPurgeProgress(jobRunId, target.key, "journal", stages);
  await deleteJournalMonth(
    target.year,
    target.month,
    target.key,
    stages.journal.total,
    async (deleted) => {
      stages.journal.done = deleted;
      await publishPurgeProgress(jobRunId, target.key, "journal", stages);
    },
  );

  const keys = cardKeys ?? (await collectMonthTraceKeys(target.year, target.month));
  const [cardTotal, delayTotal] = await Promise.all([
    countTraceCards(keys),
    countTraceDelays(keys),
  ]);
  stages.cards = { done: 0, total: cardTotal };
  stages.delays = { done: 0, total: delayTotal };
  await publishPurgeProgress(jobRunId, target.key, "cards", stages);
  const removed = await deleteTraceCards(keys, async (cards, delays) => {
    if (cards > 0) notePurgeBatchCommitted(cards);
    stages.cards.done = cards;
    stages.delays.done = delays;
    await publishPurgeProgress(jobRunId, target.key, "cards", stages);
  });
  const cards = removed.cards;

  await publishPurgeProgress(jobRunId, target.key, "smg", stages);
  const smg = await deleteSmgMonth(
    target.year,
    target.month,
    target.key,
    async (deletedCount) => {
      stages.smg.done = deletedCount;
      await publishPurgeProgress(jobRunId, target.key, "smg", stages);
    },
  );

  const syslog = await deleteSyslogMonth(
    syslogRoot(),
    target.year,
    target.month,
    new Date(),
    async (done, total, held) => {
      if (held || done > 0) notePurgeBatchCommitted(1);
      stages.syslog.done = done;
      stages.syslog.total = total;
      await publishPurgeProgress(jobRunId, target.key, "syslog", stages);
    },
  );

  const history = await deleteMonthHistory(target.year, target.month, jobRunId, {
    onPhase: async (phase) => {
      await publishPurgeProgress(jobRunId, target.key, phase, stages);
    },
    onProgress: async (phase, deletedCount) => {
      stages[phase].done = deletedCount;
      await publishPurgeProgress(jobRunId, target.key, phase, stages);
    },
  });
  return { cards, smg, syslog, jobs: history.jobs, audit: history.audit };
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
            phase: "cards",
            targetCount: priorCalls,
            deletedCount: priorCalls,
            deletedSmg: 0,
            historyOnly: true,
          }
        : { month: requested?.key ?? input.month ?? null, phase: "started" },
    },
  });

  let deleted = 0;
  let deletedSmg = 0;
  let deletedCards = 0;
  let deletedSyslog = 0;
  let deletedJobs = 0;
  let deletedAudit = 0;
  let targetCount = 0;
  let succeeded = false;
  const resumeCalls = input.resumeCalls === true;
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
      const [smgTotal, historyTotals, syslogFiles] = await Promise.all([
        countSmgMonth(target.year, target.month),
        countMonthHistory(target.year, target.month, jobRun.id),
        countSyslogFiles(target.year, target.month),
      ]);
      const stages: PurgeStagesMeta = {
        calls: { done: priorCalls, total: priorCalls },
        journal: { done: 0, total: 0 },
        cards: { done: 0, total: 0 },
        delays: { done: 0, total: 0 },
        smg: { done: 0, total: smgTotal },
        syslog: { done: 0, total: syslogFiles },
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
        smg: smgTotal,
        jobs: historyTotals.jobs,
        audit: historyTotals.audit,
        syslog: syslogFiles,
      });
      const remainder = await deleteMonthRemainder(jobRun.id, target, stages, null);
      deletedCards = remainder.cards;
      deletedSmg = remainder.smg;
      deletedSyslog = remainder.syslog;
      deletedJobs = remainder.jobs;
      deletedAudit = remainder.audit;

      invalidateCdrMonthCountCache();
      await finish(jobRun.id, startedAt, input, {
        status: "success",
        deleted: priorCalls,
        deletedSmg,
        deletedCards,
        deletedSyslog,
        deletedJobs,
        deletedAudit,
        targetCount: priorCalls,
        month: target.key,
        errorMessage: null,
      });
      succeeded = true;
      return {
        status: "success",
        jobRunId: jobRun.id,
        phonesParsed: priorCalls,
      };
    }

    if (!resumeCalls) {
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
    } else if (!target) {
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
    const cardKeys = await collectMonthTraceKeys(target.year, target.month);
    const [
      callTotal,
      smgTotal,
      historyTotals,
      syslogFiles,
      cardTotal,
      journalTotal,
      delayTotal,
    ] = await Promise.all([
      prisma.cdrRecord.count({
        where: { cdrDate: { startsWith: `${target.key}-` } },
      }),
      countSmgMonth(target.year, target.month),
      countMonthHistory(target.year, target.month, jobRun.id),
      countSyslogFiles(target.year, target.month),
      countTraceCards(cardKeys),
      countJournalMonth(target.year, target.month),
      countTraceDelays(cardKeys),
    ]);
    targetCount = callTotal;
    const stages: PurgeStagesMeta = {
      calls: { done: 0, total: targetCount },
      journal: { done: 0, total: journalTotal },
      cards: { done: 0, total: cardTotal },
      delays: { done: 0, total: delayTotal },
      smg: { done: 0, total: smgTotal },
      syslog: { done: 0, total: syslogFiles },
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
      smg: smgTotal,
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
      notePurgeBatchCommitted(batch);
      deleted += batch;
      stages.calls.done = deleted;
      await publishPurgeProgress(jobRun.id, target.key, "calls", stages);
      await sleep(BATCH_PAUSE_MS);
    }

    const remainder = await deleteMonthRemainder(jobRun.id, target, stages, cardKeys);
    deletedCards = remainder.cards;
    deletedSmg = remainder.smg;
    deletedSyslog = remainder.syslog;
    deletedJobs = remainder.jobs;
    deletedAudit = remainder.audit;

    invalidateCdrMonthCountCache();
    await finish(jobRun.id, startedAt, input, {
      status: "success",
      deleted,
      deletedSmg,
      deletedCards,
      deletedSyslog,
      deletedJobs,
      deletedAudit,
      targetCount,
      month: target.key,
      errorMessage: null,
    });
    succeeded = true;
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
      deletedSmg,
      deletedCards,
      deletedSyslog,
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
    resetAntifraudMonthStatsCache();
    const month = target?.key ?? null;
    const release = resumeCalls ? succeeded : succeeded || !purgeDeleteCommitted();
    let holdRelease = release;
    if (holdRelease && succeeded && resumeCalls && month) {
      try {
        await clearPurgeContinuationFlags(month);
      } catch (error) {
        holdRelease = false;
        logger.error("cdr.purge.continue_flag_clear_failed", {
          month,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (holdRelease) {
      setPurgeTargetMonth(null);
      if (month) {
        clearPurgeHolds(month);
        clearSmgPurgeHolds(month);
        requestCdrImportDrain("schedule");
        requestSmgImportDrain("schedule");
      }
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
    deletedSmg?: number;
    deletedCards?: number;
    deletedSyslog?: number;
    deletedJobs: number;
    deletedAudit: number;
    targetCount: number;
    month: string | null;
    errorMessage: string | null;
  },
): Promise<void> {
  const deletedSmg = result.deletedSmg ?? 0;
  const deletedCards = result.deletedCards ?? 0;
  const deletedSyslog = result.deletedSyslog ?? 0;
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
          ? `Удалено ${formatCount(result.deleted)} звонков CDR${label ? ` · ${label}` : ""}. Звонков SMG: ${formatCount(deletedSmg)}. Карточек: ${formatCount(deletedCards)}. Архивов Syslog: ${formatCount(deletedSyslog)}. Задач: ${formatCount(result.deletedJobs)}. Аудит: ${formatCount(result.deletedAudit)}.`
          : null),
      meta: {
        month: result.month,
        targetCount: result.targetCount,
        deletedCount: result.deleted,
        deletedSmg,
        deletedCards,
        deletedSyslog,
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
      deletedSmg,
      deletedCards,
      deletedSyslog,
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
    deletedSmg,
    deletedCards,
    deletedSyslog,
    deletedJobs: result.deletedJobs,
    deletedAudit: result.deletedAudit,
  });
}
