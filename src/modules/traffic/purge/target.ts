/**
 * In-process month currently being purged — import skips these rows.
 */

const KEY = "__reg_cdr_purge_target__";

type Slot = { month: string | null };

function store(): Slot {
  const g = globalThis as typeof globalThis & { [KEY]?: Slot };
  if (!g[KEY]) g[KEY] = { month: null };
  return g[KEY];
}

export function getPurgeTargetMonth(): string | null {
  return store().month;
}

export function setPurgeTargetMonth(month: string | null): void {
  store().month = month;
}

/** Test helper */
export function resetPurgeTargetForTests(): void {
  store().month = null;
}
