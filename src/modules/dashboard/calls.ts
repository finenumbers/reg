/**
 * Today's concurrent softswitch calls, one number per minute.
 * Postgres does the sweep. This process only fills the quiet minutes.
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
  utcCallDay,
  type MinuteEventRow,
  type UtcCallDay,
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

type CallMinuteRow = {
  carry: number | bigint | null;
  minute_key: number | bigint | null;
  peak: number | bigint | null;
  level_at_end: number | bigint | null;
  touches_start: boolean | null;
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

  const bounds = utcCallDay(now);
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

async function readCalls(bounds: UtcCallDay): Promise<DashboardCalls> {
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
  bounds: UtcCallDay,
): Promise<CallMinuteRow[]> {
  await tx.$executeRaw`SELECT set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true)`;
  const elapsed = elapsedMsNumericSql();
  return tx.$queryRaw<CallMinuteRow[]>(Prisma.sql`
    WITH calls AS MATERIALIZED (
      SELECT
        "cdrAt" AS start_at,
        "cdrAt" + (LEAST(ms, 86400000) * INTERVAL '1 millisecond') AS end_at
      FROM (
        SELECT "cdrAt", ${elapsed} AS ms
        FROM cdr_records
        WHERE "cdrAt" >= ${bounds.lookbackStart}
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
    minutes AS (
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
    carry AS (
      SELECT coalesce(sum(delta), 0)::int AS carry
      FROM events
      WHERE ts < ${bounds.dayStart}
    )
    SELECT
      carry.carry,
      minutes.minute_key,
      minutes.peak,
      minutes.level_at_end,
      minutes.touches_start
    FROM carry
    LEFT JOIN minutes ON true
  `);
}

function seriesFromRows(bounds: UtcCallDay, rows: CallMinuteRow[]): DashboardCalls {
  if (rows.length === 0) return { status: "unavailable", message: UNAVAILABLE };
  const dayMinute = Math.floor(bounds.dayStart.getTime() / 60_000);
  const events: MinuteEventRow[] = [];
  for (const row of rows) {
    if (row.minute_key == null) continue;
    events.push({
      minute: asInt(row.minute_key) - dayMinute,
      peak: asInt(row.peak),
      levelAtEnd: asInt(row.level_at_end),
      touchesStart: row.touches_start === true,
    });
  }
  const minutes = fillConcurrencyMinutes(
    bounds.minuteCount,
    asInt(rows[0]?.carry),
    events,
  );
  return {
    status: "ready",
    day: bounds.day,
    minutes,
    peak: minutes.reduce((max, value) => Math.max(max, value), 0),
  };
}

function asInt(value: number | bigint | null | undefined): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  return 0;
}
