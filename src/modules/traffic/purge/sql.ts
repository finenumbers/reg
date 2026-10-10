import { Prisma } from "@/generated/prisma/client";
import { cdrMonthPrefix } from "@/lib/month-window";

export const CDR_PURGE_BATCH_SIZE = 2000;

export function purgeMonthPrefixSql(year: number, month: number): Prisma.Sql {
  return Prisma.sql`cdr_date LIKE ${`${cdrMonthPrefix(year, month)}%`}`;
}

/** UTC [start, end) for the CDR month key. Not the Settings display timezone. */
export function utcMonthInterval(
  year: number,
  month: number,
): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

/** Same bounds as purgeJobsBatchSql. Excludes the live purge job. */
export function purgeJobsWhereSql(start: Date, end: Date, keepJobId: string): Prisma.Sql {
  return Prisma.sql`"startedAt" >= ${start} AND "startedAt" < ${end} AND id <> ${keepJobId}`;
}

/** Same bounds as purgeAuditBatchSql. */
export function purgeAuditWhereSql(start: Date, end: Date): Prisma.Sql {
  return Prisma.sql`"createdAt" >= ${start} AND "createdAt" < ${end}`;
}

export function purgeJobsCountSql(start: Date, end: Date, keepJobId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT COUNT(*)::bigint AS n
    FROM job_runs
    WHERE ${purgeJobsWhereSql(start, end, keepJobId)}
  `;
}

export function purgeAuditCountSql(start: Date, end: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT COUNT(*)::bigint AS n
    FROM audit_logs
    WHERE ${purgeAuditWhereSql(start, end)}
  `;
}

export function purgeJobsBatchSql(
  start: Date,
  end: Date,
  keepJobId: string,
  limit = CDR_PURGE_BATCH_SIZE,
): Prisma.Sql {
  return Prisma.sql`
    DELETE FROM job_runs
    WHERE id IN (
      SELECT id FROM job_runs
      WHERE ${purgeJobsWhereSql(start, end, keepJobId)}
      LIMIT ${limit}
    )
  `;
}

export function purgeAuditBatchSql(
  start: Date,
  end: Date,
  limit = CDR_PURGE_BATCH_SIZE,
): Prisma.Sql {
  return Prisma.sql`
    DELETE FROM audit_logs
    WHERE id IN (
      SELECT id FROM audit_logs
      WHERE ${purgeAuditWhereSql(start, end)}
      LIMIT ${limit}
    )
  `;
}

export function purgeDeleteBatchSql(
  year: number,
  month: number,
  limit = CDR_PURGE_BATCH_SIZE,
): Prisma.Sql {
  return Prisma.sql`
    DELETE FROM cdr_records
    WHERE id IN (
      SELECT id FROM cdr_records
      WHERE ${purgeMonthPrefixSql(year, month)}
      LIMIT ${limit}
    )
  `;
}
