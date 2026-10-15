/**
 * In-process month currently being purged — import skips these rows.
 */

const KEY = "__reg_cdr_purge_target__";

type Slot = { month: string | null; committed: boolean };

function store(): Slot {
  const g = globalThis as typeof globalThis & { [KEY]?: Slot };
  if (!g[KEY]) g[KEY] = { month: null, committed: false };
  return g[KEY];
}

export function getPurgeTargetMonth(): string | null {
  return store().month;
}

/**
 * A different month starts clean. Clearing the month (`null`) also drops the
 * committed flag. Setting the same month again leaves the flag alone, so a
 * later failure that has not deleted anything does not release the hold.
 */
export function setPurgeTargetMonth(month: string | null): void {
  const slot = store();
  if (month !== slot.month) slot.committed = false;
  slot.month = month;
}

/** True after a DELETE batch the database has already committed. */
export function notePurgeBatchCommitted(count: number): void {
  if (count > 0) store().committed = true;
}

export function purgeDeleteCommitted(): boolean {
  return store().committed;
}

/** Test helper */
export function resetPurgeTargetForTests(): void {
  const slot = store();
  slot.month = null;
  slot.committed = false;
}
