import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { isDatabaseVacuumActive } from "@/modules/storage/vacuum/gate";
import { querySmgMonthStats } from "@/modules/smg/month-stats";
import { currentUtcMonth } from "@/modules/traffic/cdr-month";

const KEY = "__reg_dashboard_card_figures_v2__";
const TTL_MS = 60_000;
const STATEMENT_TIMEOUT = "8s";

/**
 * Same shape as the trace classifier's sent-line check.
 * PostgreSQL gets this as a bound pattern with the `gi` flag.
 * Do not copy a JavaScript `\b` into the SQL: there it is not a word boundary.
 */
export const ANTIFRAUD_SENT_PATTERN =
  "Request ID\\s*\\[\\d+\\]\\s+(?:is sent|send)(?:[^A-Za-z]|$)";

type Cache = {
  antifraud: { at: number; stamp: string; value: number } | null;
  antifraudInflight: Promise<number | null> | null;
  smgMonth: { at: number; key: string; calls: number; minutes: number } | null;
};

function cache(): Cache {
  const holder = globalThis as typeof globalThis & { [KEY]?: Cache };
  if (!holder[KEY]) {
    holder[KEY] = { antifraud: null, antifraudInflight: null, smgMonth: null };
  }
  return holder[KEY];
}

export function resetDashboardCardFiguresForTests(): void {
  delete (globalThis as typeof globalThis & { [KEY]?: Cache })[KEY];
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

/** Sent AntiFraud requests stored in call cards. A cold value is read at most once a minute. */
export async function dashboardAntifraudEvents(): Promise<number | null> {
  if (isDatabaseVacuumActive()) return null;
  const held = cache();
  if (held.antifraudInflight) return held.antifraudInflight;

  const promise = (async () => {
    const stamp = await disabledAntifraudStamp();
    if (stamp == null || isDatabaseVacuumActive()) return null;
    const now = Date.now();
    const current = cache();
    if (
      current.antifraud &&
      current.antifraud.stamp === stamp &&
      now - current.antifraud.at < TTL_MS
    ) {
      return current.antifraud.value;
    }
    const value = await readAntifraudEvents();
    if (value == null || isDatabaseVacuumActive()) return null;
    cache().antifraud = { at: Date.now(), stamp, value };
    return value;
  })().finally(() => {
    const current = cache();
    if (current.antifraudInflight === promise) current.antifraudInflight = null;
  });
  held.antifraudInflight = promise;
  return promise;
}

async function readAntifraudEvents(): Promise<number | null> {
  if (isDatabaseVacuumActive()) return null;
  try {
    const rows = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true)`;
        return tx.$queryRaw<{ n: number }[]>(antifraudEventsSql());
      },
      { maxWait: 5_000, timeout: 12_000 },
    );
    if (isDatabaseVacuumActive()) return null;
    const value = Number(rows[0]?.n ?? 0);
    return Number.isFinite(value) ? value : null;
  } catch (error) {
    logger.warn("dashboard.antifraud.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Current month of SMG CDR. Vacuum and a failed read stay empty, not zero. */
export async function dashboardSmgMonth(
  now: number,
): Promise<{ calls: number; minutes: number } | null> {
  if (isDatabaseVacuumActive()) return null;
  const month = currentUtcMonth(new Date(now));
  const held = cache();
  const at = Date.now();
  if (
    held.smgMonth &&
    held.smgMonth.key === month.key &&
    at - held.smgMonth.at < TTL_MS
  ) {
    return { calls: held.smgMonth.calls, minutes: held.smgMonth.minutes };
  }
  const stats = await querySmgMonthStats();
  if (isDatabaseVacuumActive()) return null;
  const row = stats.find((item) => item.key === month.key);
  const value = { calls: row?.count ?? 0, minutes: row?.minutes ?? 0 };
  held.smgMonth = { at, key: month.key, ...value };
  return value;
}
