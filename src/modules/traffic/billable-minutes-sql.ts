import { Prisma } from "@/generated/prisma/client";
import { MINUTE_GRACE_SECONDS } from "@/modules/enrich/types";

/** Softswitch `elapsed_time` milliseconds as numeric, or 0. */
export function elapsedMsNumericSql(): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN elapsed_time ~ '^[0-9]+([.,][0-9]+)?$'
      THEN replace(elapsed_time, ',', '.')::numeric
      ELSE 0
    END
  `;
}

/** Per-call seconds: CEIL(ms / 1000). */
export function billableSecondsSql(): Prisma.Sql {
  return Prisma.sql`CEIL(${elapsedMsNumericSql()} / 1000)`;
}

/**
 * Per-call minutes from ceiled seconds.
 * 0 through MINUTE_GRACE_SECONDS stay 0. Longer calls are CEIL(seconds / 60).
 * Not SUM(seconds) / 60.
 */
export function billableMinutesSql(): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN ${billableSecondsSql()} <= ${MINUTE_GRACE_SECONDS} THEN 0
      ELSE CEIL(${billableSecondsSql()} / 60)
    END
  `;
}
