import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { parseDashboardCount } from "@/modules/dashboard/month-prefix";
import { jobRuntime } from "@/modules/jobs/runtime";
import { isDatabaseVacuumActive } from "@/modules/storage/vacuum/gate";

const KEY = "__reg_dashboard_card_figures_v3__";
const TTL_MS = 60_000;
const STATEMENT_TIMEOUT = "8s";

/**
 * Same shape as the trace classifier's sent-line check.
 * PostgreSQL gets this as a bound pattern with the `gi` flag.
 * Do not copy a JavaScript `\b` into the SQL: there it is not a word boundary.
 */
export const ANTIFRAUD_SENT_PATTERN =
  "Request ID\\s*\\[\\d+\\]\\s+(?:is sent|send)(?:[^A-Za-z]|$)";

type AntifraudSlot = { at: number; stamp: string; value: number };

type Cache = {
  antifraud: AntifraudSlot | null;
  failed: { at: number; stamp: string } | null;
  antifraudInflight: Promise<number | null> | null;
};

function cache(): Cache {
  const holder = globalThis as typeof globalThis & { [KEY]?: Cache };
  if (!holder[KEY]) {
    holder[KEY] = { antifraud: null, failed: null, antifraudInflight: null };
  }
  return holder[KEY];
}

export function resetDashboardCardFiguresForTests(): void {
  delete (globalThis as typeof globalThis & { [KEY]?: Cache })[KEY];
}

function vacuumNow(): boolean {
  return isDatabaseVacuumActive() || jobRuntime.isInFlight("db.vacuum");
}

function clearAntifraud(): void {
  const current = cache();
  current.antifraud = null;
  current.failed = null;
}

export function antifraudEventsSql(): Prisma.Sql {
  return Prisma.sql`
    SELECT COALESCE(SUM(
      CASE
        WHEN jsonb_typeof(blocks->'text') = 'string'
        THEN (
          SELECT count(*)::int
          FROM regexp_matches(
            blocks->>'text',
            ${ANTIFRAUD_SENT_PATTERN},
            'gi'
          )
        )
        ELSE 0
      END
    ), 0)::int AS n
    FROM smg_call_traces
    WHERE device_ip NOT IN (
      SELECT ip FROM smg_syslog_nodes WHERE antifraud_enabled = false
    )
  `;
}

/** Sorted IPs of nodes with the antifraud checkbox off. A failed read is a gap. */
async function disabledAntifraudStamp(): Promise<string | null> {
  try {
    const rows = await prisma.smgSyslogNode.findMany({
      where: { antifraudEnabled: false },
      select: { ip: true },
      orderBy: { ip: "asc" },
    });
    return rows.map((row) => row.ip).join(",");
  } catch (error) {
    logger.warn("dashboard.antifraud.nodes_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Sent AntiFraud requests stored in call cards.
 * A successful count for the same disabled-node set is kept for one minute.
 * A failed read waits one minute before the regexp runs again.
 * Vacuum drops the count and does not start that wait.
 */
export async function dashboardAntifraudEvents(now = Date.now()): Promise<number | null> {
  if (vacuumNow()) {
    clearAntifraud();
    return null;
  }
  const held = cache();
  if (held.antifraudInflight) return held.antifraudInflight;

  const promise = runAntifraud(now).finally(() => {
    const current = cache();
    if (current.antifraudInflight === promise) current.antifraudInflight = null;
  });
  held.antifraudInflight = promise;
  return promise;
}

/**
 * The number only when this disabled-node set was counted less than a minute ago.
 * A stale or missing count starts one read and stays a gap until that read lands.
 */
export async function peekDashboardAntifraudEvents(
  now = Date.now(),
): Promise<number | null> {
  if (vacuumNow()) {
    clearAntifraud();
    return null;
  }
  const stamp = await disabledAntifraudStamp();
  if (stamp == null) {
    cache().antifraud = null;
    return null;
  }
  const current = cache();
  if (current.antifraud && current.antifraud.stamp !== stamp) {
    current.antifraud = null;
    current.failed = null;
  }
  if (current.failed && current.failed.stamp !== stamp) current.failed = null;
  if (
    current.antifraud &&
    current.antifraud.stamp === stamp &&
    now - current.antifraud.at < TTL_MS
  ) {
    return current.antifraud.value;
  }
  if (current.antifraudInflight) return null;
  if (
    current.failed &&
    current.failed.stamp === stamp &&
    now - current.failed.at < TTL_MS
  ) {
    return null;
  }
  void dashboardAntifraudEvents(now);
  return null;
}

async function runAntifraud(now: number): Promise<number | null> {
  const stamp = await disabledAntifraudStamp();
  if (stamp == null) {
    cache().antifraud = null;
    return null;
  }
  if (vacuumNow()) {
    clearAntifraud();
    return null;
  }
  const current = cache();
  if (current.antifraud && current.antifraud.stamp !== stamp) current.antifraud = null;
  if (current.failed && current.failed.stamp !== stamp) current.failed = null;
  if (
    current.antifraud &&
    current.antifraud.stamp === stamp &&
    now - current.antifraud.at < TTL_MS
  ) {
    return current.antifraud.value;
  }
  if (
    current.failed &&
    current.failed.stamp === stamp &&
    now - current.failed.at < TTL_MS
  ) {
    return null;
  }
  const outcome = await readAntifraudEvents();
  if (outcome.kind === "vacuum") {
    clearAntifraud();
    return null;
  }
  if (outcome.kind === "fail") {
    const held = cache();
    held.antifraud = null;
    held.failed = { at: now, stamp };
    return null;
  }
  if (vacuumNow()) {
    clearAntifraud();
    return null;
  }
  const held = cache();
  held.failed = null;
  held.antifraud = { at: now, stamp, value: outcome.value };
  return outcome.value;
}

async function readAntifraudEvents(): Promise<
  { kind: "value"; value: number } | { kind: "vacuum" } | { kind: "fail" }
> {
  if (vacuumNow()) return { kind: "vacuum" };
  try {
    const rows = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true)`;
        return tx.$queryRaw<{ n: unknown }[]>(antifraudEventsSql());
      },
      { maxWait: 5_000, timeout: 12_000 },
    );
    if (vacuumNow()) return { kind: "vacuum" };
    const value = parseDashboardCount(rows[0]?.n);
    if (value == null) return { kind: "fail" };
    return { kind: "value", value };
  } catch (error) {
    logger.warn("dashboard.antifraud.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    if (vacuumNow()) return { kind: "vacuum" };
    return { kind: "fail" };
  }
}
