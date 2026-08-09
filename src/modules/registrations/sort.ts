/**
 * Sort registration phones ascending (numeric-aware: 2 before 10).
 */

export function compareRegistrationPhones(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function sortRegistrationItemsByPhone<T extends { phone: string }>(
  rows: T[],
): T[] {
  return [...rows].sort((x, y) =>
    compareRegistrationPhones(x.phone, y.phone),
  );
}
