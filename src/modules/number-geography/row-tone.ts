/**
 * One background for a geography row.
 * A number that is only in DID wins, then a blocked number, then a live
 * Unregistered row, then a missing operator, then the old tariff alert
 * (now yellow), then a blank annotation.
 */

import { MISSING_PSTN_LABEL } from "@/modules/enrich/types";
import { STATUS_BLOCKED } from "@/modules/phones/types";
import type { PstnLookupStatus } from "@/modules/number-geography/types";

export type GeographyRowTone =
  "blocked" | "missing" | "unregistered" | "operator" | "yellow" | "blue" | "none";

export type GeographyToneRow = {
  operator: string;
  supplier: string;
  category: string;
  cityAlert: boolean;
  pstnStatus: PstnLookupStatus;
  activation: string;
  missing: boolean;
  /** Live SIP Unregistered. Same set as the registration and phone rows. */
  unregistered: boolean;
};

export type GeographyToneOptions = {
  /** Export has no in-flight lookup, so a cache miss is already an operator miss. */
  surface: "screen" | "export";
  /** Screen only. A failed or unconfigured lookup, while the operator cell is still empty. */
  lookupFailed?: boolean;
};

function operatorMissing(row: GeographyToneRow, opts: GeographyToneOptions): boolean {
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
  if (row.unregistered) return "unregistered";
  if (operatorMissing(row, opts)) return "operator";
  if (row.cityAlert) return "yellow";
  if (!row.supplier.trim() || !row.category.trim()) return "blue";
  return "none";
}
