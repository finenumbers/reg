/**
 * Concurrent softswitch calls for today and the rolling last hour.
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
import { elapsedMsNumericSql } from "@/modules/traffic/billable-minutes-sql";
import {
  fillConcurrencyMinutes,
  HOUR_MINUTES,
  utcCallWindow,
  type MinuteEventRow,
  type UtcCallWindow,
} from "@/modules/dashboard/concurrency";
import type { DashboardCalls } from "@/modules/dashboard/types";

const CACHE_KEY = "__reg_dashboard_calls__";
const CACHE_TTL_MS = 60_000;
const STATEMENT_TIMEOUT = "8s";
const UNAVAILABLE = "График звонков недоступен.";

type ReadyCalls = Extract<DashboardCalls, { status: "ready" }>;

type CacheStore = {
  cached: { at: number; dayStartMs: number; value: ReadyCalls } | null;
  inflight: Promise<DashboardCalls> | null;
};

type CallSeriesRow = {
  day_carry: number | bigint | null;
  hour_carry: number | bigint | null;
  day_minutes: unknown;
  hour_minutes: unknown;
};

function cacheStore(): CacheStore {
  const g = globalThis as typeof globalThis & { [CACHE_KEY]?: CacheStore };
  if (!g[CACHE_KEY]) g[CACHE_KEY] = { cached: null, inflight: null };
  return g[CACHE_KEY];
}

export async function getDashboardCalls(
  permissions: readonly string[],
  now = new Date(),
): Promise<DashboardCalls> {
  if (!hasPermission(permissions, "phones:read")) return { status: "hidden" };
  if (isDatabaseVacuumActive())
    return { status: "vacuum", message: CDR_VACUUM_BUSY_MESSAGE };

  const bounds = utcCallWindow(now);
  const store = cacheStore();
  const hit = store.cached;
  if (
    hit &&
    hit.dayStartMs === bounds.dayStart.getTime() &&
    Date.now() - hit.at < CACHE_TTL_MS
  ) {
    return hit.value;
  }
  if (store.inflight) return store.inflight;

  const promise = readCalls(bounds)
    .then((value) => {
      if (isDatabaseVacuumActive()) {
        return { status: "vacuum" as const, message: CDR_VACUUM_BUSY_MESSAGE };
      }
      if (value.status === "ready") {
        cacheStore().cached = {
          at: Date.now(),
          dayStartMs: bounds.dayStart.getTime(),
          value,
        };
      }
      return value;
    })
    .finally(() => {
      const current = cacheStore();
      if (current.inflight === promise) current.inflight = null;
    });
  store.inflight = promise;
  return promise;
}

async function readCalls(bounds: UtcCallWindow): Promise<DashboardCalls> {
  if (isDatabaseVacuumActive()) {
    return { status: "vacuum", message: CDR_VACUUM_BUSY_MESSAGE };
  }
  try {
    const rows = await prisma.$transaction((tx) => queryCallMinutes(tx, bounds), {
      maxWait: 5_000,
      timeout: 12_000,
    });
    return seriesFromRows(bounds, rows);
  } catch (error) {
    console.error(
      "[dashboard-calls]",
      error instanceof Error ? error.message : "query failed",
    );
    return { status: "unavailable", message: UNAVAILABLE };
  }
}

async function queryCallMinutes(
  tx: Prisma.TransactionClient,
  bounds: UtcCallWindow,
): Promise<CallSeriesRow[]> {
  await tx.$executeRaw`SELECT set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true)`;
  const elapsed = elapsedMsNumericSql();
  return tx.$queryRaw<CallSeriesRow[]>(Prisma.sql`
    WITH calls AS MATERIALIZED (
      SELECT
        "cdrAt" AS start_at,
        "cdrAt" + (LEAST(ms, 86400000) * INTERVAL '1 millisecond') AS end_at
      FROM (
        SELECT "cdrAt", ${elapsed} AS ms
        FROM cdr_records
        WHERE "cdrAt" >= ${bounds.scanStart}
          AND "cdrAt" < ${bounds.dayEnd}
      ) src
      WHERE ms > 0
    ),
    events AS MATERIALIZED (
      SELECT start_at AS ts, 1 AS delta FROM calls
      UNION ALL
      SELECT end_at AS ts, -1 AS delta FROM calls
    ),
    running AS (
      SELECT
        ts,
        delta,
        sum(delta) OVER (
          ORDER BY ts ASC, delta ASC
          ROWS UNBOUNDED PRECEDING
        )::int AS level
      FROM events
      WHERE ts < ${bounds.seriesEnd}
    ),
    day_minutes AS (
      SELECT
        floor(extract(epoch FROM ts) / 60)::int AS minute_key,
        max(level)::int AS peak,
        (array_agg(level ORDER BY ts DESC, delta DESC))[1]::int AS level_at_end,
        bool_or(
          extract(epoch FROM ts) - floor(extract(epoch FROM ts) / 60) * 60 < 0.0005
        ) AS touches_start
      FROM running
      WHERE ts >= ${bounds.dayStart}
      GROUP BY 1
    ),
    hour_minutes AS (
      SELECT
        floor(extract(epoch FROM ts) / 60)::int AS minute_key,
        max(level)::int AS peak,
        (array_agg(level ORDER BY ts DESC, delta DESC))[1]::int AS level_at_end,
        bool_or(
          extract(epoch FROM ts) - floor(extract(epoch FROM ts) / 60) * 60 < 0.0005
        ) AS touches_start
      FROM running
      WHERE ts >= ${bounds.hourStart}
      GROUP BY 1
    )
    SELECT
      (
        SELECT coalesce(sum(delta), 0)::int
        FROM events
        WHERE ts < ${bounds.dayStart}
      ) AS day_carry,
      (
        SELECT coalesce(sum(delta), 0)::int
        FROM events
        WHERE ts < ${bounds.hourStart}
      ) AS hour_carry,
      (
        SELECT coalesce(
          json_agg(
            json_build_object(
              'minuteKey', minute_key,
              'peak', peak,
              'levelAtEnd', level_at_end,
              'touchesStart', touches_start
            )
          ),
          '[]'::json
        )
        FROM day_minutes
      ) AS day_minutes,
      (
        SELECT coalesce(
          json_agg(
            json_build_object(
              'minuteKey', minute_key,
              'peak', peak,
              'levelAtEnd', level_at_end,
              'touchesStart', touches_start
            )
          ),
          '[]'::json
        )
        FROM hour_minutes
      ) AS hour_minutes
  `);
}

function seriesFromRows(bounds: UtcCallWindow, rows: CallSeriesRow[]): DashboardCalls {
  const row = rows[0];
  if (!row) return { status: "unavailable", message: UNAVAILABLE };
  const dayOrigin = Math.floor(bounds.dayStart.getTime() / 60_000);
  const hourOrigin = Math.floor(bounds.hourStart.getTime() / 60_000);
  const minutes = buildSeries(
    bounds.minuteCount,
    dayOrigin,
    asInt(row.day_carry),
    row.day_minutes,
  );
  const hourMinutes = buildSeries(
    HOUR_MINUTES,
    hourOrigin,
    asInt(row.hour_carry),
    row.hour_minutes,
  );
  if (!minutes || !hourMinutes) return { status: "unavailable", message: UNAVAILABLE };
  return {
    status: "ready",
    day: bounds.day,
    minutes,
    peak: seriesPeak(minutes),
    hour: {
      start: bounds.hourStart.toISOString(),
      minutes: hourMinutes,
      peak: seriesPeak(hourMinutes),
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
