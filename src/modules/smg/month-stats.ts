/**
 * Month membership for SMG calls is `disconnect_day` (`YYYY-MM-DD`).
 * Seconds are the integer `duration` field. Anything else counts as 0
 * and does not fail the settings query.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { MINUTE_GRACE_SECONDS } from "@/modules/enrich/types";
import { isDatabaseVacuumActive } from "@/modules/storage/vacuum/gate";
import { parseMonthKey, type CdrMonth } from "@/modules/traffic/cdr-month";

const DAY_GTE = "2000-01-01";
const DAY_LT = "2101-01-01";

export function smgDurationSecondsSql(): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN duration ~ '^[0-9]{1,18}$' THEN duration::numeric
      ELSE 0
    END
  `;
}

export function smgBillableMinutesSql(): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN ${smgDurationSecondsSql()} <= ${MINUTE_GRACE_SECONDS} THEN 0
      ELSE CEIL(${smgDurationSecondsSql()} / 60)
    END
  `;
}

type MonthCountRow = { month_key: string; calls: number };

type MonthStatRow = {
  month_key: string;
  calls: number;
  seconds: number;
  minutes: number;
};

export async function querySmgMonthCallCounts(): Promise<CdrMonth[]> {
  if (isDatabaseVacuumActive()) return [];
  const rows = await prisma.$queryRaw<MonthCountRow[]>(Prisma.sql`
    SELECT left(disconnect_day, 7) AS month_key, COUNT(*)::int AS calls
    FROM smg_cdr_records
    WHERE disconnect_day >= ${DAY_GTE} AND disconnect_day < ${DAY_LT}
    GROUP BY 1
    ORDER BY 1 DESC
  `);
  return rows.flatMap((row) => {
    const parsed = parseMonthKey(row.month_key);
    if (!parsed) return [];
    return [{ ...parsed, count: row.calls }];
  });
}

export type SmgMonthStats = CdrMonth & {
  seconds: number;
  minutes: number;
};

export async function querySmgMonthStats(): Promise<SmgMonthStats[]> {
  if (isDatabaseVacuumActive()) return [];
  const rows = await prisma.$queryRaw<MonthStatRow[]>(Prisma.sql`
    SELECT
      left(disconnect_day, 7) AS month_key,
      COUNT(*)::int AS calls,
      (SUM(${smgDurationSecondsSql()}))::bigint AS seconds,
      (SUM(${smgBillableMinutesSql()}))::bigint AS minutes
    FROM smg_cdr_records
    WHERE disconnect_day >= ${DAY_GTE} AND disconnect_day < ${DAY_LT}
    GROUP BY 1
    ORDER BY 1 DESC
  `);
  const out: SmgMonthStats[] = [];
  for (const row of rows) {
    const parsed = parseMonthKey(row.month_key);
    if (!parsed) continue;
    out.push({
      ...parsed,
      count: row.calls,
      seconds: Number(row.seconds) || 0,
      minutes: Number(row.minutes) || 0,
    });
  }
  return out;
}
