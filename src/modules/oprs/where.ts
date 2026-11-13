/**
 * Fixed OPRS predicate and the snapshot/keyset window.
 * The list never uses OFFSET: imports land in the middle of a month.
 */

import type { Prisma } from "@/generated/prisma/client";
import type { ColumnFilters } from "@/components/column-filters/types";
import { MISSING_PSTN_LABEL } from "@/modules/enrich/types";
import { PARKING_DST } from "@/modules/stats/classify";
import { MOBILE_RF_DIRECTION } from "@/modules/rtu/columns";
import { CALL_CATEGORY } from "@/modules/traffic/call-class";
import { applyMonthFilter } from "@/modules/traffic/cdr-month";
import { isTrafficColumn, OPRS_COLUMNS } from "@/modules/traffic/columns";
import { applyColumnFilters, applyPhoneQ } from "@/modules/traffic/service";
import { trafficFlagWhere, type TrafficRowFlags } from "@/modules/traffic/row-flags";
import type { TimeSort } from "@/modules/traffic/traffic-sort";

export class OprsQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OprsQueryError";
  }
}

export type OprsCursor = {
  cdrDate: string;
  cdrId: string;
};

const OPRS_FILTER_COLUMNS = new Set<string>(
  OPRS_COLUMNS.filter((column) => isTrafficColumn(column)),
);

/** Drop a filter whose column is not on this screen, so a removed column cannot hide rows. */
export function oprsScreenFilters(filters: ColumnFilters): ColumnFilters {
  const out: ColumnFilters = {};
  for (const [column, values] of Object.entries(filters)) {
    if (!values?.length || !OPRS_FILTER_COLUMNS.has(column)) continue;
    out[column] = values;
  }
  return out;
}

/**
 * Outgoing mobile RF, excluding the exact parking terminator and the
 * ministry-registry miss. The operator column is NOT NULL, so an empty
 * operator stays. The comparison is the exact cell text.
 */
export function oprsPredicate(): Prisma.CdrRecordWhereInput {
  return {
    callCategory: CALL_CATEGORY.outgoing,
    tariffDirection: MOBILE_RF_DIRECTION,
    dstName: { not: PARKING_DST },
    operatorB: { not: MISSING_PSTN_LABEL },
  };
}

/**
 * A future stamp is clamped to now. A missing or unparseable stamp is refused
 * so a dropped parameter cannot widen the open snapshot.
 */
export function resolveOprsSnapshot(raw: string | null | undefined, now: Date): Date {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) throw new OprsQueryError("Не указан снимок списка");
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new OprsQueryError("Некорректный снимок списка");
  }
  if (parsed.getTime() > now.getTime()) return now;
  return parsed;
}

/** Strictly after the last row, in the same direction as the list order. */
export function oprsKeysetWhere(
  timeSort: TimeSort | null,
  cursor: OprsCursor,
): Prisma.CdrRecordWhereInput {
  const bound = timeSort === "asc" ? "gt" : "lt";
  return {
    OR: [
      { cdrDate: { [bound]: cursor.cdrDate } },
      {
        AND: [{ cdrDate: cursor.cdrDate }, { cdrId: { [bound]: cursor.cdrId } }],
      },
    ],
  };
}

export function buildOprsWhere(input: {
  year: number;
  month: number;
  filters: ColumnFilters;
  phoneQ: string;
  flags: TrafficRowFlags;
  snapshot: Date;
  cursor: OprsCursor | null;
  timeSort: TimeSort | null;
  excludeColumn?: string;
}): Prisma.CdrRecordWhereInput {
  const parts: Prisma.CdrRecordWhereInput[] = [
    applyPhoneQ(
      applyColumnFilters(
        applyMonthFilter(input.year, input.month),
        oprsScreenFilters(input.filters),
        { excludeColumn: input.excludeColumn },
      ),
      input.phoneQ,
    ),
    oprsPredicate(),
    { importedAt: { lte: input.snapshot } },
  ];
  const flags = trafficFlagWhere(input.flags);
  if (flags) parts.push(flags);
  if (input.cursor) parts.push(oprsKeysetWhere(input.timeSort, input.cursor));
  return { AND: parts };
}
