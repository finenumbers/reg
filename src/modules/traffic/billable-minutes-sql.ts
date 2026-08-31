import { Prisma } from "@/generated/prisma/client";

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

/** Per-call minutes: CEIL(CEIL(ms / 1000) / 60). Not SUM(seconds) / 60. */
export function billableMinutesSql(): Prisma.Sql {
  return Prisma.sql`CEIL(${billableSecondsSql()} / 60)`;
}
