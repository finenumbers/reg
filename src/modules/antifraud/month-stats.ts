import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { AntifraudMonthStats } from "@/modules/storage/months";
import { parseMonthKey } from "@/modules/traffic/cdr-month";

const CARD_TTL_MS = 30_000;

type JournalRow = { month_key: string; n: unknown };
type CardRow = { month_key: string; cards: unknown; delays: unknown };

let cardCache: { at: number; rows: CardRow[] } | null = null;

/** Test helper. The Settings poll must not rescan SMG tags on every tick. */
export function resetAntifraudMonthStatsCache(): void {
  cardCache = null;
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

/** Parking journal rows grouped by the UTC month of `logged_at`. Undated rows are omitted. */
export function antifraudJournalMonthSql(): Prisma.Sql {
  return Prisma.sql`
    SELECT to_char(logged_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month_key,
           COUNT(*)::bigint AS n
    FROM radius_calls
    WHERE logged_at IS NOT NULL
    GROUP BY 1
  `;
}

/**
 * Each card is counted on the newest SMG month that still carries its tag.
 * A delay is `af_ms_dev IS NOT NULL` (`{}` counts, NULL is not computed).
 */
export function antifraudCardMonthSql(): Prisma.Sql {
  return Prisma.sql`
    WITH tag_month AS (
      SELECT tag_norm, MAX(left(disconnect_day, 7)) AS month_key
      FROM (
        SELECT unique_tag_norm AS tag_norm, disconnect_day
        FROM smg_cdr_records
        WHERE unique_tag_norm <> ''
          AND char_length(disconnect_day) >= 7
        UNION ALL
        SELECT radius_session_norm AS tag_norm, disconnect_day
        FROM smg_cdr_records
        WHERE radius_session_norm <> ''
          AND char_length(disconnect_day) >= 7
      ) keys
      GROUP BY tag_norm
    )
    SELECT
      month_key,
      COUNT(*)::bigint AS cards,
      COUNT(*) FILTER (WHERE af_ms_dev IS NOT NULL)::bigint AS delays
    FROM smg_call_traces
    JOIN tag_month ON tag_month.tag_norm = smg_call_traces.tag_norm
    GROUP BY month_key
  `;
}

async function queryRows<T>(sql: Prisma.Sql): Promise<T[]> {
  const rows = await prisma.$queryRaw<T[]>(sql);
  return Array.isArray(rows) ? rows : [];
}

async function queryCardMonths(): Promise<CardRow[]> {
  const now = Date.now();
  if (cardCache && now - cardCache.at < CARD_TTL_MS) return cardCache.rows;
  const rows = await queryRows<CardRow>(antifraudCardMonthSql());
  cardCache = { at: now, rows };
  return rows;
}

export async function queryAntifraudMonthStats(): Promise<AntifraudMonthStats[]> {
  const [journalRows, cardRows] = await Promise.all([
    queryRows<JournalRow>(antifraudJournalMonthSql()),
    queryCardMonths(),
  ]);
  const byKey = new Map<string, AntifraudMonthStats>();
  const ensure = (key: string): AntifraudMonthStats | null => {
    const parsed = parseMonthKey(key);
    if (!parsed) return null;
    let item = byKey.get(parsed.key);
    if (!item) {
      item = {
        year: parsed.year,
        month: parsed.month,
        key: parsed.key,
        journal: 0,
        cards: 0,
        delays: 0,
      };
      byKey.set(parsed.key, item);
    }
    return item;
  };
  for (const row of journalRows) {
    const item = ensure(row.month_key);
    if (item) item.journal = sqlCount(row.n);
  }
  for (const row of cardRows) {
    const item = ensure(row.month_key);
    if (!item) continue;
    item.cards = sqlCount(row.cards);
    item.delays = sqlCount(row.delays);
  }
  return [...byKey.values()];
}
