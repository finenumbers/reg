/**
 * Months this import file must not insert.
 * A month stays held after the live purge target is cleared, so the
 * rest of the file cannot insert rows the DELETE already passed.
 */

export function rememberPurgeTarget(held: Set<string>, live: string | null): void {
  if (live) held.add(live);
}

export function monthIsHeld(
  held: ReadonlySet<string>,
  rowMonth: string | undefined,
): boolean {
  return Boolean(rowMonth && held.has(rowMonth));
}

/** Poison only while this file's held month is still the live target. */
export function activePurgeHold(
  held: ReadonlySet<string>,
  live: string | null,
): string | null {
  if (live && held.has(live)) return live;
  return null;
}
