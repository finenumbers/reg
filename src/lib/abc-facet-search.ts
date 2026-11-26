/**
 * Menu search for screen ABC text such as «7 (39155)».
 * A full digit query finds the same cell after stripping spaces and parentheses.
 */

import { displayFacetValue } from "@/components/column-filters/types";

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Facet menu hit for an ABC token (already the screen text).
 * Query may already be lowercased by the caller.
 */
export function abcFacetQueryHits(token: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (token === "" || token === "__empty__") return "(пусто)".includes(needle);
  const shown = displayFacetValue(token).toLowerCase();
  if (shown.includes(needle)) return true;
  const digitNeedle = digitsOnly(needle);
  if (!digitNeedle) return false;
  return digitsOnly(token).includes(digitNeedle);
}
