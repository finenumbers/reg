/**
 * Category lives on the endpoint JSON row, beside the supplier.
 * Sync keeps it by the trimmed number. The file match stays in supplier-match.ts.
 */

import { SUPPLIER_FIELD } from "@/modules/phones/supplier";
import { ENDPOINT_NUMBER_FIELD } from "@/modules/phones/types";

export const CATEGORY_FIELD = "Категория";
export const CATEGORY_MAX_LENGTH = 200;

type CategoryEndpointRow = {
  name: string;
  endpointNumber: string | null;
  data: unknown;
};

function asRecord(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  return data as Record<string, unknown>;
}

export function readCategory(data: unknown): string {
  const raw = asRecord(data)[CATEGORY_FIELD];
  if (typeof raw !== "string") return "";
  return raw.trim();
}

/**
 * First non-empty category for a trimmed number, rows already ordered by name.
 * A later row with the same number does not replace it.
 */
export function categoryMapFromEndpoints(
  rows: readonly CategoryEndpointRow[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const number = row.endpointNumber?.trim() ?? "";
    if (!number || map.has(number)) continue;
    const category = readCategory(row.data);
    if (!category) continue;
    map.set(number, category);
  }
  return map;
}

/** Copy the saved category onto a new snapshot row when the number text matches. */
export function stampCategory<T extends Record<string, string>>(
  data: T,
  endpointNumber: string | null,
  categories: ReadonlyMap<string, string>,
): T {
  const number = endpointNumber?.trim() ?? "";
  const category = number ? categories.get(number) : undefined;
  if (!category) return data;
  return { ...data, [CATEGORY_FIELD]: category };
}

/** Show «Категория» after «Поставщик». Leave an existing header where it is. */
export function withCategoryHeader(headers: readonly string[]): string[] {
  if (headers.includes(CATEGORY_FIELD)) return [...headers];
  const next = [...headers];
  const supplierAt = next.indexOf(SUPPLIER_FIELD);
  if (supplierAt !== -1) {
    next.splice(supplierAt + 1, 0, CATEGORY_FIELD);
    return next;
  }
  const at = next.indexOf(ENDPOINT_NUMBER_FIELD);
  if (at === -1) next.push(CATEGORY_FIELD);
  else next.splice(at + 1, 0, CATEGORY_FIELD);
  return next;
}
