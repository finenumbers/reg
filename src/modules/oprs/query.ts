import { parseFiltersParam, type ColumnFilters } from "@/components/column-filters/types";
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";
import { parseTrafficFlagParam, type TrafficRowFlags } from "@/modules/traffic/row-flags";
import { parseTimeSort, type TimeSort } from "@/modules/traffic/traffic-sort";
import { OprsQueryError, type OprsCursor } from "@/modules/oprs/where";

export type OprsListInput = {
  filters: ColumnFilters;
  phoneQ: string;
  month?: string;
  flags: TrafficRowFlags;
  timeSort: TimeSort | null;
  cursor: OprsCursor | null;
  snapshotRaw: string | null;
  pageSize: number;
};

function flagsFrom(params: URLSearchParams): TrafficRowFlags {
  return {
    phantom: parseTrafficFlagParam(params.get("phantom")),
    callErrors: parseTrafficFlagParam(params.get("callErrors")),
    parking: parseTrafficFlagParam(params.get("parking")),
    failed: parseTrafficFlagParam(params.get("failed")),
    check: parseTrafficFlagParam(params.get("check")),
    success: parseTrafficFlagParam(params.get("success")),
  };
}

function cursorFrom(params: URLSearchParams): OprsCursor | null {
  const cdrDate = params.get("cursorDate");
  const cdrId = params.get("cursorId");
  if (cdrDate == null && cdrId == null) return null;
  if (!cdrDate || !cdrId) throw new OprsQueryError("Не указан курсор списка");
  return { cdrDate, cdrId };
}

/** Shared list query. A cursor without a snapshot is refused here. */
export function parseOprsListSearch(params: URLSearchParams): OprsListInput {
  const cursor = cursorFrom(params);
  const snapshotRaw = params.get("snapshot");
  if (cursor && !snapshotRaw?.trim()) {
    throw new OprsQueryError("Не указан снимок списка");
  }
  const pageRaw = Number(params.get("pageSize") ?? String(TABLE_PAGE_SIZE));
  return {
    filters: parseFiltersParam(params.get("filters")),
    phoneQ: params.get("phoneQ")?.trim() ?? "",
    month: params.get("month") ?? undefined,
    flags: flagsFrom(params),
    timeSort: parseTimeSort(params.get("timeSort")),
    cursor,
    snapshotRaw,
    pageSize: Number.isFinite(pageRaw) ? pageRaw : TABLE_PAGE_SIZE,
  };
}

export function parseOprsFacetSearch(
  params: URLSearchParams,
): OprsListInput & { column: string; q: string; limit: number } {
  const column = params.get("column")?.trim() ?? "";
  if (!column) throw new OprsQueryError("Не указан столбец");
  const limitRaw = Number(params.get("limit") ?? "200");
  return {
    ...parseOprsListSearch(params),
    column,
    q: params.get("q")?.trim() ?? "",
    limit: Number.isFinite(limitRaw) ? limitRaw : 200,
  };
}
