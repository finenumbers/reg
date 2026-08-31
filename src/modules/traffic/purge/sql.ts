import { Prisma } from "@/generated/prisma/client";
import { cdrMonthPrefix } from "@/lib/month-window";

export const CDR_PURGE_BATCH_SIZE = 2000;

export function purgeMonthPrefixSql(year: number, month: number): Prisma.Sql {
  return Prisma.sql`cdr_date LIKE ${`${cdrMonthPrefix(year, month)}%`}`;
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
