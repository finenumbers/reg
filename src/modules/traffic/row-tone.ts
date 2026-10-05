/**
 * Row fill shared by CDR tables and month/enrich XLSX.
 * Category colors outrank a failed status. Redirect and plain directions have none.
 */

import { CALL_CATEGORY, CALL_STATUS } from "@/modules/traffic/call-class";

export type CdrRowTone = "phantom" | "call_error" | "parking" | "check" | "failed";

export function cdrRowTone(category: string, status: string): CdrRowTone | null {
  if (category === CALL_CATEGORY.phantom) return "phantom";
  if (category === CALL_CATEGORY.routeError || category === CALL_CATEGORY.unregistered) {
    return "call_error";
  }
  if (
    category === CALL_CATEGORY.incomingParking ||
    category === CALL_CATEGORY.outgoingParking
  ) {
    return "parking";
  }
  if (category === CALL_CATEGORY.check) return "check";
  if (status === CALL_STATUS.failed) return "failed";
  return null;
}
