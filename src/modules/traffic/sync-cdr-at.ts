import { prisma } from "@/lib/db";

/**
 * Rewrite `cdrAt` from `cdr_date` digits as UTC civil (no display TZ).
 * Safe to run repeatedly.
 */
export async function syncCdrAtFromCdrDate(): Promise<number> {
  return prisma.$executeRaw`
    UPDATE cdr_records
    SET "cdrAt" = make_timestamptz(
      substring(cdr_date from 1 for 4)::int,
      substring(cdr_date from 6 for 2)::int,
      substring(cdr_date from 9 for 2)::int,
      substring(cdr_date from 12 for 2)::int,
      substring(cdr_date from 15 for 2)::int,
      substring(cdr_date from 18 for 2)::double precision,
      'UTC'
    )
    WHERE cdr_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2}'
  `;
}
