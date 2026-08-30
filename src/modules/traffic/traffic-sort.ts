import type { Prisma } from "@/generated/prisma/client";
import {
  EMPTY_FILTER_TOKEN,
  type FacetItem,
} from "@/components/column-filters/types";

/** Time column: clock sort only (no facet). Date column: facet days ascending. */
export type TimeSort = "asc" | "desc";

export function parseTimeSort(raw: string | null | undefined): TimeSort | null {
  if (raw === "asc" || raw === "desc") return raw;
  return null;
}

export function nextTimeSort(current: TimeSort | null): TimeSort | null {
  if (current == null) return "desc";
  if (current === "desc") return "asc";
  return null;
}

export function trafficListOrderBy(
  timeSort: TimeSort | null,
): Prisma.CdrRecordOrderByWithRelationInput[] {
  if (timeSort == null) {
    return [{ cdrDate: "desc" }, { cdrId: "desc" }];
  }
  return [
    { cdrTime: timeSort },
    { cdrDate: timeSort },
    { cdrId: timeSort },
  ];
}

export function moveEmptyFacetLast(items: FacetItem[]): FacetItem[] {
  const empty: FacetItem[] = [];
  const rest: FacetItem[] = [];
  for (const item of items) {
    if (item.value === "" || item.value === EMPTY_FILTER_TOKEN) {
      empty.push(item);
    } else {
      rest.push(item);
    }
  }
  return [...rest, ...empty];
}

/** Date menu: calendar order. Other columns: most frequent first. */
export function trafficFacetGroupOrder(column: string):
  | { cdrDay: "asc" }
  | { _count: { id: "desc" } } {
  return column === "cdr_day"
    ? { cdrDay: "asc" }
    : { _count: { id: "desc" } };
}

export function arrangeTrafficFacetItems(
  column: string,
  items: FacetItem[],
): FacetItem[] {
  return column === "cdr_day" ? moveEmptyFacetLast(items) : items;
}

/** Neutral glyph until the Time column sort is active. */
export function timeSortChevron(timeSort: TimeSort | null): string {
  if (timeSort === "asc") return "▴";
  if (timeSort === "desc") return "▾";
  return "↕";
}
