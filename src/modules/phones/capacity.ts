/** Catalog terminating capacity. Empty on screen reads as «Премиум». */

export const TERM_CAPACITY_FIELD = "ТЕРМ. емкость";
export const PREMIUM_CAPACITY = "Премиум";

/**
 * Blank catalog capacity is «Премиум». A non-empty value is returned as stored,
 * including «0». Whitespace-only is blank.
 */
export function displayTermCapacity(value: string | null | undefined): string {
  if (value == null) return PREMIUM_CAPACITY;
  return value.trim().length > 0 ? value : PREMIUM_CAPACITY;
}
