/**
 * Row fill shared by CDR tables and month/enrich XLSX.
 * Phantom, call errors, and «Проверить» outrank status.
 * Parking status outranks a successful check. Yellow is only a successful check.
 */

import { CALL_CATEGORY, CALL_STATUS } from "@/modules/traffic/call-class";

export type CdrRowTone =
  "phantom" | "call_error" | "verify" | "parking" | "check" | "failed";

export function cdrRowTone(category: string, status: string): CdrRowTone | null {
  if (category === CALL_CATEGORY.phantom) return "phantom";
  if (category === CALL_CATEGORY.routeError || category === CALL_CATEGORY.unregistered) {
    return "call_error";
  }
  if (category === CALL_CATEGORY.verify) return "verify";
  if (status === CALL_STATUS.parking) return "parking";
  if (category === CALL_CATEGORY.check && status === CALL_STATUS.success) return "check";
  if (status === CALL_STATUS.failed) return "failed";
  return null;
}
