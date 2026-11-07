/**
 * One background for a geography row.
 * A number that is only in DID wins, then a blocked number, then red,
 * then the old tariff alert (now yellow), then a blank annotation.
 */

import { MISSING_PSTN_LABEL } from "@/modules/enrich/types";
import { STATUS_BLOCKED } from "@/modules/phones/types";
import type { PstnLookupStatus } from "@/modules/number-geography/types";

export type GeographyRowTone = "blocked" | "missing" | "red" | "yellow" | "blue" | "none";

export type GeographyToneRow = {
  operator: string;
  supplier: string;
  category: string;
  cityAlert: boolean;
  pstnStatus: PstnLookupStatus;
  activation: string;
  missing: boolean;
};

export type GeographyToneOptions = {
  /** Export has no in-flight lookup, so a cache miss is already red. */
  surface: "screen" | "export";
  /** Screen only. A failed or unconfigured lookup, while the operator cell is still empty. */
  lookupFailed?: boolean;
};

function pstnRed(row: GeographyToneRow, opts: GeographyToneOptions): boolean {
  const operator = row.operator.trim();
  if (operator === MISSING_PSTN_LABEL) return true;
  if (operator.length > 0) return false;
  if (opts.surface === "export") {
    return row.pstnStatus === "unresolved" || row.pstnStatus === "pending";
  }
  if (row.pstnStatus === "unresolved") return true;
  if (opts.lookupFailed) return true;
  return false;
}

export function geographyRowTone(
  row: GeographyToneRow,
  opts: GeographyToneOptions,
): GeographyRowTone {
  if (row.missing) return "missing";
  if (row.activation.trim() === STATUS_BLOCKED) return "blocked";
  if (pstnRed(row, opts)) return "red";
  if (row.cityAlert) return "yellow";
  if (!row.supplier.trim() || !row.category.trim()) return "blue";
  return "none";
}
