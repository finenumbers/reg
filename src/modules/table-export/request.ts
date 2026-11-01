/**
 * Export body allowlist. The same parsers the tables already use.
 */

import type { ColumnFilters } from "@/components/column-filters/types";
import { DidClientError } from "@/modules/did/client";
import {
  allowFreeNumberFilters,
  FREE_NUMBERS_MAX_QUERY_CHARS,
  FreeNumbersQueryError,
} from "@/modules/free-numbers/query";
import {
  filtersFromColumnState,
  type NumberingFilters,
} from "@/modules/numbering-resource/filters";
import { NumberingQueryError } from "@/modules/numbering-resource/errors";
import { allowPurchasedNumberFilters } from "@/modules/purchased-numbers/query";
import type { TableExportKind, TableExportRequest } from "@/modules/table-export/job";

export class TableExportRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TableExportRequestError";
  }
}

function readColumnFilters(value: unknown): ColumnFilters {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const filters: ColumnFilters = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(raw)) continue;
    const values = raw.filter((item): item is string => typeof item === "string");
    if (values.length > 0) filters[key] = values;
  }
  return filters;
}

function readPhone(value: unknown, max: number): string {
  const phone = typeof value === "string" ? value.trim() : "";
  if (phone.length > max) {
    throw new TableExportRequestError("Слишком длинный поисковый запрос");
  }
  return phone;
}

export function parseTableExportRequest(
  kind: TableExportKind,
  body: unknown,
): TableExportRequest {
  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const filters = readColumnFilters(record.filters);
  try {
    if (kind === "free") {
      return {
        kind,
        filters: allowFreeNumberFilters(filters),
        phoneQ: readPhone(record.phoneQ, FREE_NUMBERS_MAX_QUERY_CHARS),
      };
    }
    if (kind === "purchased") {
      return {
        kind,
        filters: allowPurchasedNumberFilters(filters),
        phoneQ: readPhone(record.phoneQ, FREE_NUMBERS_MAX_QUERY_CHARS),
      };
    }
    const numbering: NumberingFilters = filtersFromColumnState(
      filters,
      typeof record.phoneQ === "string" ? record.phoneQ : "",
    );
    return { kind, filters: numbering };
  } catch (error) {
    if (
      error instanceof FreeNumbersQueryError ||
      error instanceof NumberingQueryError ||
      error instanceof TableExportRequestError ||
      error instanceof DidClientError
    ) {
      throw new TableExportRequestError(error.message);
    }
    throw error;
  }
}
