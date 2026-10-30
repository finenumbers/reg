/**
 * Match a supplier-file number to catalog endpoint numbers.
 * Exact text, then digits-only, then the PSTN 10-digit key.
 * A short extension does not attach to the tail of a national number.
 */

import { normalizePstnPhone } from "@/modules/pstn/types";

export type SupplierCatalogRow = {
  id: string;
  endpointNumber: string;
};

export type SupplierCatalogIndex = {
  byExact: Map<string, SupplierCatalogRow[]>;
  byDigits: Map<string, SupplierCatalogRow[]>;
  byPstn: Map<string, SupplierCatalogRow[]>;
};

function push(
  map: Map<string, SupplierCatalogRow[]>,
  key: string,
  row: SupplierCatalogRow,
): void {
  const list = map.get(key);
  if (list) list.push(row);
  else map.set(key, [row]);
}

export function indexSupplierCatalog(
  rows: readonly SupplierCatalogRow[],
): SupplierCatalogIndex {
  const byExact = new Map<string, SupplierCatalogRow[]>();
  const byDigits = new Map<string, SupplierCatalogRow[]>();
  const byPstn = new Map<string, SupplierCatalogRow[]>();
  for (const row of rows) {
    const exact = row.endpointNumber.trim();
    if (!exact) continue;
    push(byExact, exact, row);
    const digits = exact.replace(/\D/g, "");
    if (digits) push(byDigits, digits, row);
    const pstn = normalizePstnPhone(exact);
    if (pstn) push(byPstn, pstn, row);
  }
  return { byExact, byDigits, byPstn };
}

/** All catalog rows for this file number. Empty when nothing matches. */
export function matchSupplierNumber(
  raw: string,
  index: SupplierCatalogIndex,
): SupplierCatalogRow[] {
  const exact = raw.trim();
  if (!exact) return [];
  const exactHits = index.byExact.get(exact);
  if (exactHits && exactHits.length > 0) return exactHits;
  const digits = exact.replace(/\D/g, "");
  if (digits) {
    const digitHits = index.byDigits.get(digits);
    if (digitHits && digitHits.length > 0) return digitHits;
  }
  const pstn = normalizePstnPhone(exact);
  if (!pstn) return [];
  return index.byPstn.get(pstn) ?? [];
}
