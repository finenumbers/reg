/**
 * Match a supplier-file row to catalog endpoint numbers.
 * Prefer exact rtu_screen abc+telephone, then digits(ABC)+digits(Номер),
 * then the full «Номер» alone when ABC is empty.
 * Exact text, digits-only, and the PSTN 10-digit key on endpointNumber.
 * A short extension does not attach to the tail of a national number.
 */

import { normalizePstnPhone } from "@/modules/pstn/types";

type SupplierCatalogRow = {
  id: string;
  endpointNumber: string;
};

type SupplierScreenRow = {
  id: string;
  abc: string;
  telephone: string;
};

export type SupplierCatalogIndex = {
  byExact: Map<string, SupplierCatalogRow[]>;
  byDigits: Map<string, SupplierCatalogRow[]>;
  byPstn: Map<string, SupplierCatalogRow[]>;
  byAbcTel: Map<string, SupplierCatalogRow[]>;
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

function abcTelKey(abc: string, telephone: string): string {
  return `${abc}\0${telephone}`;
}

export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function indexSupplierCatalog(
  rows: readonly SupplierCatalogRow[],
  screen: readonly SupplierScreenRow[] = [],
): SupplierCatalogIndex {
  const byExact = new Map<string, SupplierCatalogRow[]>();
  const byDigits = new Map<string, SupplierCatalogRow[]>();
  const byPstn = new Map<string, SupplierCatalogRow[]>();
  const byAbcTel = new Map<string, SupplierCatalogRow[]>();
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const row of rows) {
    const exact = row.endpointNumber.trim();
    if (!exact) continue;
    push(byExact, exact, row);
    const digits = digitsOnly(exact);
    if (digits) push(byDigits, digits, row);
    const pstn = normalizePstnPhone(exact);
    if (pstn) push(byPstn, pstn, row);
  }
  for (const cell of screen) {
    const catalog = byId.get(cell.id);
    if (!catalog) continue;
    const abc = cell.abc.trim();
    const telephone = cell.telephone.trim();
    if (!abc || !telephone) continue;
    push(byAbcTel, abcTelKey(abc, telephone), catalog);
  }
  return { byExact, byDigits, byPstn, byAbcTel };
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
  const digits = digitsOnly(exact);
  if (digits) {
    const digitHits = index.byDigits.get(digits);
    if (digitHits && digitHits.length > 0) return digitHits;
  }
  const pstn = normalizePstnPhone(exact);
  if (!pstn) return [];
  return index.byPstn.get(pstn) ?? [];
}

/**
 * Match one supplier file row.
 * Empty ABC uses «Номер» as the full number.
 * Non-empty ABC tries screen abc+telephone, then digit concat.
 */
export function matchSupplierFileRow(
  row: { abc: string; telephone: string },
  index: SupplierCatalogIndex,
): SupplierCatalogRow[] {
  const abc = row.abc.trim();
  const telephone = row.telephone.trim();
  if (!telephone) return [];
  if (!abc) return matchSupplierNumber(telephone, index);
  const screenHits = index.byAbcTel.get(abcTelKey(abc, telephone));
  if (screenHits && screenHits.length > 0) return screenHits;
  const composed = digitsOnly(abc) + digitsOnly(telephone);
  if (!composed) return [];
  return matchSupplierNumber(composed, index);
}
