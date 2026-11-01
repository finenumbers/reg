/**
 * Browser query allowlist for the free-numbers proxy.
 */

import {
  parseFiltersParam,
  type ColumnFilters,
} from "@/components/column-filters/types";
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";
import {
  FREE_NUMBER_COLUMNS,
  isFreeNumberColumn,
  type FreeNumberColumn,
} from "@/modules/free-numbers/columns";

export const FREE_NUMBERS_MAX_PAGE = 2000;
export const FREE_NUMBERS_MAX_PAGE_SIZE = 100;
export const FREE_NUMBERS_MAX_FILTERS_CHARS = 16_000;
export const FREE_NUMBERS_MAX_QUERY_CHARS = 64;
export const FREE_NUMBERS_FACET_LIMIT = 200;

export class FreeNumbersQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FreeNumbersQueryError";
  }
}

export type FreeNumbersListQuery = {
  page: number;
  pageSize: number;
  filters: ColumnFilters;
  phoneQ: string;
};

export type FreeNumbersFacetQuery = {
  column: FreeNumberColumn;
  filters: ColumnFilters;
  phoneQ: string;
  q: string;
  limit: number;
};

function clampPage(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(FREE_NUMBERS_MAX_PAGE, Math.floor(value));
}

function clampPageSize(value: number): number {
  if (!Number.isFinite(value) || value < 1) return TABLE_PAGE_SIZE;
  return Math.min(FREE_NUMBERS_MAX_PAGE_SIZE, Math.floor(value));
}

function readLimited(raw: string | null, label: string): string {
  const value = raw ?? "";
  if (value.length > FREE_NUMBERS_MAX_QUERY_CHARS) {
    throw new FreeNumbersQueryError(`Слишком длинный ${label}`);
  }
  return value.trim();
}

export function allowFreeNumberFilters(filters: ColumnFilters): ColumnFilters {
  const out: ColumnFilters = {};
  for (const key of FREE_NUMBER_COLUMNS) {
    const values = filters[key];
    if (values?.length) out[key] = values;
  }
  return out;
}

function readFilters(raw: string | null): ColumnFilters {
  if ((raw?.length ?? 0) > FREE_NUMBERS_MAX_FILTERS_CHARS) {
    throw new FreeNumbersQueryError("Слишком длинный фильтр");
  }
  return allowFreeNumberFilters(parseFiltersParam(raw));
}

export function parseFreeNumbersListQuery(
  params: URLSearchParams,
): FreeNumbersListQuery {
  const page = Number(params.get("page") ?? "1");
  const pageSize = Number(params.get("pageSize") ?? String(TABLE_PAGE_SIZE));
  return {
    page: clampPage(page),
    pageSize: clampPageSize(pageSize),
    filters: readFilters(params.get("filters")),
    phoneQ: readLimited(params.get("phoneQ"), "поисковый запрос"),
  };
}

export function parseFreeNumbersFacetQuery(
  params: URLSearchParams,
): FreeNumbersFacetQuery {
  const column = params.get("column")?.trim() ?? "";
  if (!isFreeNumberColumn(column)) {
    throw new FreeNumbersQueryError("Неизвестный столбец");
  }
  const limitRaw = Number(params.get("limit") ?? String(FREE_NUMBERS_FACET_LIMIT));
  const limit = Number.isFinite(limitRaw)
    ? Math.min(1000, Math.max(1, Math.floor(limitRaw)))
    : FREE_NUMBERS_FACET_LIMIT;
  return {
    column,
    filters: readFilters(params.get("filters")),
    phoneQ: readLimited(params.get("phoneQ"), "поисковый запрос"),
    q: readLimited(params.get("q"), "поисковый запрос"),
    limit,
  };
}

/** Count of blank cells in one column, with every other filter still applied. */
export function emptyCountFilters(
  filters: ColumnFilters,
  column: FreeNumberColumn,
): ColumnFilters {
  return { ...filters, [column]: ["__empty__"] };
}
