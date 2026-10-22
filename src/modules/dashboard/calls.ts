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
import {
  answerMinutesSql,
  delayMinutesSql,
  timeoutMinutesSql,
} from "@/modules/dashboard/antifraud-query";
import {
  buildAnswerLines,
  buildDelayLines,
  envelopeMinutes,
  linesPeak,
  zoneCacheKey,
} from "@/modules/dashboard/antifraud-series";
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
import {
  DELAY_DEVICE,
  DELAY_FILE_KEY,
  openDelayMark,
} from "@/modules/smg-trace/delay-pass";
import type { ConcurrencySeriesId, DashboardSeriesId } from "@/modules/dashboard/series";
import type { DashboardCalls, DashboardChartLine } from "@/modules/dashboard/types";

const CACHE_KEY = "__reg_dashboard_calls_v4__";
const DELAY_NOTE = "Задержка по сохранённым карточкам ещё досчитывается.";
const CACHE_TTL_MS = 60_000;
const STATEMENT_TIMEOUT = "8s";
const UNAVAILABLE = "График звонков недоступен.";

type ReadyCalls = Extract<DashboardCalls, { status: "ready" }>;

type CacheSlot = { at: number; dayStartMs: number; stamp: string; value: ReadyCalls };

type Preface = { stamp: string; note: string | null };

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
  let preface: Preface;
  try {
    preface = await antifraudPreface(series);
  } catch (error) {
    console.error(
      "[dashboard-calls]",
      error instanceof Error ? error.message : "zone read failed",
    );
    return unavailableCalls(series);
  }
  const store = cacheStore();
  const hit = store.cached.get(series);
  if (
    hit &&
    hit.stamp === preface.stamp &&
    hit.dayStartMs === bounds.dayStart.getTime() &&
    Date.now() - hit.at < CACHE_TTL_MS
  ) {
    return hit.value;
  }
  const pending = store.inflight.get(series);
  if (pending) return pending;

  const promise = readCalls(bounds, series, preface.note)
    .then((value) => {
      if (isDatabaseVacuumActive()) return vacuumCalls(series);
      if (value.status === "ready") {
        cacheStore().cached.set(series, {
          at: Date.now(),
          dayStartMs: bounds.dayStart.getTime(),
          stamp: preface.stamp,
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

async function antifraudPreface(series: DashboardSeriesId): Promise<Preface> {
  if (series !== "af-answers" && series !== "af-delay") return { stamp: "", note: null };
  const nodes = await prisma.smgSyslogNode.findMany({
    select: { identifier: true, cdrTimezone: true },
  });
  const zones = zoneCacheKey(nodes);
  if (series === "af-answers") return { stamp: zones, note: null };
  const stored = await prisma.smgTraceCheckpoint.findUnique({
    where: { deviceIp_fileKey: { deviceIp: DELAY_DEVICE, fileKey: DELAY_FILE_KEY } },
    select: { state: true },
  });
  const done = openDelayMark(stored?.state).done;
  return { stamp: `${zones}|${done ? "done" : "open"}`, note: done ? null : DELAY_NOTE };
}

async function readCalls(
  bounds: UtcCallWindow,
  series: DashboardSeriesId,
  note: string | null,
): Promise<DashboardCalls> {
  if (isDatabaseVacuumActive()) return vacuumCalls(series);
  try {
    if (series === "errors") {
      const rows = await prisma.$transaction((tx) => queryErrorMinutes(tx, bounds), {
        maxWait: 5_000,
        timeout: 12_000,
      });
      return countsFromRows("errors", bounds, rows);
    }
    if (series === "af-timeout") {
      const rows = await prisma.$transaction((tx) => queryTimeoutMinutes(tx, bounds), {
        maxWait: 5_000,
        timeout: 12_000,
      });
      return countsFromRows("af-timeout", bounds, rows);
    }
    if (series === "af-answers") {
      const rows = await prisma.$transaction((tx) => queryAnswerMinutes(tx, bounds), {
        maxWait: 5_000,
        timeout: 12_000,
      });
      return answersFromRows(bounds, rows, note);
    }
    if (series === "af-delay") {
      const rows = await prisma.$transaction((tx) => queryDelayMinutes(tx, bounds), {
        maxWait: 5_000,
        timeout: 12_000,
      });
      return delaysFromRows(bounds, rows, note);
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

async function queryTimeoutMinutes(
  tx: Prisma.TransactionClient,
  bounds: UtcCallWindow,
): Promise<ErrorMinuteRow[]> {
  await tx.$executeRaw`SELECT set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true)`;
  return tx.$queryRaw<ErrorMinuteRow[]>(timeoutMinutesSql(bounds));
}

type AnswerMinuteRow = {
  af_category: string | null;
  minute_key: number | bigint | null;
  day_n: number | bigint | null;
  recent_n: number | bigint | null;
};

async function queryAnswerMinutes(
  tx: Prisma.TransactionClient,
  bounds: UtcCallWindow,
): Promise<AnswerMinuteRow[]> {
  await tx.$executeRaw`SELECT set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true)`;
  return tx.$queryRaw<AnswerMinuteRow[]>(answerMinutesSql(bounds));
}

type DelayMinuteRow = {
  minute_key: number | bigint | null;
  line: string | null;
  day_mean: number | bigint | null;
  recent_mean: number | bigint | null;
};

async function queryDelayMinutes(
  tx: Prisma.TransactionClient,
  bounds: UtcCallWindow,
): Promise<DelayMinuteRow[]> {
  await tx.$executeRaw`SELECT set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true)`;
  return tx.$queryRaw<DelayMinuteRow[]>(delayMinutesSql(bounds));
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

function countsFromRows(
  series: "errors" | "af-timeout",
  bounds: UtcCallWindow,
  rows: ErrorMinuteRow[],
): DashboardCalls {
  const dayOrigin = Math.floor(bounds.dayStart.getTime() / 60_000);
  const recentOrigin = Math.floor(bounds.recentStart.getTime() / 60_000);
  const dayEvents: MinuteCountRow[] = [];
  const recentEvents: MinuteCountRow[] = [];
  for (const row of rows) {
    const minuteKey = asIntOrNull(row.minute_key);
    const dayCount = asIntOrNull(row.day_n);
    const recentCount = asIntOrNull(row.recent_n);
    if (minuteKey == null || dayCount == null || recentCount == null) {
      return unavailableCalls(series);
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

function answersFromRows(
  bounds: UtcCallWindow,
  rows: AnswerMinuteRow[],
  note: string | null,
): DashboardCalls {
  const dayOrigin = Math.floor(bounds.dayStart.getTime() / 60_000);
  const recentOrigin = Math.floor(bounds.recentStart.getTime() / 60_000);
  const dayRows: { category: string; minute: number; count: number }[] = [];
  const recentRows: { category: string; minute: number; count: number }[] = [];
  for (const row of rows) {
    const minuteKey = asIntOrNull(row.minute_key);
    const dayCount = asIntOrNull(row.day_n);
    const recentCount = asIntOrNull(row.recent_n);
    if (
      typeof row.af_category !== "string" ||
      minuteKey == null ||
      dayCount == null ||
      recentCount == null
    ) {
      return unavailableCalls("af-answers");
    }
    if (dayCount > 0) {
      dayRows.push({
        category: row.af_category,
        minute: minuteKey - dayOrigin,
        count: dayCount,
      });
    }
    if (recentCount > 0) {
      recentRows.push({
        category: row.af_category,
        minute: minuteKey - recentOrigin,
        count: recentCount,
      });
    }
  }
  return linedCalls(
    "af-answers",
    bounds,
    buildAnswerLines(bounds.minuteCount, dayRows),
    buildAnswerLines(TWO_HOUR_MINUTES, recentRows),
    note,
  );
}

function delaysFromRows(
  bounds: UtcCallWindow,
  rows: DelayMinuteRow[],
  note: string | null,
): DashboardCalls {
  const dayOrigin = Math.floor(bounds.dayStart.getTime() / 60_000);
  const recentOrigin = Math.floor(bounds.recentStart.getTime() / 60_000);
  const dayRows: { line: string; minute: number; mean: number }[] = [];
  const recentRows: { line: string; minute: number; mean: number }[] = [];
  for (const row of rows) {
    const minuteKey = asIntOrNull(row.minute_key);
    if (row.line !== "dev" && row.line !== "prod" && row.line !== "parking") {
      return unavailableCalls("af-delay");
    }
    if (minuteKey == null) return unavailableCalls("af-delay");
    const dayMean = optionalInt(row.day_mean);
    const recentMean = optionalInt(row.recent_mean);
    if (dayMean === undefined || recentMean === undefined)
      return unavailableCalls("af-delay");
    if (dayMean != null) {
      dayRows.push({ line: row.line, minute: minuteKey - dayOrigin, mean: dayMean });
    }
    if (recentMean != null) {
      recentRows.push({
        line: row.line,
        minute: minuteKey - recentOrigin,
        mean: recentMean,
      });
    }
  }
  return linedCalls(
    "af-delay",
    bounds,
    buildDelayLines(bounds.minuteCount, dayRows),
    buildDelayLines(TWO_HOUR_MINUTES, recentRows),
    note,
  );
}

function linedCalls(
  series: "af-answers" | "af-delay",
  bounds: UtcCallWindow,
  lines: DashboardChartLine[],
  recentLines: DashboardChartLine[],
  note: string | null,
): DashboardCalls {
  const minutes = envelopeMinutes(lines, bounds.minuteCount);
  const recentMinutes = envelopeMinutes(recentLines, TWO_HOUR_MINUTES);
  return {
    status: "ready",
    series,
    day: bounds.day,
    minutes,
    peak: linesPeak(lines),
    lines,
    note,
    recent: {
      start: bounds.recentStart.toISOString(),
      minutes: recentMinutes,
      peak: linesPeak(recentLines),
      lines: recentLines,
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

function optionalInt(value: unknown): number | null | undefined {
  if (value == null) return null;
  const parsed = asIntOrNull(value);
  return parsed == null ? undefined : parsed;
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
