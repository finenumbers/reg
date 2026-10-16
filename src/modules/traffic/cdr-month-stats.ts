/**
 * Month membership and call counts from Дата (`cdr_day`).
 * List/export/DELETE keep the indexed `cdr_date` prefix.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  cdrMonthDayRange,
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
  const minutes = minutesStore();
  minutes.generation += 1;
  if (minutes.slot) minutes.slot = { ...minutes.slot, at: 0 };
  minutes.failedAt = null;
  minutes.failedKey = null;
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

const MINUTES_KEY = "__reg_cdr_month_minutes__";
const MINUTES_TTL_MS = 60_000;
const MINUTES_STATEMENT_TIMEOUT = "8s";

export type MonthMinutesCacheState = {
  slot: { key: string; at: number; minutes: number } | null;
  failedKey: string | null;
  failedAt: number | null;
};

type MinutesStore = MonthMinutesCacheState & {
  generation: number;
  inflight: Promise<void> | null;
};

function minutesStore(): MinutesStore {
  const g = globalThis as typeof globalThis & { [MINUTES_KEY]?: MinutesStore };
  if (!g[MINUTES_KEY]) {
    g[MINUTES_KEY] = {
      slot: null,
      failedKey: null,
      failedAt: null,
      generation: 0,
      inflight: null,
    };
  }
  return g[MINUTES_KEY];
}

/**
 * Fresh value is returned as-is. A stale value stays visible while one refresh
 * runs. Vacuum and a recent failure do not start a scan.
 */
export function monthMinutesRead(
  now: number,
  monthKey: string,
  state: MonthMinutesCacheState,
  vacuum: boolean,
  ttlMs = MINUTES_TTL_MS,
): { minutes: number | null; startQuery: boolean } {
  const slot = state.slot?.key === monthKey ? state.slot : null;
  if (vacuum) return { minutes: slot?.minutes ?? null, startQuery: false };
  const fresh = slot != null && now - slot.at < ttlMs;
  if (fresh) return { minutes: slot.minutes, startQuery: false };
  const failedRecently =
    state.failedKey === monthKey &&
    state.failedAt != null &&
    now - state.failedAt < ttlMs;
  return { minutes: slot?.minutes ?? null, startQuery: !failedRecently };
}

/** Last total for this month, or a background recount. Never blocks the caller. */
export function readCachedMonthMinutes(
  month: { key: string; year: number; month: number },
  now = Date.now(),
): number | null {
  const store = minutesStore();
  const decision = monthMinutesRead(now, month.key, store, isDatabaseVacuumActive());
  if (decision.startQuery) startMonthMinutesQuery(month);
  return decision.minutes;
}

function startMonthMinutesQuery(month: {
  key: string;
  year: number;
  month: number;
}): void {
  const store = minutesStore();
  if (store.inflight || isDatabaseVacuumActive()) return;
  const generation = store.generation;
  const key = month.key;
  const promise = queryCurrentMonthMinutes(month.year, month.month)
    .then((value) => {
      const current = minutesStore();
      if (current.generation !== generation || value === "skipped") return;
      current.slot = { key, at: Date.now(), minutes: value };
      current.failedAt = null;
      current.failedKey = null;
    })
    .catch((error: unknown) => {
      console.error(
        "[dashboard-month-minutes]",
        error instanceof Error ? error.message : "query failed",
      );
      const current = minutesStore();
      if (current.generation !== generation) return;
      current.failedAt = Date.now();
      current.failedKey = key;
    })
    .finally(() => {
      const current = minutesStore();
      if (current.inflight === promise) current.inflight = null;
    });
  store.inflight = promise;
}

type MonthMinutesRow = { minutes: bigint | number | string | null };

async function queryCurrentMonthMinutes(
  year: number,
  month: number,
): Promise<number | "skipped"> {
  if (isDatabaseVacuumActive()) return "skipped";
  const range = cdrMonthDayRange(year, month);
  const rows = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('statement_timeout', ${MINUTES_STATEMENT_TIMEOUT}, true)`;
      return tx.$queryRaw<MonthMinutesRow[]>(Prisma.sql`
        SELECT COALESCE(SUM(${billableMinutesSql()}), 0)::bigint AS minutes
        FROM cdr_records
        WHERE cdr_day >= ${range.start}
          AND cdr_day < ${range.end}
      `);
    },
    { maxWait: 5_000, timeout: 12_000 },
  );
  if (isDatabaseVacuumActive()) return "skipped";
  return asMonthMinutes(rows[0]?.minutes);
}

function asMonthMinutes(value: bigint | number | string | null | undefined): number {
  const parsed =
    typeof value === "bigint"
      ? Number(value)
      : typeof value === "number"
        ? value
        : typeof value === "string" && /^\d+$/.test(value)
          ? Number(value)
          : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("bad month minutes");
  }
  return parsed;
}
