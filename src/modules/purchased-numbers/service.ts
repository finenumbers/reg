/**
 * Purchased-number list and facets. DID stays the source of rows.
 */

import type { FacetResponse } from "@/components/column-filters/types";
import { facetQueryMatchesEmptyLabel } from "@/components/column-filters/types";
import { didNotConfigured, listDidFacets, listDidNumbers } from "@/modules/did/client";
import { loadDidCredentials } from "@/modules/did/credentials";
import { DID_LIST_TIMEOUT_MS, type DidCredentials } from "@/modules/did/types";
import { loadBlockedNumbers, numberIsBlocked } from "@/modules/phones/blocked-numbers";
import {
  facetSearchQuery,
  mapPurchasedNumberRow,
  purchasedMsisdn,
  shapePurchasedNumberFacets,
  type ListPurchasedNumbersResult,
  type PurchasedNumberRow,
} from "@/modules/purchased-numbers/format";
import {
  emptyCountFilters,
  type PurchasedNumbersFacetQuery,
  type PurchasedNumbersListQuery,
} from "@/modules/purchased-numbers/query";

async function requireCreds(): Promise<DidCredentials> {
  const creds = await loadDidCredentials();
  if (!creds) throw didNotConfigured();
  return creds;
}

export async function listPurchasedNumbers(
  query: PurchasedNumbersListQuery,
): Promise<ListPurchasedNumbersResult> {
  const creds = await requireCreds();
  const [page, blocked] = await Promise.all([
    listDidNumbers("purchased", query, creds, DID_LIST_TIMEOUT_MS),
    loadBlockedNumbers(),
  ]);
  const items: PurchasedNumberRow[] = [];
  for (const raw of page.items) {
    if (items.length >= query.pageSize) break;
    const row = mapPurchasedNumberRow(raw);
    if (!row) continue;
    if (numberIsBlocked(blocked, purchasedMsisdn(raw))) row.blocked = true;
    items.push(row);
  }
  return {
    items,
    total: page.total,
    page: page.page,
    pageSize: query.pageSize,
  };
}

export async function listPurchasedNumberFacets(
  query: PurchasedNumbersFacetQuery,
): Promise<FacetResponse> {
  const creds = await requireCreds();
  const wantEmpty = facetQueryMatchesEmptyLabel(query.q);
  const [facets, emptyPage] = await Promise.all([
    listDidFacets(
      "purchased",
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
      ? listDidNumbers(
          "purchased",
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
  return shapePurchasedNumberFacets({
    column: query.column,
    q: query.q,
    items: facets.items,
    truncated: facets.truncated,
    emptyCount: emptyPage?.total ?? null,
    limit: query.limit,
  });
}
