import { parseFiltersParam, type ColumnFilters } from "@/components/column-filters/types";
import { TABLE_PAGE_SIZE } from "@/lib/table-pagination";
import { parseTrafficFlagParam, type TrafficRowFlags } from "@/modules/traffic/row-flags";
import type { DurationCursor } from "@/modules/traffic/billable-minutes-sql";
import { parseTimeSort, type TimeSort } from "@/modules/traffic/traffic-sort";
import { OprsQueryError, type OprsCursor } from "@/modules/oprs/where";

export type OprsListInput = {
  filters: ColumnFilters;
  phoneQ: string;
  month?: string;
  flags: TrafficRowFlags;
  timeSort: TimeSort | null;
  durationSort: TimeSort | null;
  cursor: OprsCursor | null;
  durationCursor: DurationCursor | null;
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
    noRtp: parseTrafficFlagParam(params.get("noRtp")),
  };
}

function cursorFrom(
  params: URLSearchParams,
  durationSort: TimeSort | null,
): { cursor: OprsCursor | null; durationCursor: DurationCursor | null } {
  if (durationSort) {
    const hasElapsed = params.has("cursorElapsed");
    const cdrId = params.get("cursorId");
    if (!hasElapsed && !cdrId) return { cursor: null, durationCursor: null };
    const elapsed = params.get("cursorElapsed");
    if (elapsed == null || !cdrId) throw new OprsQueryError("Не указан курсор списка");
    return { cursor: null, durationCursor: { elapsed, cdrId } };
  }
  const cdrDate = params.get("cursorDate");
  const cdrId = params.get("cursorId");
  if (cdrDate == null && cdrId == null) return { cursor: null, durationCursor: null };
  if (!cdrDate || !cdrId) throw new OprsQueryError("Не указан курсор списка");
  return { cursor: { cdrDate, cdrId }, durationCursor: null };
}

/** Shared list query. A cursor without a snapshot is refused here. */
export function parseOprsListSearch(params: URLSearchParams): OprsListInput {
  const durationSort = parseTimeSort(params.get("durationSort"));
  const { cursor, durationCursor } = cursorFrom(params, durationSort);
  const snapshotRaw = params.get("snapshot");
  if ((cursor || durationCursor) && !snapshotRaw?.trim()) {
    throw new OprsQueryError("Не указан снимок списка");
  }
  const pageRaw = Number(params.get("pageSize") ?? String(TABLE_PAGE_SIZE));
  return {
    filters: parseFiltersParam(params.get("filters")),
    phoneQ: params.get("phoneQ")?.trim() ?? "",
    month: params.get("month") ?? undefined,
    flags: flagsFrom(params),
    timeSort: durationSort ? null : parseTimeSort(params.get("timeSort")),
    durationSort,
    cursor,
    durationCursor,
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
