import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { civilTimestamptzSql } from "@/modules/traffic/civil-timestamptz";
import { CDR_DATE_CIVIL_REGEX } from "@/modules/traffic/cdr-date-parts";

export { CDR_DATE_CIVIL_REGEX };

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
        ${civilTimestamptzSql(Prisma.sql`cdr_date`, Prisma.sql`'UTC'`)} AS parsed
      FROM cdr_records
      WHERE cdr_date ~ ${CDR_DATE_CIVIL_REGEX}
    ) AS v
    WHERE c.id = v.id
      AND v.parsed IS NOT NULL
      AND c."cdrAt" IS DISTINCT FROM v.parsed
  `;
}

export async function syncCdrAtFromCdrDate(): Promise<number> {
  return prisma.$executeRaw(buildSyncCdrAtSql());
}
