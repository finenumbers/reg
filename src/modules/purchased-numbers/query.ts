/**
 * Browser query allowlist for the purchased-numbers list.
 */

import {
  parseFiltersParam,
  type ColumnFilters,
} from "@/components/column-filters/types";
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";
import {
  PURCHASED_NUMBER_COLUMNS,
  isPurchasedNumberColumn,
  type PurchasedNumberColumn,
} from "@/modules/purchased-numbers/columns";

export const PURCHASED_NUMBERS_MAX_PAGE = 2000;
export const PURCHASED_NUMBERS_MAX_PAGE_SIZE = 100;
export const PURCHASED_NUMBERS_MAX_FILTERS_CHARS = 16_000;
export const PURCHASED_NUMBERS_MAX_QUERY_CHARS = 64;
export const PURCHASED_NUMBERS_FACET_LIMIT = 200;
export const PURCHASED_NUMBERS_EXPORT_BATCH = 500;

export class PurchasedNumbersQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurchasedNumbersQueryError";
  }
}

export type PurchasedNumbersListQuery = {
  page: number;
  pageSize: number;
  filters: ColumnFilters;
  phoneQ: string;
};

export type PurchasedNumbersFacetQuery = {
  column: PurchasedNumberColumn;
  filters: ColumnFilters;
  phoneQ: string;
  q: string;
  limit: number;
};

function clampPage(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(PURCHASED_NUMBERS_MAX_PAGE, Math.floor(value));
}

function clampPageSize(value: number): number {
  if (!Number.isFinite(value) || value < 1) return TABLE_PAGE_SIZE;
  return Math.min(PURCHASED_NUMBERS_MAX_PAGE_SIZE, Math.floor(value));
}

function readLimited(raw: string | null, label: string): string {
  const value = raw ?? "";
  if (value.length > PURCHASED_NUMBERS_MAX_QUERY_CHARS) {
    throw new PurchasedNumbersQueryError(`Слишком длинный ${label}`);
  }
  return value.trim();
}

export function allowPurchasedNumberFilters(filters: ColumnFilters): ColumnFilters {
  const out: ColumnFilters = {};
  for (const key of PURCHASED_NUMBER_COLUMNS) {
    const values = filters[key];
    if (values?.length) out[key] = values;
  }
  return out;
}

function readFilters(raw: string | null): ColumnFilters {
  if ((raw?.length ?? 0) > PURCHASED_NUMBERS_MAX_FILTERS_CHARS) {
    throw new PurchasedNumbersQueryError("Слишком длинный фильтр");
  }
  return allowPurchasedNumberFilters(parseFiltersParam(raw));
}

export function parsePurchasedNumbersListQuery(
  params: URLSearchParams,
): PurchasedNumbersListQuery {
  const page = Number(params.get("page") ?? "1");
  const pageSize = Number(params.get("pageSize") ?? String(TABLE_PAGE_SIZE));
  return {
    page: clampPage(page),
    pageSize: clampPageSize(pageSize),
    filters: readFilters(params.get("filters")),
    phoneQ: readLimited(params.get("phoneQ"), "поисковый запрос"),
  };
}

export function parsePurchasedNumbersFacetQuery(
  params: URLSearchParams,
): PurchasedNumbersFacetQuery {
  const column = params.get("column")?.trim() ?? "";
  if (!isPurchasedNumberColumn(column)) {
    throw new PurchasedNumbersQueryError("Неизвестный столбец");
  }
  const limitRaw = Number(params.get("limit") ?? String(PURCHASED_NUMBERS_FACET_LIMIT));
  const limit = Number.isFinite(limitRaw)
    ? Math.min(1000, Math.max(1, Math.floor(limitRaw)))
    : PURCHASED_NUMBERS_FACET_LIMIT;
  return {
    column,
    filters: readFilters(params.get("filters")),
    phoneQ: readLimited(params.get("phoneQ"), "поисковый запрос"),
    q: readLimited(params.get("q"), "поисковый запрос"),
    limit,
  };
}
