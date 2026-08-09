/**
 * Sort registration phones ascending (lexicographic digit-string order).
 */

export function compareRegistrationPhones(a: string, b: string): number {
  return a.localeCompare(b, "en", { sensitivity: "base" });
}

export function sortRegistrationItemsByPhone<T extends { phone: string }>(
  rows: T[],
): T[] {
  return [...rows].sort((x, y) =>
    compareRegistrationPhones(x.phone, y.phone),
  );
}
