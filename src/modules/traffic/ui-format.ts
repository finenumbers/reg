/**
 * Presentation helpers for traffic UI — pure, testable, no React.
 * Dates stay civil-clock from the CDR string; no timezone conversion.
 */

import { EMPTY_FILTER_TOKEN } from "@/components/column-filters/types";
import { csvTimeToDisplay } from "@/modules/enrich/dates";

export function formatCdrDateDisplay(raw: string): string {
  return csvTimeToDisplay(raw);
}

export function displayTrafficFacet(column: string, value: string): string {
  if (value === "" || value === EMPTY_FILTER_TOKEN) return "(пусто)";
  if (column === "cdr_date") return formatCdrDateDisplay(value);
  return value;
}

export function formatTrafficCell(column: string, raw: string): string {
  if (column === "cdr_date") return formatCdrDateDisplay(raw);
  return raw;
}
