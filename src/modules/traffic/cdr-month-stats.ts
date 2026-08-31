/**
 * Month membership and call counts from Дата (`cdr_day`).
 * List/export/DELETE keep the indexed `cdr_date` prefix.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  currentUtcMonth,
  parseMonthKey,
  withCurrentMonth,
  type CdrMonth,
} from "@/modules/traffic/cdr-month";

const CACHE_TTL_MS = 60_000;
const KEY = "__reg_cdr_month_counts__";

type Cache = {
  at: number;
  months: CdrMonth[];
};

function cacheStore(): { slot: Cache | null } {
  const g = globalThis as typeof globalThis & { [KEY]?: { slot: Cache | null } };
  if (!g[KEY]) g[KEY] = { slot: null };
  return g[KEY];
}

export function invalidateCdrMonthCountCache(): void {
  cacheStore().slot = null;
}

type MonthCountRow = { month_key: string; calls: number };

export async function queryMonthCallCounts(): Promise<CdrMonth[]> {
  const rows = await prisma.$queryRaw<MonthCountRow[]>(Prisma.sql`
    SELECT left(cdr_day, 7) AS month_key, COUNT(*)::int AS calls
    FROM cdr_records
    WHERE cdr_day >= '2000-01-01' AND cdr_day < '2101-01-01'
    GROUP BY 1
    ORDER BY 1 DESC
  `);
  return rowsToMonths(rows);
}

type MonthStatRow = { month_key: string; calls: number; minutes: number };

export async function queryMonthStatsWithMinutes(): Promise<
  Array<CdrMonth & { minutes: number }>
> {
  const rows = await prisma.$queryRaw<MonthStatRow[]>(Prisma.sql`
    SELECT
      left(cdr_day, 7) AS month_key,
      COUNT(*)::int AS calls,
      (
        SUM(
          CEIL(
            CASE
              WHEN elapsed_time ~ '^[0-9]+([.,][0-9]+)?$'
              THEN replace(elapsed_time, ',', '.')::numeric
              ELSE 0
            END / 1000
          )
        ) / 60
      )::bigint AS minutes
    FROM cdr_records
    WHERE cdr_day >= '2000-01-01' AND cdr_day < '2101-01-01'
    GROUP BY 1
    ORDER BY 1 DESC
  `);
  const out: Array<CdrMonth & { minutes: number }> = [];
  for (const row of rows) {
    const parsed = parseMonthKey(row.month_key);
    if (!parsed) continue;
    out.push({
      ...parsed,
      count: row.calls,
      minutes: Number(row.minutes) || 0,
    });
  }
  return out;
}

function rowsToMonths(rows: MonthCountRow[]): CdrMonth[] {
  const out: CdrMonth[] = [];
  for (const row of rows) {
    const parsed = parseMonthKey(row.month_key);
    if (!parsed) continue;
    out.push({ ...parsed, count: row.calls });
  }
  return out;
}

export async function listCachedMonthCounts(
  now = Date.now(),
): Promise<CdrMonth[]> {
  const store = cacheStore();
  const hit = store.slot;
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return withCurrentMonth(hit.months, currentUtcMonth());
  }
  const months = await queryMonthCallCounts();
  store.slot = { at: now, months };
  return withCurrentMonth(months, currentUtcMonth());
}

/** Test helper */
export function resetCdrMonthCountCacheForTests(): void {
  cacheStore().slot = null;
}
