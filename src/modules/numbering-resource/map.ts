/**
 * Keep only the current-dataset fields. Diff columns are dropped.
 */

import type { FacetResponse } from "@/components/column-filters/types";
import { NumberingClientError } from "@/modules/numbering-resource/errors";
import type {
  ListNumberingResult,
  NumberingRow,
  NumberingSummary,
  NumberingSummaryCounts,
} from "@/modules/numbering-resource/types";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asSafeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  return value;
}

function badResponse(): never {
  throw new NumberingClientError(
    "BAD_RESPONSE",
    "Не удалось прочитать ресурс нумерации.",
  );
}

export function mapRangeRow(value: unknown): NumberingRow {
  const row = asRecord(value);
  const id = asSafeInt(row?.id);
  const rangeStart = asSafeInt(row?.rangeStart);
  const rangeEnd = asSafeInt(row?.rangeEnd);
  const capacity = asSafeInt(row?.capacity);
  if (
    id == null ||
    id <= 0 ||
    rangeStart == null ||
    rangeEnd == null ||
    capacity == null
  ) {
    badResponse();
  }
  const uvr = row?.uvrAntifraud;
  let uvrAntifraud: number | null = null;
  if (uvr != null) {
    const parsed = asSafeInt(uvr);
    if (parsed == null) badResponse();
    uvrAntifraud = parsed;
  }
  return {
    id,
    abc: asString(row?.abc),
    rangeStart,
    rangeEnd,
    capacity,
    operator: asString(row?.operator),
    garTerritory: asString(row?.garTerritory),
    inn: asString(row?.inn),
    uvrAntifraud,
  };
}

export function mapRangesBody(body: unknown): Omit<ListNumberingResult, "nextCursor"> {
  const root = asRecord(body);
  if (!root || !Array.isArray(root.data)) badResponse();
  const meta = asRecord(root.meta);
  const total = asSafeInt(meta?.totalRows);
  if (total == null) badResponse();
  return {
    items: root.data.map((row) => mapRangeRow(row)),
    total,
    hasMore: meta?.hasMore === true,
  };
}

function mapCounts(
  value: unknown,
  pending: boolean,
): NumberingSummaryCounts & {
  totalCapacityPending?: boolean;
} {
  const row = asRecord(value);
  const rangeCount = asSafeInt(row?.rangeCount);
  const totalCapacity = asSafeInt(row?.totalCapacity);
  const uniqueGarTerritories = asSafeInt(row?.uniqueGarTerritories);
  const uniqueOperators = asSafeInt(row?.uniqueOperators);
  if (
    rangeCount == null ||
    totalCapacity == null ||
    uniqueGarTerritories == null ||
    uniqueOperators == null
  ) {
    badResponse();
  }
  return {
    rangeCount,
    totalCapacity,
    uniqueGarTerritories,
    uniqueOperators,
    ...(pending ? { totalCapacityPending: row?.totalCapacityPending === true } : {}),
  };
}

export function mapSummaryBody(body: unknown): NumberingSummary {
  const root = asRecord(body);
  if (!root) badResponse();
  const filtered = mapCounts(root.filtered, true);
  const global = mapCounts(root.global, false);
  return {
    filtered: {
      rangeCount: filtered.rangeCount,
      totalCapacity: filtered.totalCapacity,
      uniqueGarTerritories: filtered.uniqueGarTerritories,
      uniqueOperators: filtered.uniqueOperators,
      totalCapacityPending: filtered.totalCapacityPending === true,
    },
    global,
  };
}

export function mapFacetsBody(body: unknown, column: string): FacetResponse {
  const root = asRecord(body);
  const facets = asRecord(root?.facets);
  const entry = asRecord(facets?.[column]);
  if (!entry || !Array.isArray(entry.options)) badResponse();
  const items = [];
  for (const option of entry.options) {
    const row = asRecord(option);
    const count = asSafeInt(row?.count);
    if (!row || count == null || count < 0) badResponse();
    const raw = row.value;
    const value =
      typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : null;
    if (value == null) badResponse();
    items.push({ value, count });
  }
  const totalDistinct = asSafeInt(entry.totalDistinct) ?? items.length;
  return {
    items,
    truncated: totalDistinct > items.length,
  };
}
