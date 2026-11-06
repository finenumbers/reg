import type { PhoneEndpointDescriptionSource } from "@/modules/registrations/phone-description";
import { STATUS_BLOCKED, STATUS_FIELD } from "@/modules/phones/types";

function statusText(data: unknown): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  const raw = (data as Record<string, unknown>)[STATUS_FIELD];
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Exact endpoint numbers with «Заблокировано».
 * A later duplicate still blocks the phone. Description keeps the first row.
 */
export function blockedRegistrationPhones(
  rows: readonly PhoneEndpointDescriptionSource[],
): Set<string> {
  const blocked = new Set<string>();
  for (const row of rows) {
    const number = row.endpointNumber?.trim() ?? "";
    if (!number || statusText(row.data) !== STATUS_BLOCKED) continue;
    blocked.add(number);
  }
  return blocked;
}
