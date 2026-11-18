/**
 * Traffic list when «Нет RTP» is on. RTP is not a CDR column, so the page
 * id and the facet counts are one statement. The CASE is `rtpExpr`.
 * This is the whole month, not the OPRS mobile predicate.
 */

import { Prisma } from "@/generated/prisma/client";
import {
  EMPTY_FILTER_TOKEN,
  facetQueryMatchesEmptyLabel,
  type ColumnFilters,
} from "@/components/column-filters/types";
import { cdrMonthPrefix } from "@/lib/month-window";
import {
  CALL_CATEGORY,
  CALL_STATUS,
  SUCCESS_CALL_TYPES,
} from "@/modules/traffic/call-class";
import { CDR_PHONE_COLUMNS, isTrafficColumn } from "@/modules/traffic/columns";
import { facetSearchMatch } from "@/modules/traffic/facet-search";
import type { TrafficRowFlags } from "@/modules/traffic/row-flags";
import type { TimeSort } from "@/modules/traffic/traffic-sort";
import { rtpAbsentSql } from "@/modules/voipmonitor/rtp-sql";

export type TrafficNoRtpSqlInput = {
  year: number;
  month: number;
  filters: ColumnFilters;
  phoneQ: string;
  flags: TrafficRowFlags;
  guiHost: string;
  excludeColumn?: string;
  timeSort: TimeSort | null;
};

/** An empty host makes the RTP arm false. Another checkbox can still match. */
export function trafficNoRtpCanMatch(flags: TrafficRowFlags, guiHost: string): boolean {
  if (guiHost) return true;
  return Boolean(
    flags.phantom ||
      flags.callErrors ||
      flags.parking ||
      flags.failed ||
      flags.check ||
      flags.success,
  );
}

export function buildTrafficNoRtpSliceSql(input: TrafficNoRtpSqlInput): {
  from: Prisma.Sql;
  where: Prisma.Sql;
} {
  const host = input.guiHost.trim();
  const needsLegs = input.flags.noRtp === true && host !== "";
  const from = needsLegs
    ? Prisma.sql`cdr_records c LEFT JOIN cdr_voipmonitor_links l ON l.cdr_record_id = c.id`
    : Prisma.sql`cdr_records c`;
  const where = andSql([
    Prisma.sql`c.cdr_date LIKE ${`${cdrMonthPrefix(input.year, input.month)}%`}`,
    columnFiltersSql(input.filters, input.excludeColumn),
    phoneSql(input.phoneQ),
    flagSql(input.flags, host),
  ]);
  return { from, where };
}

export function buildTrafficNoRtpCountSql(input: TrafficNoRtpSqlInput): Prisma.Sql {
  const slice = buildTrafficNoRtpSliceSql(input);
  return Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM ${slice.from}
    WHERE ${slice.where}
  `;
}

export function buildTrafficNoRtpPageSql(
  input: TrafficNoRtpSqlInput,
  limit: number,
  offset: number,
): Prisma.Sql {
  const slice = buildTrafficNoRtpSliceSql(input);
  const order =
    input.timeSort === "asc"
      ? Prisma.sql`c.cdr_date ASC, c.cdr_id ASC`
      : Prisma.sql`c.cdr_date DESC, c.cdr_id DESC`;
  const take = Math.min(200, Math.max(1, limit));
  const skip = Math.max(0, offset);
  return Prisma.sql`
    SELECT c.id
    FROM ${slice.from}
    WHERE ${slice.where}
    ORDER BY ${order}
    LIMIT ${take} OFFSET ${skip}
  `;
}

export function buildTrafficNoRtpFacetSql(
  input: TrafficNoRtpSqlInput,
  column: string,
  q: string,
  limit: number,
): Prisma.Sql {
  const expr = columnExpr(column);
  const slice = buildTrafficNoRtpSliceSql({ ...input, excludeColumn: column });
  const take = Math.min(500, Math.max(1, limit)) + 1;
  const order = column === "cdr_day" ? Prisma.sql`value ASC` : Prisma.sql`COUNT(*) DESC`;
  return Prisma.sql`
    SELECT value, COUNT(*)::bigint AS count
    FROM (
      SELECT ${expr} AS value
      FROM ${slice.from}
      WHERE ${slice.where}
        AND ${facetMatchSql(column, expr, q)}
    ) facet_rows
    GROUP BY value
    ORDER BY ${order}
    LIMIT ${take}
  `;
}

function columnExpr(column: string): Prisma.Sql {
  if (!isTrafficColumn(column) || !/^[a-z0-9_]+$/.test(column)) {
    throw new Error("Некорректный столбец");
  }
  return Prisma.raw(`c.${column}`);
}

function columnFiltersSql(filters: ColumnFilters, exclude?: string): Prisma.Sql | null {
  const parts: Prisma.Sql[] = [];
  for (const [column, values] of Object.entries(filters)) {
    if (exclude === column || !values?.length) continue;
    if (!isTrafficColumn(column) || !/^[a-z0-9_]+$/.test(column)) continue;
    parts.push(equalsAny(columnExpr(column), tokenTexts(values)));
  }
  return parts.length === 0 ? null : andSql(parts);
}

function phoneSql(phoneQ: string): Prisma.Sql | null {
  const q = phoneQ.trim();
  if (!q) return null;
  return orSql(CDR_PHONE_COLUMNS.map((column) => likeSql(columnExpr(column), q)));
}

function flagSql(flags: TrafficRowFlags, host: string): Prisma.Sql | null {
  const parts: Prisma.Sql[] = [];
  if (flags.phantom) parts.push(Prisma.sql`c.call_category = ${CALL_CATEGORY.phantom}`);
  if (flags.callErrors) parts.push(Prisma.sql`c.call_category = ${CALL_CATEGORY.errors}`);
  if (flags.parking) parts.push(Prisma.sql`c.call_status = ${CALL_STATUS.parking}`);
  if (flags.failed) parts.push(Prisma.sql`c.call_status = ${CALL_STATUS.failed}`);
  if (flags.check) parts.push(Prisma.sql`c.call_category = ${CALL_CATEGORY.check}`);
  if (flags.success) {
    parts.push(Prisma.sql`(
      c.call_status = ${CALL_STATUS.success}
      AND (
        c.call_category = ${CALL_CATEGORY.incoming}
        OR (
          c.call_category = ${CALL_CATEGORY.outgoing}
          AND c.call_type IN (${Prisma.join([...SUCCESS_CALL_TYPES])})
        )
      )
    )`);
  }
  if (flags.noRtp) parts.push(host ? rtpAbsentSql(host) : Prisma.sql`FALSE`);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!;
  return orSql(parts);
}

function facetMatchSql(column: string, expr: Prisma.Sql, q: string): Prisma.Sql {
  const trimmed = q.trim();
  if (!trimmed) return Prisma.sql`TRUE`;
  const match = facetSearchMatch(column, trimmed);
  const empty = facetQueryMatchesEmptyLabel(trimmed);
  if (match.kind === "in") {
    const listed = equalsAny(expr, match.values);
    return empty ? Prisma.sql`(${listed} OR ${expr} = '')` : listed;
  }
  const likes = match.needles.map((needle) => likeSql(expr, needle));
  const listed = likes.length === 0 ? null : orSql(likes);
  if (empty && listed) return Prisma.sql`(${listed} OR ${expr} = '')`;
  if (empty) return Prisma.sql`${expr} = ''`;
  return listed ?? Prisma.sql`TRUE`;
}

function tokenTexts(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => (value === EMPTY_FILTER_TOKEN ? "" : value)))];
}

function equalsAny(expr: Prisma.Sql, values: readonly string[]): Prisma.Sql {
  if (values.length === 0) return Prisma.sql`FALSE`;
  if (values.length === 1) return Prisma.sql`${expr} = ${values[0]!}`;
  return Prisma.sql`${expr} IN (${Prisma.join([...values])})`;
}

/** `%`, `_`, and `\` stay letters in ILIKE. Same rule as the OPRS slice. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function likeSql(expr: Prisma.Sql, needle: string): Prisma.Sql {
  return Prisma.sql`${expr} ILIKE ${"%" + escapeLike(needle) + "%"} ESCAPE E'\\\\'`;
}

function andSql(parts: Array<Prisma.Sql | null>): Prisma.Sql {
  const present = parts.filter((part): part is Prisma.Sql => part != null);
  if (present.length === 0) return Prisma.sql`TRUE`;
  if (present.length === 1) return present[0]!;
  return Prisma.sql`(${Prisma.join(present, " AND ")})`;
}

function orSql(parts: Prisma.Sql[]): Prisma.Sql {
  if (parts.length === 0) return Prisma.sql`FALSE`;
  if (parts.length === 1) return parts[0]!;
  return Prisma.sql`(${Prisma.join(parts, " OR ")})`;
}
