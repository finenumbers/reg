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
      WHERE "startedAt" >= ${start} AND "startedAt" < ${end}
        AND id <> ${keepJobId}
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
      WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
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
