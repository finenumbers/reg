import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

/**
 * Civil `cdr_date` prefix (no `$`). Fractional seconds still match and sync.
 * Same pattern as the previous full-table UPDATE.
 */
export const CDR_DATE_CIVIL_REGEX =
  "^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2}";

/**
 * Rewrite `cdrAt` from `cdr_date` digits as UTC civil (no display TZ).
 * Safe to run repeatedly: only rows whose `cdrAt` is null or differs are updated.
 */
export function buildSyncCdrAtSql(): Prisma.Sql {
  return Prisma.sql`
    UPDATE cdr_records AS c
    SET "cdrAt" = v.parsed
    FROM (
      SELECT
        id,
        make_timestamptz(
          substring(cdr_date from 1 for 4)::int,
          substring(cdr_date from 6 for 2)::int,
          substring(cdr_date from 9 for 2)::int,
          substring(cdr_date from 12 for 2)::int,
          substring(cdr_date from 15 for 2)::int,
          substring(cdr_date from 18 for 2)::double precision,
          'UTC'
        ) AS parsed
      FROM cdr_records
      WHERE cdr_date ~ ${CDR_DATE_CIVIL_REGEX}
    ) AS v
    WHERE c.id = v.id
      AND c."cdrAt" IS DISTINCT FROM v.parsed
  `;
}

export async function syncCdrAtFromCdrDate(): Promise<number> {
  return prisma.$executeRaw(buildSyncCdrAtSql());
}
