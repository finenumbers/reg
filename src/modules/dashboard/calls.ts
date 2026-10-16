/**
 * Dashboard call charts for today and the rolling last two hours.
 * Each series has its own cache and in-flight query.
 * Postgres does one sweep. This process only fills the quiet minutes.
 * A failure is not cached and is never turned into a line of zeros.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/modules/rbac/permissions";
import {
  CDR_VACUUM_BUSY_MESSAGE,
  isDatabaseVacuumActive,
} from "@/modules/storage/vacuum/gate";
import { concurrencyMinutesSql, errorMinutesSql } from "@/modules/dashboard/call-query";
import {
  fillConcurrencyMinutes,
  fillEventCounts,
  TWO_HOUR_MINUTES,
  utcCallWindow,
  type MinuteCountRow,
  type MinuteEventRow,
  type UtcCallWindow,
} from "@/modules/dashboard/concurrency";
import type { ConcurrencySeriesId, DashboardSeriesId } from "@/modules/dashboard/series";
import type { DashboardCalls } from "@/modules/dashboard/types";

const CACHE_KEY = "__reg_dashboard_calls_v3__";
const CACHE_TTL_MS = 60_000;
const STATEMENT_TIMEOUT = "8s";
const UNAVAILABLE = "График звонков недоступен.";

type ReadyCalls = Extract<DashboardCalls, { status: "ready" }>;

type CacheSlot = { at: number; dayStartMs: number; value: ReadyCalls };

type CacheStore = {
  cached: Map<DashboardSeriesId, CacheSlot>;
  inflight: Map<DashboardSeriesId, Promise<DashboardCalls>>;
};

type CallSeriesRow = {
  day_carry: number | bigint | null;
  recent_carry: number | bigint | null;
  day_minutes: unknown;
  recent_minutes: unknown;
};

function cacheStore(): CacheStore {
  const g = globalThis as typeof globalThis & { [CACHE_KEY]?: CacheStore };
  if (!g[CACHE_KEY]) {
    g[CACHE_KEY] = { cached: new Map(), inflight: new Map() };
  }
  return g[CACHE_KEY];
}

export async function getDashboardCalls(
  permissions: readonly string[],
  series: DashboardSeriesId,
  now = new Date(),
): Promise<DashboardCalls> {
  if (!hasPermission(permissions, "phones:read")) return { status: "hidden" };
  if (isDatabaseVacuumActive()) return vacuumCalls(series);

  const bounds = utcCallWindow(now);
  const store = cacheStore();
  const hit = store.cached.get(series);
  if (
    hit &&
    hit.dayStartMs === bounds.dayStart.getTime() &&
    Date.now() - hit.at < CACHE_TTL_MS
  ) {
    return hit.value;
  }
  const pending = store.inflight.get(series);
  if (pending) return pending;

  const promise = readCalls(bounds, series)
    .then((value) => {
      if (isDatabaseVacuumActive()) return vacuumCalls(series);
      if (value.status === "ready") {
        cacheStore().cached.set(series, {
          at: Date.now(),
          dayStartMs: bounds.dayStart.getTime(),
          value,
        });
      }
      return value;
    })
    .finally(() => {
      const current = cacheStore();
      if (current.inflight.get(series) === promise) current.inflight.delete(series);
    });
  store.inflight.set(series, promise);
  return promise;
}

function vacuumCalls(series: DashboardSeriesId): DashboardCalls {
  return { status: "vacuum", series, message: CDR_VACUUM_BUSY_MESSAGE };
}

function unavailableCalls(series: DashboardSeriesId): DashboardCalls {
  return { status: "unavailable", series, message: UNAVAILABLE };
}

async function readCalls(
  bounds: UtcCallWindow,
  series: DashboardSeriesId,
): Promise<DashboardCalls> {
  if (isDatabaseVacuumActive()) return vacuumCalls(series);
  try {
    if (series === "errors") {
      const rows = await prisma.$transaction((tx) => queryErrorMinutes(tx, bounds), {
        maxWait: 5_000,
        timeout: 12_000,
      });
      return errorsFromRows(bounds, rows);
    }
    const rows = await prisma.$transaction((tx) => queryCallMinutes(tx, bounds, series), {
      maxWait: 5_000,
      timeout: 12_000,
    });
    return seriesFromRows(bounds, series, rows);
  } catch (error) {
    console.error(
      "[dashboard-calls]",
      error instanceof Error ? error.message : "query failed",
    );
    return unavailableCalls(series);
  }
}

async function queryCallMinutes(
  tx: Prisma.TransactionClient,
  bounds: UtcCallWindow,
  series: ConcurrencySeriesId,
): Promise<CallSeriesRow[]> {
  await tx.$executeRaw`SELECT set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true)`;
  return tx.$queryRaw<CallSeriesRow[]>(concurrencyMinutesSql(bounds, series));
}

type ErrorMinuteRow = {
  minute_key: number | bigint | null;
  day_n: number | bigint | null;
  recent_n: number | bigint | null;
};

async function queryErrorMinutes(
  tx: Prisma.TransactionClient,
  bounds: UtcCallWindow,
): Promise<ErrorMinuteRow[]> {
  await tx.$executeRaw`SELECT set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true)`;
  return tx.$queryRaw<ErrorMinuteRow[]>(errorMinutesSql(bounds));
}

function seriesFromRows(
  bounds: UtcCallWindow,
  series: ConcurrencySeriesId,
  rows: CallSeriesRow[],
): DashboardCalls {
  const row = rows[0];
  if (!row) return unavailableCalls(series);
  const dayOrigin = Math.floor(bounds.dayStart.getTime() / 60_000);
  const recentOrigin = Math.floor(bounds.recentStart.getTime() / 60_000);
  const minutes = buildSeries(
    bounds.minuteCount,
    dayOrigin,
    asInt(row.day_carry),
    row.day_minutes,
  );
  const recentMinutes = buildSeries(
    TWO_HOUR_MINUTES,
    recentOrigin,
    asInt(row.recent_carry),
    row.recent_minutes,
  );
  if (!minutes || !recentMinutes) return unavailableCalls(series);
  return {
    status: "ready",
    series,
    day: bounds.day,
    minutes,
    peak: seriesPeak(minutes),
    recent: {
      start: bounds.recentStart.toISOString(),
      minutes: recentMinutes,
      peak: seriesPeak(recentMinutes),
    },
  };
}

function errorsFromRows(bounds: UtcCallWindow, rows: ErrorMinuteRow[]): DashboardCalls {
  const dayOrigin = Math.floor(bounds.dayStart.getTime() / 60_000);
  const recentOrigin = Math.floor(bounds.recentStart.getTime() / 60_000);
  const dayEvents: MinuteCountRow[] = [];
  const recentEvents: MinuteCountRow[] = [];
  for (const row of rows) {
    const minuteKey = asIntOrNull(row.minute_key);
    const dayCount = asIntOrNull(row.day_n);
    const recentCount = asIntOrNull(row.recent_n);
    if (minuteKey == null || dayCount == null || recentCount == null) {
      return unavailableCalls("errors");
    }
    if (dayCount > 0) dayEvents.push({ minute: minuteKey - dayOrigin, count: dayCount });
    if (recentCount > 0) {
      recentEvents.push({ minute: minuteKey - recentOrigin, count: recentCount });
    }
  }
  const minutes = fillEventCounts(bounds.minuteCount, dayEvents);
  const recentMinutes = fillEventCounts(TWO_HOUR_MINUTES, recentEvents);
  return {
    status: "ready",
    series: "errors",
    day: bounds.day,
    minutes,
    peak: seriesPeak(minutes),
    recent: {
      start: bounds.recentStart.toISOString(),
      minutes: recentMinutes,
      peak: seriesPeak(recentMinutes),
    },
  };
}

function buildSeries(
  minuteCount: number,
  originMinute: number,
  carry: number,
  raw: unknown,
): number[] | null {
  const events = parseMinuteEvents(raw, originMinute);
  if (!events) return null;
  return fillConcurrencyMinutes(minuteCount, carry, events);
}

function parseMinuteEvents(
  value: unknown,
  originMinute: number,
): MinuteEventRow[] | null {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;
  const events: MinuteEventRow[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const minuteKey = asIntOrNull(record.minuteKey);
    const peak = asIntOrNull(record.peak);
    const levelAtEnd = asIntOrNull(record.levelAtEnd);
    if (minuteKey == null || peak == null || levelAtEnd == null) return null;
    events.push({
      minute: minuteKey - originMinute,
      peak,
      levelAtEnd,
      touchesStart: record.touchesStart === true,
    });
  }
  return events;
}

function seriesPeak(minutes: number[]): number {
  return minutes.reduce((max, value) => Math.max(max, value), 0);
}

function asInt(value: number | bigint | null | undefined): number {
  return asIntOrNull(value) ?? 0;
}

function asIntOrNull(value: unknown): number | null {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Number(value))
  ) {
    return Math.trunc(Number(value));
  }
  return null;
}
