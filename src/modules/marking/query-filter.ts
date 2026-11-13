/**
 * List and facet predicates for the marking catalog.
 * Pure — no Prisma / React. One cell-text function feeds the table and the filter.
 */

import {
  aggregateFacetItems,
  cellToFilterToken,
  type ColumnFilters,
  type FacetResponse,
} from "@/components/column-filters/types";
import type { MarkingListItem } from "@/modules/marking/service";

export const MARKING_COLUMN_ORDER = [
  "client",
  "phoneNumber",
  "labelMts",
  "labelMegafon",
  "labelBeeline",
  "labelT2",
  "mavMts",
  "mavMegafon",
  "mavBeeline",
  "mavT2",
] as const;

export type MarkingColumnId = (typeof MARKING_COLUMN_ORDER)[number];

export const MARKING_COLUMN_HEADERS: Record<MarkingColumnId, string> = {
  client: "Клиент",
  phoneNumber: "Номер",
  labelMts: "Маркировка МТС",
  labelMegafon: "Маркировка Мегафон",
  labelBeeline: "Маркировка Билайн",
  labelT2: "Маркировка Т2",
  mavMts: "МАВ МТС",
  mavMegafon: "МАВ Мегафон",
  mavBeeline: "МАВ Билайн",
  mavT2: "МАВ Т2",
};

const MARKING_COLUMNS = new Set<string>(MARKING_COLUMN_ORDER);

export function isMarkingColumn(column: string): column is MarkingColumnId {
  return MARKING_COLUMNS.has(column);
}

/** Painted cell text. Blank stays blank so the facet token can become «(пусто)». */
export function markingCellText(row: MarkingListItem, column: string): string {
  switch (column) {
    case "client":
      return row.client;
    case "phoneNumber":
      return row.phoneNumber;
    case "labelMts":
      return row.labelMts ?? "";
    case "labelMegafon":
      return row.labelMegafon ?? "";
    case "labelBeeline":
      return row.labelBeeline ?? "";
    case "labelT2":
      return row.labelT2 ?? "";
    case "mavMts":
      return row.mavMts ?? "";
    case "mavMegafon":
      return row.mavMegafon ?? "";
    case "mavBeeline":
      return row.mavBeeline ?? "";
    case "mavT2":
      return row.mavT2 ?? "";
    default:
      return "";
  }
}

export type MarkingQuery = {
  filters?: ColumnFilters;
  excludeColumn?: string;
};

function applyColumnFilters(
  rows: MarkingListItem[],
  filters: ColumnFilters,
  opts: { excludeColumn?: string } = {},
): MarkingListItem[] {
  const entries = Object.entries(filters).filter(
    ([col, values]) =>
      isMarkingColumn(col) &&
      values.length > 0 &&
      (!opts.excludeColumn || col !== opts.excludeColumn),
  );
  if (entries.length === 0) return rows;
  return rows.filter((row) =>
    entries.every(([col, values]) =>
      values.includes(cellToFilterToken(markingCellText(row, col))),
    ),
  );
}

/** Column filters. Within a column values are OR; across columns they are AND. */
export function applyMarkingQuery(
  rows: MarkingListItem[],
  query: MarkingQuery = {},
): MarkingListItem[] {
  return applyColumnFilters(rows, query.filters ?? {}, {
    excludeColumn: query.excludeColumn,
  });
}

/** Facets for one column. Search runs on the full mutual set, then the limit. */
export function markingFacets(
  rows: MarkingListItem[],
  opts: {
    column: string;
    filters?: ColumnFilters;
    q?: string;
    limit?: number;
  },
): FacetResponse {
  if (!isMarkingColumn(opts.column)) return { items: [], truncated: false };
  const filtered = applyMarkingQuery(rows, {
    filters: opts.filters,
    excludeColumn: opts.column,
  });
  return aggregateFacetItems(
    filtered.map((row) => markingCellText(row, opts.column)),
    { q: opts.q, limit: opts.limit },
  );
}
