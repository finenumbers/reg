/**
 * Resume jobs and audit for a purge whose calls are already gone.
 * The interrupted row keeps its month and call count; a later failure does not hide it.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ORPHAN_RECLAIM_MESSAGE } from "@/modules/jobs/reclaim-orphans";
import {
  compareMonthKey,
  currentUtcMonth,
  parseMonthKey,
} from "@/modules/traffic/cdr-month";
import {
  purgeAuditCountSql,
  purgeJobsCountSql,
  purgeSmgCountSql,
  utcMonthInterval,
} from "@/modules/traffic/purge/sql";

/** Names from prisma/migrations/20261010200000_purge_fk_indexes. All of them, or none. */
export const PURGE_FK_INDEX_NAMES = [
  "job_runs_startedAt_idx",
  "cdr_records_lastJobRunId_idx",
  "reg_change_events_jobRunId_idx",
  "phone_endpoints_lastJobRunId_idx",
  "phone_gateways_lastJobRunId_idx",
  "routing_groups_lastJobRunId_idx",
  "reg_current_lastJobRunId_idx",
  "ssh_connection_tests_jobRunId_idx",
  "smg_cdr_records_last_job_run_id_idx",
] as const;

const RESUME_SCAN_LIMIT = 20;

export type ResumePurgeJob = {
  errorMessage: string | null;
  phonesParsed: number | null;
  meta: unknown;
};

export type MonthRemainder = {
  calls: number;
  smg: number;
  jobs: number;
  audit: number;
};

const RESUME_PHASES = new Set([
  "journal",
  "cards",
  "delays",
  "smg",
  "syslog",
  "jobs",
  "audit",
]);

export type ResumeMonth = {
  month: string;
  deletedCalls: number;
};

export type CallContinuationJob = ResumePurgeJob & {
  id: string;
  /** This process just reclaimed the row from `running`. */
  justReclaimed: boolean;
};

export type CallContinuation = {
  month: string;
  jobId: string;
};

type ResumeEnqueue = (input: {
  actionCode: "cdr.purge.month";
  trigger: "schedule";
  month: string;
  historyOnly: true;
  deletedCalls: number;
}) => Promise<{ accepted: boolean }>;

function objectMeta(meta: unknown): Record<string, unknown> | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  return meta as Record<string, unknown>;
}

function finiteCount(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed);
  }
  return 0;
}

function monthFromJob(job: ResumePurgeJob): string | null {
  const meta = objectMeta(job.meta);
  if (typeof meta?.month !== "string") return null;
  return parseMonthKey(meta.month)?.key ?? null;
}

/** Calls already removed by the interrupted purge. phonesParsed wins; old rows also store deletedCount. */
export function deletedCallsFromPurgeJob(job: ResumePurgeJob): number {
  const fromColumn = finiteCount(job.phonesParsed);
  if (fromColumn > 0) return fromColumn;
  return finiteCount(objectMeta(job.meta)?.deletedCount);
}

export function deletedSmgFromPurgeJob(job: ResumePurgeJob): number {
  return finiteCount(objectMeta(job.meta)?.deletedSmg);
}

/** The purge already passed the point where a restart must finish history. */
export function purgeHasResumeTrace(job: ResumePurgeJob): boolean {
  if (deletedCallsFromPurgeJob(job) > 0) return true;
  if (deletedSmgFromPurgeJob(job) > 0) return true;
  const phase = objectMeta(job.meta)?.phase;
  return typeof phase === "string" && RESUME_PHASES.has(phase);
}

export function missingPurgeFkIndexNames(present: readonly string[]): string[] {
  const have = new Set(present);
  return PURGE_FK_INDEX_NAMES.filter((name) => !have.has(name));
}

/**
 * Oldest interrupted purge whose calls are gone and whose jobs or audit remain.
 * Jobs that failed for another reason stay in the list and do not hide the interrupted row.
 */
export function selectResumeMonth(input: {
  jobs: readonly ResumePurgeJob[];
  currentMonth: string;
  remainders: ReadonlyMap<string, MonthRemainder>;
}): ResumeMonth | null {
  let best: ResumeMonth | null = null;
  for (const job of input.jobs) {
    if (job.errorMessage !== ORPHAN_RECLAIM_MESSAGE) continue;
    const month = monthFromJob(job);
    if (!month || month === input.currentMonth) continue;
    if (!purgeHasResumeTrace(job)) continue;
    const deletedCalls = deletedCallsFromPurgeJob(job);
    const left = input.remainders.get(month);
    if (!left || left.calls !== 0) continue;
    // Leftover SMG alone waits for the button. Resume only finishes history.
    if (left.jobs + left.audit <= 0) continue;
    if (
      !best ||
      compareMonthKey(month, best.month) < 0 ||
      (month === best.month && deletedCalls > best.deletedCalls)
    ) {
      best = { month, deletedCalls };
    }
  }
  return best;
}

function purgeFkIndexCheckSql(): Prisma.Sql {
  return Prisma.sql`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (${Prisma.join([...PURGE_FK_INDEX_NAMES])})
  `;
}

export async function assertPurgeFkIndexes(): Promise<void> {
  const rows = await prisma.$queryRaw<{ indexname: string }[]>(purgeFkIndexCheckSql());
  const missing = missingPurgeFkIndexNames(rows.map((row) => row.indexname));
  if (missing.length === 0) return;
  throw new Error(`Нет индексов для удаления задач: ${missing.join(", ")}`);
}

async function monthRemainder(month: string): Promise<MonthRemainder> {
  const parsed = parseMonthKey(month);
  if (!parsed) return { calls: 0, smg: 0, jobs: 0, audit: 0 };
  const { start, end } = utcMonthInterval(parsed.year, parsed.month);
  const [calls, smgRows, jobRows, auditRows] = await Promise.all([
    prisma.cdrRecord.count({
      where: { cdrDate: { startsWith: `${month}-` } },
    }),
    prisma.$queryRaw<{ n: unknown }[]>(purgeSmgCountSql(parsed.year, parsed.month)),
    prisma.$queryRaw<{ n: unknown }[]>(purgeJobsCountSql(start, end, "__purge_resume__")),
    prisma.$queryRaw<{ n: unknown }[]>(purgeAuditCountSql(start, end)),
  ]);
  return {
    calls,
    smg: finiteCount(smgRows[0]?.n),
    jobs: finiteCount(jobRows[0]?.n),
    audit: finiteCount(auditRows[0]?.n),
  };
}

/** One history-only purge for the oldest eligible interrupted month. */
export async function enqueueAbandonedPurgeHistory(
  enqueue: ResumeEnqueue,
): Promise<{ month: string | null; accepted: boolean }> {
  const rows = await prisma.jobRun.findMany({
    where: {
      actionCode: "cdr.purge.month",
      status: "failed",
      errorMessage: ORPHAN_RECLAIM_MESSAGE,
    },
    orderBy: { startedAt: "desc" },
    take: RESUME_SCAN_LIMIT,
    select: { errorMessage: true, phonesParsed: true, meta: true },
  });
  const currentMonth = currentUtcMonth().key;
  const remainders = new Map<string, MonthRemainder>();
  const seen = new Set<string>();
  for (const job of rows) {
    const month = monthFromJob(job);
    if (!month || month === currentMonth || seen.has(month)) continue;
    if (!purgeHasResumeTrace(job)) continue;
    seen.add(month);
    remainders.set(month, await monthRemainder(month));
  }
  const selected = selectResumeMonth({ jobs: rows, currentMonth, remainders });
  if (!selected) return { month: null, accepted: false };
  const result = await enqueue({
    actionCode: "cdr.purge.month",
    trigger: "schedule",
    month: selected.month,
    historyOnly: true,
    deletedCalls: selected.deletedCalls,
  });
  if (!result.accepted) {
    logger.warn("cdr.purge.resume.rejected", { month: selected.month });
  }
  return { month: selected.month, accepted: result.accepted };
}

export function continuesDelete(meta: unknown): boolean {
  return objectMeta(meta)?.continueDelete === true;
}

export function withContinueDelete(meta: unknown): Record<string, unknown> {
  return { ...(objectMeta(meta) ?? {}), continueDelete: true };
}

export function withoutContinueDelete(meta: unknown): Record<string, unknown> {
  const next = { ...(objectMeta(meta) ?? {}) };
  delete next.continueDelete;
  return next;
}

function storedMeta(meta: Record<string, unknown>): Prisma.InputJsonValue {
  return meta as Prisma.InputJsonValue;
}

/**
 * Month whose call delete must continue.
 * A historical interrupted row is ignored unless it carries `continueDelete`
 * or this process just reclaimed it from `running`.
 * Calls already gone stay on the history-only path.
 */
export function selectCallContinuation(input: {
  jobs: readonly CallContinuationJob[];
  currentMonth: string;
  remainders: ReadonlyMap<string, MonthRemainder>;
}): CallContinuation | null {
  let best: CallContinuation & { justReclaimed: boolean } | null = null;
  for (const job of input.jobs) {
    if (!job.justReclaimed && !continuesDelete(job.meta)) continue;
    const month = monthFromJob(job);
    if (!month || month === input.currentMonth) continue;
    if (!purgeHasResumeTrace(job)) continue;
    const left = input.remainders.get(month);
    if (!left || left.calls <= 0) continue;
    const candidate = { month, jobId: job.id, justReclaimed: job.justReclaimed };
    if (
      !best ||
      (candidate.justReclaimed && !best.justReclaimed) ||
      (candidate.justReclaimed === best.justReclaimed &&
        (compareMonthKey(month, best.month) < 0 ||
          (month === best.month && candidate.jobId < best.jobId)))
    ) {
      best = candidate;
    }
  }
  return best ? { month: best.month, jobId: best.jobId } : null;
}

type ContinuationSource = ResumePurgeJob & { id: string };

/**
 * Mark the purge this process interrupted, when that month still has calls.
 * A flag whose month no longer has calls is cleared so a later import is kept.
 */
export async function prepareCallContinuation(
  justReclaimed: readonly ContinuationSource[],
): Promise<{ month: string | null }> {
  const flagged = await prisma.jobRun.findMany({
    where: {
      actionCode: "cdr.purge.month",
      meta: { path: ["continueDelete"], equals: true },
    },
    select: { id: true, errorMessage: true, phonesParsed: true, meta: true },
  });

  const byId = new Map<string, CallContinuationJob>();
  for (const job of flagged) {
    byId.set(job.id, { ...job, justReclaimed: false });
  }
  for (const job of justReclaimed) {
    byId.set(job.id, { ...job, justReclaimed: true });
  }
  const jobs = [...byId.values()];
  const currentMonth = currentUtcMonth().key;
  const remainders = new Map<string, MonthRemainder>();
  const seenMonths = new Set<string>();
  for (const job of jobs) {
    if (!job.justReclaimed && !continuesDelete(job.meta)) continue;
    const month = monthFromJob(job);
    if (!month || month === currentMonth || seenMonths.has(month)) continue;
    if (!purgeHasResumeTrace(job)) continue;
    seenMonths.add(month);
    remainders.set(month, await monthRemainder(month));
  }

  for (const job of jobs) {
    if (!continuesDelete(job.meta)) continue;
    const month = monthFromJob(job);
    const left = month ? remainders.get(month) : undefined;
    if (!month || !left || left.calls !== 0) continue;
    const meta = withoutContinueDelete(job.meta);
    job.meta = meta;
    await prisma.jobRun.update({
      where: { id: job.id },
      data: { meta: storedMeta(meta) },
    });
  }

  const selected = selectCallContinuation({ jobs, currentMonth, remainders });
  if (!selected) return { month: null };
  const source = jobs.find((job) => job.id === selected.jobId);
  if (!source) return { month: null };
  await prisma.jobRun.update({
    where: { id: source.id },
    data: { meta: storedMeta(withContinueDelete(source.meta)) },
  });
  return { month: selected.month };
}

/** Drop `continueDelete` on every purge row for this month. */
export async function clearPurgeContinuationFlags(month: string): Promise<number> {
  const rows = await prisma.jobRun.findMany({
    where: {
      actionCode: "cdr.purge.month",
      meta: { path: ["continueDelete"], equals: true },
    },
    select: { id: true, errorMessage: true, phonesParsed: true, meta: true },
  });
  let cleared = 0;
  for (const row of rows) {
    if (monthFromJob(row) !== month || !continuesDelete(row.meta)) continue;
    await prisma.jobRun.update({
      where: { id: row.id },
      data: { meta: storedMeta(withoutContinueDelete(row.meta)) },
    });
    cleared += 1;
  }
  return cleared;
}

/** Continue call deletion for a month already chosen by `prepareCallContinuation`. */
export async function enqueueAbandonedPurgeCalls(
  month: string,
  enqueue: (input: {
    actionCode: "cdr.purge.month";
    trigger: "schedule";
    month: string;
    resumeCalls: true;
  }) => Promise<{ accepted: boolean }>,
): Promise<{ month: string; accepted: boolean }> {
  const result = await enqueue({
    actionCode: "cdr.purge.month",
    trigger: "schedule",
    month,
    resumeCalls: true,
  });
  if (!result.accepted) {
    logger.warn("cdr.purge.continue.rejected", { month });
  }
  return { month, accepted: result.accepted };
}
