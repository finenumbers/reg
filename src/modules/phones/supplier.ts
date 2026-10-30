/**
 * Supplier lives on the endpoint JSON row. Sync keeps it by the trimmed number.
 * The file match is looser and lives in supplier-match.ts.
 */

import { ENDPOINT_NUMBER_FIELD } from "@/modules/phones/types";

export const SUPPLIER_FIELD = "Поставщик";
export const SUPPLIER_MAX_LENGTH = 200;

/** Transaction-scoped lock shared by phones.sync and supplier import. */
export const PHONE_CATALOG_LOCK_SQL =
  "SELECT pg_advisory_xact_lock(4815162342001::bigint)";

export type SupplierEndpointRow = {
  name: string;
  endpointNumber: string | null;
  data: unknown;
};

function asRecord(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  return data as Record<string, unknown>;
}

export function readSupplier(data: unknown): string {
  const raw = asRecord(data)[SUPPLIER_FIELD];
  if (typeof raw !== "string") return "";
  return raw.trim();
}

/**
 * First non-empty supplier for a trimmed number, rows already ordered by name.
 * A later row with the same number does not replace it.
 */
export function supplierMapFromEndpoints(
  rows: readonly SupplierEndpointRow[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const number = row.endpointNumber?.trim() ?? "";
    if (!number || map.has(number)) continue;
    const supplier = readSupplier(row.data);
    if (!supplier) continue;
    map.set(number, supplier);
  }
  return map;
}

/** Copy the saved supplier onto a new snapshot row when the number text matches. */
export function stampSupplier<T extends Record<string, string>>(
  data: T,
  endpointNumber: string | null,
  suppliers: ReadonlyMap<string, string>,
): T {
  const number = endpointNumber?.trim() ?? "";
  const supplier = number ? suppliers.get(number) : undefined;
  if (!supplier) return data;
  return { ...data, [SUPPLIER_FIELD]: supplier };
}

/** Show «Поставщик» after the terminal number. Leave an existing header where it is. */
export function withSupplierHeader(headers: readonly string[]): string[] {
  if (headers.includes(SUPPLIER_FIELD)) return [...headers];
  const next = [...headers];
  const at = next.indexOf(ENDPOINT_NUMBER_FIELD);
  if (at === -1) next.push(SUPPLIER_FIELD);
  else next.splice(at + 1, 0, SUPPLIER_FIELD);
  return next;
}
