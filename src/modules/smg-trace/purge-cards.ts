import { Prisma } from "@/generated/prisma/client";
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
export async function collectMonthTraceKeys(
  year: number,
  month: number,
): Promise<string[]> {
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

function sqlCount(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/** Cards whose delay array was computed. NULL is not computed. `{}` counts. */
export async function countTraceDelays(keys: readonly string[]): Promise<number> {
  let total = 0;
  for (let index = 0; index < keys.length; index += CARD_BATCH) {
    const batch = keys.slice(index, index + CARD_BATCH);
    const rows = await prisma.$queryRaw<{ n: unknown }[]>`
      SELECT COUNT(*) FILTER (WHERE af_ms_dev IS NOT NULL)::bigint AS n
      FROM smg_call_traces
      WHERE tag_norm IN (${Prisma.join(batch)})
    `;
    total += sqlCount(rows[0]?.n);
  }
  return total;
}

export type TraceCardDelete = {
  cards: number;
  delays: number;
};

/**
 * Delete cards for these tags. Delays live on the same row, so one DELETE
 * removes both. `cards` is rows removed. `delays` is how many of them had
 * a computed `af_ms_dev`.
 */
export async function deleteTraceCards(
  keys: readonly string[],
  onProgress: (cards: number, delays: number) => Promise<void>,
): Promise<TraceCardDelete> {
  let cards = 0;
  let delays = 0;
  for (let index = 0; index < keys.length; index += CARD_BATCH) {
    const batch = keys.slice(index, index + CARD_BATCH);
    const rows = await prisma.$queryRaw<{ had: boolean }[]>`
      DELETE FROM smg_call_traces
      WHERE tag_norm IN (${Prisma.join(batch)})
      RETURNING (af_ms_dev IS NOT NULL) AS had
    `;
    cards += rows.length;
    delays += rows.filter((row) => row.had).length;
    await onProgress(cards, delays);
  }
  return { cards, delays };
}

function addKeys(keys: Set<string>, row: TagRow): void {
  for (const key of traceSearchKeys(row.unique_tag, row.radius_session_id)) keys.add(key);
}
