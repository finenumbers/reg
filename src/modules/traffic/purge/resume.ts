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
] as const;

const RESUME_SCAN_LIMIT = 20;

export type ResumePurgeJob = {
  errorMessage: string | null;
  phonesParsed: number | null;
  meta: unknown;
};

export type MonthRemainder = {
  calls: number;
  jobs: number;
  audit: number;
};

export type ResumeMonth = {
  month: string;
  deletedCalls: number;
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
    const deletedCalls = deletedCallsFromPurgeJob(job);
    if (deletedCalls <= 0) continue;
    const left = input.remainders.get(month);
    if (!left || left.calls !== 0) continue;
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
  if (!parsed) return { calls: 0, jobs: 0, audit: 0 };
  const { start, end } = utcMonthInterval(parsed.year, parsed.month);
  const [calls, jobRows, auditRows] = await Promise.all([
    prisma.cdrRecord.count({
      where: { cdrDate: { startsWith: `${month}-` } },
    }),
    prisma.$queryRaw<{ n: unknown }[]>(
      purgeJobsCountSql(start, end, "__purge_resume__"),
    ),
    prisma.$queryRaw<{ n: unknown }[]>(purgeAuditCountSql(start, end)),
  ]);
  return {
    calls,
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
    if (deletedCallsFromPurgeJob(job) <= 0) continue;
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
