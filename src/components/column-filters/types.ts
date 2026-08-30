/**
 * Shared multi-select column facet filters (DID-compatible semantics).
 */

import { formatCount } from "@/lib/format-count";

export const EMPTY_FILTER_TOKEN = "__empty__";

/** field → selected values (`__empty__` for blank/NULL). */
export type ColumnFilters = Record<string, string[]>;

export type FacetItem = {
  value: string;
  count: number;
};

export type FacetResponse = {
  items: FacetItem[];
  truncated: boolean;
};

export function encodeFilters(filters: ColumnFilters): string | null {
  const cleaned: ColumnFilters = {};
  for (const [key, values] of Object.entries(filters)) {
    if (values?.length) cleaned[key] = values;
  }
  if (Object.keys(cleaned).length === 0) return null;
  return JSON.stringify(cleaned);
}

export function parseFiltersParam(raw: string | null | undefined): ColumnFilters {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: ColumnFilters = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!key || !Array.isArray(value)) continue;
      const values = value
        .filter((v): v is string => typeof v === "string")
        .map((v) => (v === "" ? EMPTY_FILTER_TOKEN : v));
      if (values.length > 0) out[key] = values;
    }
    return out;
  } catch {
    return {};
  }
}

export function toFilterToken(value: string): string {
  return value === "" ? EMPTY_FILTER_TOKEN : value;
}

export function displayFacetValue(value: string): string {
  if (value === "" || value === EMPTY_FILTER_TOKEN) return "(пусто)";
  return value;
}

const EMPTY_FACET_LABEL = "(пусто)";

/** Header-menu search should find the empty-cell group labeled «(пусто)». */
export function facetQueryMatchesEmptyLabel(q: string): boolean {
  const n = q.trim().toLowerCase();
  if (!n) return false;
  if (n.includes("пусто")) return true;
  return n.length >= 3 && EMPTY_FACET_LABEL.includes(n);
}

export function formatFacetCount(n: number): string {
  return formatCount(n);
}

export function hasActiveFilters(filters: ColumnFilters): boolean {
  return Object.values(filters).some((v) => v.length > 0);
}

export function setColumnFilterValues(
  prev: ColumnFilters,
  field: string,
  values: string[],
): ColumnFilters {
  const next = { ...prev };
  if (values.length === 0) delete next[field];
  else next[field] = values;
  return next;
}

export function removeFacetValue(
  prev: ColumnFilters,
  field: string,
  value: string,
): ColumnFilters {
  const values = (prev[field] ?? []).filter((v) => v !== value);
  return setColumnFilterValues(prev, field, values);
}

/** Normalize cell text for facet token (empty → __empty__). */
export function cellToFilterToken(raw: string | null | undefined): string {
  if (raw == null) return EMPTY_FILTER_TOKEN;
  const trimmed = String(raw).trim();
  return trimmed.length === 0 ? EMPTY_FILTER_TOKEN : trimmed;
}

/**
 * Build facet items from an iterable of raw cell values.
 * Tokens use EMPTY_FILTER_TOKEN for blanks.
 */
export function aggregateFacetItems(
  values: Iterable<string | null | undefined>,
  opts: { q?: string; limit?: number } = {},
): FacetResponse {
  const limit = Math.min(500, Math.max(1, opts.limit ?? 200));
  const q = opts.q?.trim().toLowerCase() ?? "";
  const counts = new Map<string, number>();

  for (const raw of values) {
    const token = cellToFilterToken(raw);
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  let items = [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return displayFacetValue(a.value).localeCompare(
        displayFacetValue(b.value),
        "ru",
      );
    });

  if (q) {
    items = items.filter((item) =>
      displayFacetValue(item.value).toLowerCase().includes(q),
    );
  }

  const truncated = items.length > limit;
  return {
    items: truncated ? items.slice(0, limit) : items,
    truncated,
  };
}
