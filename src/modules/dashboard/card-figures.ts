import { prisma } from "@/lib/db";
import { isDatabaseVacuumActive } from "@/modules/storage/vacuum/gate";
import { querySmgMonthStats } from "@/modules/smg/month-stats";
import { currentUtcMonth } from "@/modules/traffic/cdr-month";

const KEY = "__reg_dashboard_card_figures__";
const TTL_MS = 60_000;

type Cache = {
  antifraud: { at: number; value: number } | null;
  smgMonth: { at: number; key: string; calls: number; minutes: number } | null;
};

function cache(): Cache {
  const holder = globalThis as typeof globalThis & { [KEY]?: Cache };
  if (!holder[KEY]) holder[KEY] = { antifraud: null, smgMonth: null };
  return holder[KEY];
}

/** Stored antifraud legs. A cold or expired value is read at most once a minute. */
export async function dashboardAntifraudEvents(): Promise<number | null> {
  if (isDatabaseVacuumActive()) return null;
  const now = Date.now();
  const held = cache();
  if (held.antifraud && now - held.antifraud.at < TTL_MS) return held.antifraud.value;
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COALESCE(SUM(
      CASE
        WHEN jsonb_typeof(blocks->'antifraud'->'legs') = 'array'
        THEN jsonb_array_length(blocks->'antifraud'->'legs')
        ELSE 0
      END
    ), 0)::int AS n
    FROM smg_call_traces
  `;
  if (isDatabaseVacuumActive()) return null;
  const value = Number(rows[0]?.n ?? 0);
  held.antifraud = { at: now, value };
  return value;
}

/** Current month of SMG CDR. Vacuum and a failed read stay empty, not zero. */
export async function dashboardSmgMonth(
  now: number,
): Promise<{ calls: number; minutes: number } | null> {
  if (isDatabaseVacuumActive()) return null;
  const month = currentUtcMonth(new Date(now));
  const held = cache();
  const at = Date.now();
  if (held.smgMonth && held.smgMonth.key === month.key && at - held.smgMonth.at < TTL_MS) {
    return { calls: held.smgMonth.calls, minutes: held.smgMonth.minutes };
  }
  const stats = await querySmgMonthStats();
  if (isDatabaseVacuumActive()) return null;
  const row = stats.find((item) => item.key === month.key);
  const value = { calls: row?.count ?? 0, minutes: row?.minutes ?? 0 };
  held.smgMonth = { at, key: month.key, ...value };
  return value;
}
