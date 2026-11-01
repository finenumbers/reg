import type { FacetResponse } from "@/components/column-filters/types";
import { encodeNumberingCursor } from "@/modules/numbering-resource/cursor";
import { readPstnJson, type PstnReadOptions } from "@/modules/numbering-resource/client";
import {
  pstnFacetParams,
  pstnListParams,
  pstnSummaryParams,
  type NumberingFacetQuery,
  type NumberingFilters,
  type NumberingListQuery,
} from "@/modules/numbering-resource/filters";
import {
  mapFacetsBody,
  mapRangesBody,
  mapSummaryBody,
} from "@/modules/numbering-resource/map";
import type {
  ListNumberingResult,
  NumberingSummary,
} from "@/modules/numbering-resource/types";
import { loadPstnBaseUrl } from "@/modules/pstn/credentials";

export async function listNumberingResource(
  query: NumberingListQuery,
  options: PstnReadOptions = {},
): Promise<ListNumberingResult> {
  const baseUrl = await loadPstnBaseUrl();
  const body = await readPstnJson("/api/ranges", pstnListParams(query), baseUrl, options);
  const mapped = mapRangesBody(body);
  const last = mapped.items.at(-1);
  const nextCursor = mapped.hasMore && last ? encodeNumberingCursor(last) : null;
  return {
    items: mapped.items,
    total: mapped.total,
    hasMore: nextCursor != null,
    nextCursor,
  };
}

export async function listNumberingFacets(
  query: NumberingFacetQuery,
  options: PstnReadOptions = {},
): Promise<FacetResponse> {
  const baseUrl = await loadPstnBaseUrl();
  const body = await readPstnJson(
    "/api/ranges/facets",
    pstnFacetParams(query),
    baseUrl,
    options,
  );
  return mapFacetsBody(body, query.column);
}

export async function summarizeNumberingResource(
  filters: NumberingFilters,
  options: PstnReadOptions = {},
): Promise<NumberingSummary> {
  const baseUrl = await loadPstnBaseUrl();
  const body = await readPstnJson(
    "/api/summary",
    pstnSummaryParams(filters),
    baseUrl,
    options,
  );
  return mapSummaryBody(body);
}
