/**
 * Pure helpers: live SIP Unregistered vs phones endpoint numbers.
 */

/** True when endpoint number is in the Unregistered set from reg_current. */
export function isSipUnregistered(
  endpointNumber: string | null | undefined,
  unregisteredPhones: ReadonlySet<string>,
): boolean {
  if (!endpointNumber) return false;
  return unregisteredPhones.has(endpointNumber);
}

/** Build a Set from reg_current Unregistered phone list. */
export function toUnregisteredPhoneSet(
  phones: readonly string[],
): Set<string> {
  return new Set(phones.filter((p) => p.length > 0));
}

/**
 * Phones to use for endpointNumber IN filter.
 * null → empty result (avoid Prisma `in: []`).
 */
export function sipUnregisteredFilterPhones(
  unregisteredPhones: readonly string[],
): string[] | null {
  const cleaned = unregisteredPhones.filter((p) => p.length > 0);
  return cleaned.length > 0 ? cleaned : null;
}
