/**
 * In-process vacuum flag. Set synchronously with the job queue so CDR
 * readers can refuse before they take a pool connection.
 * One app replica: this flag is not shared across processes.
 */

const KEY = "__reg_db_vacuum__";

function store(): { active: boolean } {
  const g = globalThis as typeof globalThis & { [KEY]?: { active: boolean } };
  if (!g[KEY]) g[KEY] = { active: false };
  return g[KEY];
}

export function isDatabaseVacuumActive(): boolean {
  return store().active;
}

export function setDatabaseVacuumActive(active: boolean): void {
  store().active = active;
}

/** Test helper */
export function resetDatabaseVacuumForTests(): void {
  store().active = false;
}

export const CDR_VACUUM_BUSY_MESSAGE =
  "Идёт сжатие базы. Повторите, когда оно закончится.";
