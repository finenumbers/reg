/**
 * Category lives on the endpoint JSON row, beside the supplier.
 * Sync keeps it by the trimmed number. The file match stays in supplier-match.ts.
 */

import { SUPPLIER_FIELD } from "@/modules/phones/supplier";
import { STATUS_FIELD } from "@/modules/phones/types";

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

/** «Категория», then «Поставщик», then the other headers, each name once. */
export function leadWithCategoryAndSupplier(headers: readonly string[]): string[] {
  const rest = headers.filter(
    (header) => header !== CATEGORY_FIELD && header !== SUPPLIER_FIELD,
  );
  return [CATEGORY_FIELD, SUPPLIER_FIELD, ...rest];
}

/** Screen order. «Статус» stays last. */
export function screenEndpointHeaders(headers: readonly string[]): string[] {
  const led = leadWithCategoryAndSupplier(headers);
  const rest = led.filter((header) => header !== STATUS_FIELD);
  return [...rest, STATUS_FIELD];
}
