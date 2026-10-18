import { prisma } from "@/lib/db";
import { traceSearchKeys } from "@/modules/smg-trace/tag";
import { smgMonthDayRange } from "@/modules/smg/month-range";
import { monthKey } from "@/modules/traffic/cdr-month";

const PAGE = 2000;
const CARD_BATCH = 500;

type TagRow = {
  id: string;
  unique_tag: string;
  radius_session_id: string;
};

/**
 * Tags of this month's SMG rows, minus any tag that another month still carries.
 * The caller deletes cards before the SMG rows, so a restart can collect them again.
 */
export async function collectMonthTraceKeys(year: number, month: number): Promise<string[]> {
  const range = smgMonthDayRange({ year, month, key: monthKey(year, month) });
  const keys = new Set<string>();
  let cursor = "";
  while (true) {
    const rows = await prisma.$queryRaw<TagRow[]>`
      SELECT id, unique_tag, radius_session_id
      FROM smg_cdr_records
      WHERE disconnect_day >= ${range.gte}
        AND disconnect_day < ${range.lt}
        AND id > ${cursor}
      ORDER BY id
      LIMIT ${PAGE}
    `;
    if (rows.length === 0) break;
    for (const row of rows) addKeys(keys, row);
    cursor = rows[rows.length - 1]?.id ?? cursor;
    if (rows.length < PAGE) break;
  }
  if (keys.size === 0) return [];

  cursor = "";
  while (keys.size > 0) {
    const rows = await prisma.$queryRaw<TagRow[]>`
      SELECT id, unique_tag, radius_session_id
      FROM smg_cdr_records
      WHERE id > ${cursor}
        AND (disconnect_day < ${range.gte} OR disconnect_day >= ${range.lt})
      ORDER BY id
      LIMIT ${PAGE}
    `;
    if (rows.length === 0) break;
    for (const row of rows) {
      for (const key of traceSearchKeys(row.unique_tag, row.radius_session_id)) {
        keys.delete(key);
      }
    }
    cursor = rows[rows.length - 1]?.id ?? cursor;
    if (rows.length < PAGE) break;
  }
  return [...keys];
}

export async function countTraceCards(keys: readonly string[]): Promise<number> {
  let total = 0;
  for (let index = 0; index < keys.length; index += CARD_BATCH) {
    const batch = keys.slice(index, index + CARD_BATCH);
    total += await prisma.smgCallTrace.count({ where: { tagNorm: { in: batch } } });
  }
  return total;
}

/** Delete cards for these tags. `done` is rows removed, not tags visited. */
export async function deleteTraceCards(
  keys: readonly string[],
  onProgress: (done: number) => Promise<void>,
): Promise<number> {
  let done = 0;
  for (let index = 0; index < keys.length; index += CARD_BATCH) {
    const batch = keys.slice(index, index + CARD_BATCH);
    const result = await prisma.smgCallTrace.deleteMany({ where: { tagNorm: { in: batch } } });
    done += result.count;
    await onProgress(done);
  }
  return done;
}

function addKeys(keys: Set<string>, row: TagRow): void {
  for (const key of traceSearchKeys(row.unique_tag, row.radius_session_id)) keys.add(key);
}
