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
import {
  billableMinutesSql,
  billableSecondsSql,
} from "@/modules/traffic/billable-minutes-sql";
import { isDatabaseVacuumActive } from "@/modules/storage/vacuum/gate";

const CACHE_TTL_MS = 60_000;
const KEY = "__reg_cdr_month_counts__";

type Cache = {
  at: number;
  months: CdrMonth[];
};

type CacheStore = { slot: Cache | null; inflight: Promise<CdrMonth[]> | null };

function cacheStore(): CacheStore {
  const g = globalThis as typeof globalThis & { [KEY]?: CacheStore };
  if (!g[KEY]) g[KEY] = { slot: null, inflight: null };
  if (g[KEY].inflight === undefined) g[KEY].inflight = null;
  return g[KEY];
}

export function invalidateCdrMonthCountCache(): void {
  cacheStore().slot = null;
}

/** Months already counted in this process. Does not start a scan and does not invent a zero. */
export function peekCachedMonthCounts(): CdrMonth[] | null {
  return cacheStore().slot?.months ?? null;
}

type MonthCountRow = { month_key: string; calls: number };

export async function queryMonthCallCounts(): Promise<CdrMonth[]> {
  if (isDatabaseVacuumActive()) {
    return [];
  }
  const rows = await prisma.$queryRaw<MonthCountRow[]>(Prisma.sql`
    SELECT left(cdr_day, 7) AS month_key, COUNT(*)::int AS calls
    FROM cdr_records
    WHERE cdr_day >= '2000-01-01' AND cdr_day < '2101-01-01'
    GROUP BY 1
    ORDER BY 1 DESC
  `);
  return rowsToMonths(rows);
}

type MonthStatRow = {
  month_key: string;
  calls: number;
  seconds: number;
  minutes: number;
};

export function monthStatsWithDurationSql(): Prisma.Sql {
  return Prisma.sql`
    SELECT
      left(cdr_day, 7) AS month_key,
      COUNT(*)::int AS calls,
      (SUM(${billableSecondsSql()}))::bigint AS seconds,
      (SUM(${billableMinutesSql()}))::bigint AS minutes
    FROM cdr_records
    WHERE cdr_day >= '2000-01-01' AND cdr_day < '2101-01-01'
    GROUP BY 1
    ORDER BY 1 DESC
  `;
}

export async function queryMonthStatsWithMinutes(): Promise<
  Array<CdrMonth & { seconds: number; minutes: number }>
> {
  if (isDatabaseVacuumActive()) return [];
  const rows = await prisma.$queryRaw<MonthStatRow[]>(monthStatsWithDurationSql());
  const out: Array<CdrMonth & { seconds: number; minutes: number }> = [];
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

function rowsToMonths(rows: MonthCountRow[]): CdrMonth[] {
  const out: CdrMonth[] = [];
  for (const row of rows) {
    const parsed = parseMonthKey(row.month_key);
    if (!parsed) continue;
    out.push({ ...parsed, count: row.calls });
  }
  return out;
}

export async function listCachedMonthCounts(now = Date.now()): Promise<CdrMonth[]> {
  const store = cacheStore();
  const hit = store.slot;
  if (isDatabaseVacuumActive()) {
    if (hit) return withCurrentMonth(hit.months, currentUtcMonth());
    return withCurrentMonth([], currentUtcMonth());
  }
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return withCurrentMonth(hit.months, currentUtcMonth());
  }
  if (!store.inflight) {
    store.inflight = queryMonthCallCounts()
      .then((months) => {
        cacheStore().slot = { at: Date.now(), months };
        return months;
      })
      .finally(() => {
        cacheStore().inflight = null;
      });
  }
  const months = await store.inflight;
  return withCurrentMonth(months, currentUtcMonth());
}
