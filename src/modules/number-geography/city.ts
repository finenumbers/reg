/**
 * City cell and red-row flag from a raw tariff direction.
 * The SQL phrase in sql.ts uses the same constants. Direction matching
 * stays in cdr_tariff_direction.
 */

import {
  FREE_CALL_DIRECTION,
  MOBILE_RF_DIRECTION,
} from "@/modules/number-geography/columns";
import { CITY_DIRECTION_PREFIX } from "@/modules/traffic/call-class";

/** Place name after «г. », or null when the direction is not that prefix. */
export function cityTail(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return null;
  // btrim eats the space in a bare «г. », so the leftover is «г.».
  if (trimmed === CITY_DIRECTION_PREFIX.trim()) return "";
  if (!trimmed.startsWith(CITY_DIRECTION_PREFIX)) return null;
  return trimmed.slice(CITY_DIRECTION_PREFIX.length).trim();
}

/** Label stored in the cell and in the city facet. */
export function cityLabel(raw: string | null | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return "";
  const tail = cityTail(trimmed);
  if (tail != null) return tail;
  return trimmed;
}

/**
 * True when the raw direction is not «Мобильные РФ», «Бесплатный вызов»,
 * or a «г. » name with a non-empty place. An empty tail is red.
 */
export function cityAlert(raw: string | null | undefined): boolean {
  const trimmed = raw?.trim() ?? "";
  if (trimmed === MOBILE_RF_DIRECTION || trimmed === FREE_CALL_DIRECTION) {
    return false;
  }
  const tail = cityTail(trimmed);
  if (tail != null && tail.length > 0) return false;
  return true;
}
