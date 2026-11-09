/**
 * List and facet predicates for the tariff catalog.
 * Pure — no Prisma / React. Cell text is the same string the table paints.
 */

import {
  aggregateFacetItems,
  cellToFilterToken,
  type ColumnFilters,
  type FacetResponse,
} from "@/components/column-filters/types";
import { formatMoney2 } from "@/lib/format-money";
import type { TariffListItem } from "@/modules/tariffs/service";
import {
  abcIgnoresDigitLengths,
  RUSSIAN_NUMBER_LENGTH,
} from "@/modules/traffic/tariff-match";

export const TARIFF_COLUMN_ORDER = [
  "direction",
  "region",
  "abc",
  "digitLength",
  "numbering",
  "price",
] as const;

export type TariffColumnId = (typeof TARIFF_COLUMN_ORDER)[number];

export const TARIFF_COLUMN_HEADERS: Record<TariffColumnId, string> = {
  direction: "Направления",
  region: "Регион",
  abc: "ABC",
  digitLength: "Разрядность",
  numbering: "Нумерация",
  price: "Цена",
};

const TARIFF_COLUMNS = new Set<string>(TARIFF_COLUMN_ORDER);

export function isTariffColumn(column: string): column is TariffColumnId {
  return TARIFF_COLUMNS.has(column);
}

/** Screen label. Any ABC that starts with 7 shows 11, including a non-bold 77. */
export function tariffDigitLengthLabel(
  abc: string,
  digitLengths: number[] | null,
): string {
  if (abcIgnoresDigitLengths(abc)) return String(RUSSIAN_NUMBER_LENGTH);
  if (digitLengths == null || digitLengths.length === 0) return "";
  return digitLengths.join("/");
}

export function tariffNumberingLabel(numbering: number[] | null): string {
  if (numbering == null || numbering.length === 0) return "";
  return numbering.join("/");
}

/** Painted cell text. Price is two decimal places, the same as the table. */
export function tariffCellText(row: TariffListItem, column: string): string {
  switch (column) {
    case "direction":
      return row.direction;
    case "region":
      return row.region ?? "";
    case "abc":
      return row.abc;
    case "digitLength":
      return tariffDigitLengthLabel(row.abc, row.digitLengths);
    case "numbering":
      return tariffNumberingLabel(row.numbering);
    case "price":
      return formatMoney2(row.price);
    default:
      return "";
  }
}

export type TariffQuery = {
  filters?: ColumnFilters;
  excludeColumn?: string;
};

function applyColumnFilters(
  rows: TariffListItem[],
  filters: ColumnFilters,
  opts: { excludeColumn?: string } = {},
): TariffListItem[] {
  const entries = Object.entries(filters).filter(
    ([col, values]) =>
      isTariffColumn(col) &&
      values.length > 0 &&
      (!opts.excludeColumn || col !== opts.excludeColumn),
  );
  if (entries.length === 0) return rows;
  return rows.filter((row) =>
    entries.every(([col, values]) =>
      values.includes(cellToFilterToken(tariffCellText(row, col))),
    ),
  );
}

/** Column filters. Within a column values are OR; across columns they are AND. */
export function applyTariffQuery(
  rows: TariffListItem[],
  query: TariffQuery = {},
): TariffListItem[] {
  return applyColumnFilters(rows, query.filters ?? {}, {
    excludeColumn: query.excludeColumn,
  });
}

/** Facets for one column. Search runs on the full mutual set, then the limit. */
export function tariffFacets(
  rows: TariffListItem[],
  opts: {
    column: string;
    filters?: ColumnFilters;
    q?: string;
    limit?: number;
  },
): FacetResponse {
  if (!isTariffColumn(opts.column)) return { items: [], truncated: false };
  const filtered = applyTariffQuery(rows, {
    filters: opts.filters,
    excludeColumn: opts.column,
  });
  return aggregateFacetItems(
    filtered.map((row) => tariffCellText(row, opts.column)),
    { q: opts.q, limit: opts.limit },
  );
}
