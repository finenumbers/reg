/**
 * Row fill shared by CDR tables and month/enrich XLSX.
 * Phantom and «Ошибка» outrank status.
 * Parking status outranks a successful check. Yellow is only a successful check.
 */

import { CALL_CATEGORY, CALL_STATUS } from "@/modules/traffic/call-class";

export type CdrRowTone = "phantom" | "call_error" | "parking" | "check" | "failed";

export function cdrRowTone(category: string, status: string): CdrRowTone | null {
  if (category === CALL_CATEGORY.phantom) return "phantom";
  if (category === CALL_CATEGORY.errors) return "call_error";
  if (status === CALL_STATUS.parking) return "parking";
  if (category === CALL_CATEGORY.check && status === CALL_STATUS.success) return "check";
  if (status === CALL_STATUS.failed) return "failed";
  return null;
}
