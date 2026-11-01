/**
 * Allowlist from the REG table query to PSTN's current-dataset filters.
 * page>1, sort, and dataset never leave this process.
 */

import { parseFiltersParam, type ColumnFilters } from "@/components/column-filters/types";
import {
  isNumberingFacetColumn,
  NUMBERING_FACET_COLUMNS,
  NUMBERING_HEADERS,
  type NumberingFacetColumn,
} from "@/modules/numbering-resource/columns";
import { NumberingQueryError } from "@/modules/numbering-resource/errors";

export const NUMBERING_PAGE_SIZE = 100;
export const NUMBERING_SORT = "abc:asc,rangeStart:asc";
export const NUMBERING_CURSOR_MAX = 512;
export const NUMBERING_FILTERS_MAX_CHARS = 16_000;
export const NUMBERING_FACET_SEARCH_MAX = 100;
export const NUMBERING_VALUE_MAX = 200;
export const NUMBERING_COVERAGE_MAX = 20;
export const NUMBERING_OR_MAX = 50;
export const PHONE_MASK_LENGTH = 10;

export type NumberingFilters = {
  abc: string[];
  operator: string[];
  garTerritory: string[];
  inn: string[];
  uvrAntifraud: string[];
  phoneNumber: string;
};

export const EMPTY_NUMBERING_FILTERS: NumberingFilters = {
  abc: [],
  operator: [],
  garTerritory: [],
  inn: [],
  uvrAntifraud: [],
  phoneNumber: "",
};

export type NumberingListQuery = {
  cursor: string | null;
  filters: NumberingFilters;
};

export type NumberingFacetQuery = {
  column: NumberingFacetColumn;
  q: string;
  filters: NumberingFilters;
};

const COVERAGE_COLUMNS = new Set<NumberingFacetColumn>(["abc", "garTerritory"]);

function cleanValue(raw: string): string {
  return raw === "__empty__" ? "" : raw;
}

function takeValues(
  values: string[] | undefined,
  max: number,
  column: NumberingFacetColumn,
): string[] {
  if (!values?.length) return [];
  const label = NUMBERING_HEADERS[column];
  if (values.length > max) {
    throw new NumberingQueryError(`Слишком много значений в фильтре «${label}»`);
  }
  return values.map((value) => {
    const cleaned = cleanValue(value);
    if (cleaned.length > NUMBERING_VALUE_MAX) {
      throw new NumberingQueryError(`Слишком длинное значение фильтра «${label}»`);
    }
    if (cleaned.includes("|||") || /[\r\n]/.test(cleaned)) {
      throw new NumberingQueryError(`Некорректное значение фильтра «${label}»`);
    }
    return cleaned;
  });
}

export function normalizePhoneMaskQuery(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return "";
  if (value.length !== PHONE_MASK_LENGTH || !/^[\d_]+$/.test(value)) {
    throw new NumberingQueryError(
      "Маска номера должна состоять из 10 цифр или пропусков",
    );
  }
  if ([...value].every((char) => char === "_")) return "";
  return value;
}

export function filtersFromColumnState(
  filters: ColumnFilters,
  phoneQ: string | null | undefined,
): NumberingFilters {
  const out = { ...EMPTY_NUMBERING_FILTERS };
  for (const column of NUMBERING_FACET_COLUMNS) {
    const max = COVERAGE_COLUMNS.has(column) ? NUMBERING_COVERAGE_MAX : NUMBERING_OR_MAX;
    out[column] = takeValues(filters[column], max, column);
  }
  out.phoneNumber = normalizePhoneMaskQuery(phoneQ);
  return out;
}

function readFilters(raw: string | null): ColumnFilters {
  if ((raw?.length ?? 0) > NUMBERING_FILTERS_MAX_CHARS) {
    throw new NumberingQueryError("Слишком длинный фильтр");
  }
  const parsed = parseFiltersParam(raw);
  const allowed: ColumnFilters = {};
  for (const column of NUMBERING_FACET_COLUMNS) {
    const values = parsed[column];
    if (values?.length) allowed[column] = values;
  }
  return allowed;
}

export function parseNumberingListQuery(params: URLSearchParams): NumberingListQuery {
  const page = params.get("page");
  if (page != null && page !== "1") {
    throw new NumberingQueryError("Постраничная загрузка идёт только курсором");
  }
  const cursorRaw = params.get("cursor");
  let cursor: string | null = null;
  if (cursorRaw != null && cursorRaw !== "") {
    if (cursorRaw.length > NUMBERING_CURSOR_MAX || !/^[A-Za-z0-9_-]+$/.test(cursorRaw)) {
      throw new NumberingQueryError("Некорректный курсор постраничной навигации");
    }
    cursor = cursorRaw;
  }
  return {
    cursor,
    filters: filtersFromColumnState(
      readFilters(params.get("filters")),
      params.get("phoneQ"),
    ),
  };
}

export function parseNumberingFacetQuery(params: URLSearchParams): NumberingFacetQuery {
  const column = params.get("column")?.trim() ?? "";
  if (!isNumberingFacetColumn(column)) {
    throw new NumberingQueryError("Неизвестная колонка фильтра");
  }
  const q = params.get("q") ?? "";
  if (q.length > NUMBERING_FACET_SEARCH_MAX) {
    throw new NumberingQueryError("Слишком длинный поиск в фильтре");
  }
  return {
    column,
    q,
    filters: filtersFromColumnState(
      readFilters(params.get("filters")),
      params.get("phoneQ"),
    ),
  };
}

export function parseNumberingSummaryQuery(params: URLSearchParams): NumberingFilters {
  return filtersFromColumnState(readFilters(params.get("filters")), params.get("phoneQ"));
}

function appendFilters(params: URLSearchParams, filters: NumberingFilters): void {
  for (const column of NUMBERING_FACET_COLUMNS) {
    const values = filters[column];
    if (values.length > 0) params.set(`filters.${column}`, values.join("|||"));
  }
  if (filters.phoneNumber) params.set("filters.phoneNumber", filters.phoneNumber);
}

export function pstnListParams(query: NumberingListQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set("pageSize", String(NUMBERING_PAGE_SIZE));
  params.set("sort", NUMBERING_SORT);
  if (query.cursor) params.set("cursor", query.cursor);
  else params.set("page", "1");
  appendFilters(params, query.filters);
  return params;
}

export function pstnFacetParams(query: NumberingFacetQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set("columns", query.column);
  if (query.q) params.set(`search.${query.column}`, query.q);
  appendFilters(params, query.filters);
  return params;
}

export function pstnSummaryParams(filters: NumberingFilters): URLSearchParams {
  const params = new URLSearchParams();
  appendFilters(params, filters);
  return params;
}
