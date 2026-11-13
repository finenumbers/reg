/**
 * Whether an open column menu must ask the server again.
 * `snapshot` is the list's freshness stamp. It is not a reason to rebuild the menu.
 */

import {
  facetFiltersAffectQuery,
  type ColumnFilters,
  type FacetItem,
} from "@/components/column-filters/types";

export type FacetScope = {
  column: string;
  q: string;
  scopeKey: string;
  filters: ColumnFilters;
};

export type FacetFullList = FacetScope & {
  items: FacetItem[];
};

export type FacetLoadDecision =
  { kind: "keep" } | { kind: "local"; items: FacetItem[] } | { kind: "fetch" };

/** Drop the list snapshot. Other parameters stay, in a stable order. */
export function facetReloadKey(url: string): string {
  const parsed = new URL(url, "http://facet.local");
  parsed.searchParams.delete("snapshot");
  parsed.searchParams.sort();
  const qs = parsed.searchParams.toString();
  return qs ? `${parsed.pathname}?${qs}` : parsed.pathname;
}

function sameScope(loaded: FacetScope, next: FacetScope): boolean {
  return (
    loaded.column === next.column &&
    loaded.scopeKey === next.scopeKey &&
    !facetFiltersAffectQuery(next.column, loaded.filters, next.filters)
  );
}

/**
 * Keep the loaded menu, filter a complete list in place, or ask the server.
 * A truncated list is never filtered locally: a match may sit past the top 200.
 */
export function decideFacetLoad(input: {
  next: FacetScope;
  loaded: FacetScope | null;
  full: FacetFullList | null;
  match: ((value: string, q: string) => boolean) | undefined;
}): FacetLoadDecision {
  const { next, loaded, full, match } = input;
  if (loaded && loaded.q === next.q && sameScope(loaded, next)) {
    return { kind: "keep" };
  }
  if (match && full && sameScope(full, next)) {
    const query = next.q.trim();
    const items = query
      ? full.items.filter((item) => match(item.value, query))
      : full.items;
    return { kind: "local", items };
  }
  return { kind: "fetch" };
}
