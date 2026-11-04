import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { jobRuntime } from "@/modules/jobs/runtime";
import {
  MONTH_CALLS_UNAVAILABLE,
  monthPrefixBounds,
  parseDashboardCount,
} from "@/modules/dashboard/month-prefix";
import { smgBillableMinutesSql } from "@/modules/smg/month-stats";
import {
  CDR_VACUUM_BUSY_MESSAGE,
  isDatabaseVacuumActive,
} from "@/modules/storage/vacuum/gate";
import { currentUtcMonth, type CdrMonth } from "@/modules/traffic/cdr-month";

const KEY = "__reg_dashboard_month_figures_v1__";
const TTL_MS = 60_000;
const STATEMENT_TIMEOUT = "8s";

type CdrSlot = { at: number; calls: number };

type SmgSlot = { at: number; calls: number | null; minutes: number | null };

type Store = {
  cdr: Map<string, CdrSlot>;
  cdrInflight: Map<string, Promise<number | null>>;
  smg: Map<string, SmgSlot>;
  smgInflight: Map<string, Promise<SmgSlot | null>>;
};

function store(): Store {
  const holder = globalThis as typeof globalThis & { [KEY]?: Store };
  if (!holder[KEY]) {
    holder[KEY] = {
      cdr: new Map(),
      cdrInflight: new Map(),
      smg: new Map(),
      smgInflight: new Map(),
    };
  }
  return holder[KEY];
}

export function resetDashboardMonthFiguresForTests(): void {
  delete (globalThis as typeof globalThis & { [KEY]?: Store })[KEY];
}

function monthBusy(): boolean {
  return isDatabaseVacuumActive() || jobRuntime.isInFlight("db.vacuum");
}

export function dashboardCdrMonthSql(bounds: { start: string; end: string }): Prisma.Sql {
  return Prisma.sql`
    SELECT COUNT(*)::bigint AS calls
    FROM cdr_records
    WHERE cdr_day >= ${bounds.start}
      AND cdr_day < ${bounds.end}
  `;
}

export function dashboardSmgMonthSql(bounds: { start: string; end: string }): Prisma.Sql {
  return Prisma.sql`
    SELECT
      COUNT(*)::bigint AS calls,
      COALESCE((SUM(${smgBillableMinutesSql()}))::bigint, 0)::bigint AS minutes
    FROM smg_cdr_records
    WHERE disconnect_day >= ${bounds.start}
      AND disconnect_day < ${bounds.end}
  `;
}

async function queryRows<T>(
  sql: Prisma.Sql,
  label: string,
): Promise<T[] | "vacuum" | "fail"> {
  if (monthBusy()) return "vacuum";
  try {
    const rows = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true)`;
        return tx.$queryRaw<T[]>(sql);
      },
      { maxWait: 5_000, timeout: 12_000 },
    );
    if (monthBusy()) return "vacuum";
    return rows;
  } catch (error) {
    logger.warn(label, {
      error: error instanceof Error ? error.message : String(error),
    });
    return "fail";
  }
}

/** Current UTC month of phone CDR. A skip is not stored as zero. */
export async function readDashboardCdrCalls(
  nowMs: number,
): Promise<{ calls: number | null; note: string | null }> {
  const month = currentUtcMonth(new Date(nowMs));
  const held = store().cdr.get(month.key);
  if (monthBusy()) {
    return held
      ? { calls: held.calls, note: null }
      : { calls: null, note: CDR_VACUUM_BUSY_MESSAGE };
  }
  if (held && nowMs - held.at < TTL_MS) return { calls: held.calls, note: null };

  const value = await loadCdr(month, nowMs);
  if (value != null) return { calls: value, note: null };
  if (monthBusy()) {
    const kept = store().cdr.get(month.key);
    return kept
      ? { calls: kept.calls, note: null }
      : { calls: null, note: CDR_VACUUM_BUSY_MESSAGE };
  }
  const kept = store().cdr.get(month.key);
  if (kept && nowMs - kept.at < TTL_MS) return { calls: kept.calls, note: null };
  if (kept) store().cdr.delete(month.key);
  return { calls: null, note: MONTH_CALLS_UNAVAILABLE };
}

function loadCdr(month: CdrMonth, nowMs: number): Promise<number | null> {
  const inflight = store().cdrInflight;
  const pending = inflight.get(month.key);
  if (pending) return pending;
  const promise = queryCdr(month, nowMs).finally(() => {
    const current = store().cdrInflight;
    if (current.get(month.key) === promise) current.delete(month.key);
  });
  inflight.set(month.key, promise);
  return promise;
}

async function queryCdr(month: CdrMonth, nowMs: number): Promise<number | null> {
  const bounds = monthPrefixBounds(month);
  const rows = await queryRows<{ calls: unknown }>(
    dashboardCdrMonthSql(bounds),
    "dashboard.month.cdr_failed",
  );
  if (rows === "vacuum" || rows === "fail") return null;
  const calls = parseDashboardCount(rows[0]?.calls);
  if (calls == null) return null;
  store().cdr.set(month.key, { at: nowMs, calls });
  return calls;
}

/** Current UTC month of SMG CDR. Minutes may be a gap while calls stay. */
export async function readDashboardSmgMonth(
  nowMs: number,
): Promise<{ calls: number | null; minutes: number | null }> {
  const month = currentUtcMonth(new Date(nowMs));
  const held = store().smg.get(month.key);
  if (monthBusy()) {
    return held
      ? { calls: held.calls, minutes: held.minutes }
      : { calls: null, minutes: null };
  }
  if (held && nowMs - held.at < TTL_MS) {
    return { calls: held.calls, minutes: held.minutes };
  }
  const value = await loadSmg(month, nowMs);
  if (value) return { calls: value.calls, minutes: value.minutes };
  if (monthBusy()) {
    const kept = store().smg.get(month.key);
    return kept
      ? { calls: kept.calls, minutes: kept.minutes }
      : { calls: null, minutes: null };
  }
  const kept = store().smg.get(month.key);
  if (kept && nowMs - kept.at < TTL_MS) {
    return { calls: kept.calls, minutes: kept.minutes };
  }
  if (kept) store().smg.delete(month.key);
  return { calls: null, minutes: null };
}

function loadSmg(month: CdrMonth, nowMs: number): Promise<SmgSlot | null> {
  const inflight = store().smgInflight;
  const pending = inflight.get(month.key);
  if (pending) return pending;
  const promise = querySmg(month, nowMs).finally(() => {
    const current = store().smgInflight;
    if (current.get(month.key) === promise) current.delete(month.key);
  });
  inflight.set(month.key, promise);
  return promise;
}

async function querySmg(month: CdrMonth, nowMs: number): Promise<SmgSlot | null> {
  const bounds = monthPrefixBounds(month);
  const rows = await queryRows<{ calls: unknown; minutes: unknown }>(
    dashboardSmgMonthSql(bounds),
    "dashboard.month.smg_failed",
  );
  if (rows === "vacuum" || rows === "fail") return null;
  const calls = parseDashboardCount(rows[0]?.calls);
  const minutes = parseDashboardCount(rows[0]?.minutes);
  if (calls == null && minutes == null) return null;
  const slot = { at: nowMs, calls, minutes };
  store().smg.set(month.key, slot);
  return slot;
}
