/**
 * List and facet predicates for the mask catalog.
 * Pure — no Prisma / React. One cell-text function feeds the table and the filter.
 */

import {
  aggregateFacetItems,
  cellToFilterToken,
  type ColumnFilters,
  type FacetResponse,
} from "@/components/column-filters/types";
import type { MaskListItem } from "@/modules/masks/service";

export const MASK_COLUMN_ORDER = [
  "digitLength",
  "category",
  "abc",
  "mask",
  "maskType",
  "premium",
  "purchase",
] as const;

export type MaskColumnId = (typeof MASK_COLUMN_ORDER)[number];

export const MASK_COLUMN_HEADERS: Record<MaskColumnId, string> = {
  digitLength: "Разрядность",
  category: "Категория",
  abc: "ABC",
  mask: "Маска",
  maskType: "Тип",
  premium: "Премиум",
  purchase: "Покупка",
};

const MASK_COLUMNS = new Set<string>(MASK_COLUMN_ORDER);

export function isMaskColumn(column: string): column is MaskColumnId {
  return MASK_COLUMNS.has(column);
}

/** Painted cell text. Blank stays blank so the facet token can become «(пусто)». */
export function maskCellText(row: MaskListItem, column: string): string {
  switch (column) {
    case "digitLength":
      return String(row.digitLength);
    case "category":
      return row.category;
    case "abc":
      return row.abc ?? "";
    case "mask":
      return row.mask;
    case "maskType":
      return row.maskType ?? "";
    case "premium":
      return row.premium ?? "";
    case "purchase":
      return row.purchase ?? "";
    default:
      return "";
  }
}

export type MaskQuery = {
  filters?: ColumnFilters;
  excludeColumn?: string;
};

function applyColumnFilters(
  rows: MaskListItem[],
  filters: ColumnFilters,
  opts: { excludeColumn?: string } = {},
): MaskListItem[] {
  const entries = Object.entries(filters).filter(
    ([col, values]) =>
      isMaskColumn(col) &&
      values.length > 0 &&
      (!opts.excludeColumn || col !== opts.excludeColumn),
  );
  if (entries.length === 0) return rows;
  return rows.filter((row) =>
    entries.every(([col, values]) =>
      values.includes(cellToFilterToken(maskCellText(row, col))),
    ),
  );
}

/** Column filters. Within a column values are OR; across columns they are AND. */
export function applyMaskQuery(
  rows: MaskListItem[],
  query: MaskQuery = {},
): MaskListItem[] {
  return applyColumnFilters(rows, query.filters ?? {}, {
    excludeColumn: query.excludeColumn,
  });
}

/** Facets for one column. Search runs on the full mutual set, then the limit. */
export function maskFacets(
  rows: MaskListItem[],
  opts: {
    column: string;
    filters?: ColumnFilters;
    q?: string;
    limit?: number;
  },
): FacetResponse {
  if (!isMaskColumn(opts.column)) return { items: [], truncated: false };
  const filtered = applyMaskQuery(rows, {
    filters: opts.filters,
    excludeColumn: opts.column,
  });
  return aggregateFacetItems(
    filtered.map((row) => maskCellText(row, opts.column)),
    { q: opts.q, limit: opts.limit },
  );
}
