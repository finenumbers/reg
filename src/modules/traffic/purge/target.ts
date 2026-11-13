/**
 * In-process month currently being purged — import skips these rows.
 */

/** Same sentence as the dashboard purge alert. */
export const PURGE_MONTH_BUSY_MESSAGE = "Идёт удаление месяца.";

const KEY = "__reg_cdr_purge_target__";

type Slot = { month: string | null; committed: boolean; callsCleared: boolean };

function store(): Slot {
  const g = globalThis as typeof globalThis & { [KEY]?: Slot };
  if (!g[KEY]) g[KEY] = { month: null, committed: false, callsCleared: false };
  if (g[KEY].callsCleared !== true) g[KEY].callsCleared = false;
  return g[KEY];
}

export function getPurgeTargetMonth(): string | null {
  return store().month;
}

/**
 * A different month starts clean. Clearing the month (`null`) also drops the
 * committed flag and the calls-cleared mark. Setting the same month again
 * leaves both alone, so a later failure that has not deleted anything does
 * not release the hold.
 */
export function setPurgeTargetMonth(month: string | null): void {
  const slot = store();
  if (month !== slot.month) {
    slot.committed = false;
    slot.callsCleared = false;
  }
  slot.month = month;
}

/**
 * The purge job has already recorded success for this month, and the hold
 * stayed because the continuation flag could not be cleared. Import still
 * skips the month. Statistics may leave it without scanning its CDR.
 */
export function markPurgeCallsCleared(month: string): void {
  const slot = store();
  if (slot.month === month) slot.callsCleared = true;
}

/** True only for the month currently held after a recorded successful purge. */
export function purgeCallsCleared(month: string): boolean {
  const slot = store();
  return slot.month === month && slot.callsCleared === true;
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
  slot.callsCleared = false;
}
