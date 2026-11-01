/**
 * Free-number list and facets. DID stays the source of rows.
 */

import type { FacetResponse } from "@/components/column-filters/types";
import { facetQueryMatchesEmptyLabel } from "@/components/column-filters/types";
import {
  DID_LIST_TIMEOUT_MS,
  type DidCredentials,
} from "@/modules/did/types";
import {
  didNotConfigured,
  listDidFreeFacets,
  listDidFreeNumbers,
} from "@/modules/did/client";
import { loadDidCredentials } from "@/modules/did/credentials";
import {
  facetSearchQuery,
  mapFreeNumberRow,
  shapeFreeNumberFacets,
  type FreeNumberRow,
  type ListFreeNumbersResult,
} from "@/modules/free-numbers/format";
import {
  emptyCountFilters,
  type FreeNumbersFacetQuery,
  type FreeNumbersListQuery,
} from "@/modules/free-numbers/query";

async function requireCreds(): Promise<DidCredentials> {
  const creds = await loadDidCredentials();
  if (!creds) throw didNotConfigured();
  return creds;
}

export async function listFreeNumbers(
  query: FreeNumbersListQuery,
): Promise<ListFreeNumbersResult> {
  const creds = await requireCreds();
  const page = await listDidFreeNumbers(query, creds, DID_LIST_TIMEOUT_MS);
  const items: FreeNumberRow[] = [];
  for (const raw of page.items) {
    if (items.length >= query.pageSize) break;
    const row = mapFreeNumberRow(raw);
    if (row) items.push(row);
  }
  return {
    items,
    total: page.total,
    page: page.page,
    pageSize: query.pageSize,
  };
}

export async function listFreeNumberFacets(
  query: FreeNumbersFacetQuery,
): Promise<FacetResponse> {
  const creds = await requireCreds();
  const wantEmpty = facetQueryMatchesEmptyLabel(query.q);
  const [facets, emptyPage] = await Promise.all([
    listDidFreeFacets(
      {
        column: query.column,
        filters: query.filters,
        phoneQ: query.phoneQ,
        q: facetSearchQuery(query.column, query.q),
        limit: query.limit,
      },
      creds,
      DID_LIST_TIMEOUT_MS,
    ),
    wantEmpty
      ? listDidFreeNumbers(
          {
            page: 1,
            pageSize: 1,
            filters: emptyCountFilters(query.filters, query.column),
            phoneQ: query.phoneQ,
          },
          creds,
          DID_LIST_TIMEOUT_MS,
        )
      : Promise.resolve(null),
  ]);
  return shapeFreeNumberFacets({
    column: query.column,
    q: query.q,
    items: facets.items,
    truncated: facets.truncated,
    emptyCount: emptyPage?.total ?? null,
    limit: query.limit,
  });
}
