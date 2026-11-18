import { Prisma } from "@/generated/prisma/client";
import { MINUTE_GRACE_SECONDS } from "@/modules/enrich/types";
import type { TimeSort } from "@/modules/traffic/traffic-sort";

const ELAPSED_SORT_RE = /^[0-9]+([.,][0-9]+)?$/;

/** Digits the seconds sort can order, or null when the cell sorts last. */
export function parseElapsedSortKey(raw: string): string | null {
  if (!ELAPSED_SORT_RE.test(raw)) return null;
  return raw.replace(",", ".");
}

export type DurationCursor = {
  elapsed: string;
  cdrId: string;
};

/**
 * Milliseconds for ORDER BY. A blank or non-numeric cell is NULL, so it
 * stays out of the zero-second calls. `elapsedMsNumericSql` is the other
 * rule: those cells count as 0.
 */
export function elapsedMsSortSql(): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN c.elapsed_time ~ '^[0-9]+([.,][0-9]+)?$'
      THEN replace(c.elapsed_time, ',', '.')::numeric
    END
  `;
}

export function durationOrderSql(sort: TimeSort): Prisma.Sql {
  const expr = elapsedMsSortSql();
  if (sort === "asc") return Prisma.sql`${expr} ASC NULLS LAST, c.cdr_id ASC`;
  return Prisma.sql`${expr} DESC NULLS LAST, c.cdr_id DESC`;
}

/** List order. A seconds sort replaces the date order. */
export function cdrListOrderSql(input: {
  timeSort: TimeSort | null;
  durationSort?: TimeSort | null;
}): Prisma.Sql {
  if (input.durationSort) return durationOrderSql(input.durationSort);
  if (input.timeSort === "asc") return Prisma.sql`c.cdr_date ASC, c.cdr_id ASC`;
  return Prisma.sql`c.cdr_date DESC, c.cdr_id DESC`;
}

/**
 * Rows strictly after the cursor. NULLS LAST in both directions.
 * A numeric cursor still includes the blank tail.
 */
export function durationKeysetSql(sort: TimeSort, cursor: DurationCursor): Prisma.Sql {
  const expr = elapsedMsSortSql();
  const value = parseElapsedSortKey(cursor.elapsed);
  if (value == null) {
    if (sort === "asc") {
      return Prisma.sql`(${expr} IS NULL AND c.cdr_id > ${cursor.cdrId})`;
    }
    return Prisma.sql`(${expr} IS NULL AND c.cdr_id < ${cursor.cdrId})`;
  }
  if (sort === "asc") {
    return Prisma.sql`(
      ${expr} > ${value}::numeric
      OR (${expr} = ${value}::numeric AND c.cdr_id > ${cursor.cdrId})
      OR ${expr} IS NULL
    )`;
  }
  return Prisma.sql`(
    ${expr} < ${value}::numeric
    OR (${expr} = ${value}::numeric AND c.cdr_id < ${cursor.cdrId})
    OR ${expr} IS NULL
  )`;
}

type DurationRow = { elapsed: string; cdrId: string };

function elapsedRank(elapsed: string): number | null {
  const key = parseElapsedSortKey(elapsed);
  if (key == null) return null;
  const value = Number(key);
  return Number.isFinite(value) ? value : null;
}

/** Same order as `durationOrderSql`, for values that fit a JS number. */
export function compareDurationRows(
  a: DurationRow,
  b: DurationRow,
  sort: TimeSort,
): number {
  const left = elapsedRank(a.elapsed);
  const right = elapsedRank(b.elapsed);
  if (left == null || right == null) {
    if (left == null && right == null) {
      return sort === "asc"
        ? a.cdrId < b.cdrId
          ? -1
          : a.cdrId > b.cdrId
            ? 1
            : 0
        : a.cdrId > b.cdrId
          ? -1
          : a.cdrId < b.cdrId
            ? 1
            : 0;
    }
    return left == null ? 1 : -1;
  }
  if (left !== right) return sort === "asc" ? left - right : right - left;
  return sort === "asc"
    ? a.cdrId < b.cdrId
      ? -1
      : a.cdrId > b.cdrId
        ? 1
        : 0
    : a.cdrId > b.cdrId
      ? -1
      : a.cdrId < b.cdrId
        ? 1
        : 0;
}

/** True when the row belongs on the page after this cursor. */
export function durationRowFollowsCursor(
  row: DurationRow,
  cursor: DurationCursor,
  sort: TimeSort,
): boolean {
  return compareDurationRows(cursor, row, sort) < 0;
}

/** Softswitch `elapsed_time` milliseconds as numeric, or 0. */
export function elapsedMsNumericSql(): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN elapsed_time ~ '^[0-9]+([.,][0-9]+)?$'
      THEN replace(elapsed_time, ',', '.')::numeric
      ELSE 0
    END
  `;
}

/** Per-call seconds: CEIL(ms / 1000). */
export function billableSecondsSql(): Prisma.Sql {
  return Prisma.sql`CEIL(${elapsedMsNumericSql()} / 1000)`;
}

/**
 * Per-call minutes from ceiled seconds.
 * 0 through MINUTE_GRACE_SECONDS stay 0. Longer calls are CEIL(seconds / 60).
 * Not SUM(seconds) / 60.
 */
export function billableMinutesSql(): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN ${billableSecondsSql()} <= ${MINUTE_GRACE_SECONDS} THEN 0
      ELSE CEIL(${billableSecondsSql()} / 60)
    END
  `;
}
